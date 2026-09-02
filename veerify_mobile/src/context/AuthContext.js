import React, { createContext, useState, useEffect, useContext } from 'react';
import { saveToken, getToken, deleteToken } from '../utils/storage';
import apiClient from '../api/client';
// FCM push registration — request permission + POST the token to the
// backend right after a successful sign-in / register / resume. Every
// helper is fail-open so a permission denial or Firebase outage
// never blocks the auth flow.
import {
  requestPermissionAndRegister as fcmRegister,
  revokeOnLogout as fcmRevoke,
} from '../services/fcm.service';

// Roles that receive FCM push. Parents get the in-app bell only
// (product decision), and super_admin only runs on the web dashboard.
// Gating registration here means parents don't get the OS permission
// prompt AND no token ever lands on the backend for their account.
// Backend also enforces this (services/notification.service.js) as a
// belt-and-suspenders check for stale mobile builds.
const PUSH_ROLES = new Set(['admin', 'trainer', 'student']);
const shouldRegisterPush = (u) => !!u && PUSH_ROLES.has(u.role);

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [institution, setInstitution] = useState(null);
  // Persistent session — on launch we try to resume from the token stored
  // in the OS keychain. If /auth/me returns 200 the user stays logged in
  // exactly where they were; if it 401s we treat the token as expired,
  // wipe it, and fall back to the Welcome screen.
  const [loading, setLoading] = useState(true);

useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      const token = await getToken();

      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const meRes = await apiClient.get('/auth/me');
        const userData = meRes?.data?.user ?? null;

        // For admins we need onboardingStatus + institution BEFORE we
        // flip setUser, because the admin navigator picks initialRouteName
        // the moment the stack mounts. If we set user first and fetch
        // status second, the navigator mounts with onboardingStatus=null
        // → falls back to PlanSelection → user is stuck.
        // The manual login flow already does this; resume-from-token was
        // missing it, which is why every cold start dropped onto the
        // plan-selection screen.
        let status = null;
        let inst   = null;
        if (userData?.role === 'admin') {
          try {
            const statusRes = await apiClient.get('/onboarding/my-status');
            status = statusRes?.data?.status || null;
            inst   = statusRes?.data?.institution || null;
            console.log('[AUTH] resume onboarding →', status,
              'institution?', !!inst,
              inst ? `(owner_user_id=${inst.owner_user_id})` : '');
          } catch (statusErr) {
            // Don't fail the whole resume on a status hiccup. Fall back to
            // 'registered' so the navigator still picks a sane default.
            console.log('[AUTH] resume /onboarding/my-status failed:', statusErr?.message);
            status = 'registered';
          }
        }

        if (!cancelled) {
          if (userData?.role === 'admin') {
            setOnboardingStatus(status);
            setInstitution(inst);
          }
          setUser(userData ?? null);
          // Re-register the FCM token on session resume so a token
          // that rotated while the app was closed still lands on the
          // backend against the correct user.
          if (shouldRegisterPush(userData)) {
            fcmRegister().catch((e) => console.log('[AUTH] fcm resume register threw:', e?.message));
          }
        }
      } catch (err) {
        console.log('[AUTH] /auth/me failed safely:', err?.message);
        try {
          await deleteToken();
        } catch {}
      }

    } catch (err) {
      console.log('[AUTH] startup fatal prevented:', err?.message);
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => { cancelled = true; };
}, []);
  const checkOnboardingStatus = async () => {
    try {
      const res = await apiClient.get('/onboarding/my-status');
      console.log('[AUTH] onboarding status →', res.data.status,
        'institution?', !!res.data.institution,
        res.data.institution ? `(owner_user_id=${res.data.institution.owner_user_id})` : '');
      setOnboardingStatus(res.data.status);
      setInstitution(res.data.institution || null);
      return res.data.status;
    } catch (err) {
      console.log('[AUTH] Onboarding status check failed:', err?.message);
      setOnboardingStatus('registered');
      setInstitution(null);
      return 'registered';
    }
  };

  const login = async (email, password) => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { token, user: userData } = response.data;
      console.log('[AUTH] login OK → user id=', userData.id, 'role=', userData.role, 'email=', userData.email);
      await saveToken(token);

      // For admins, fetch the onboarding status (and institution) BEFORE
      // calling setUser. The navigator picks its initialRouteName the moment
      // the admin stack mounts; if we flip setUser first and fetch second, the
      // navigator mounts with onboardingStatus=null → PlanSelection → stuck.
      let status = null;
      let inst   = null;
      let fetchError = null;
      if (userData.role === 'admin') {
        try {
          const res = await apiClient.get('/onboarding/my-status');
          status = res.data.status;
          inst   = res.data.institution || null;
          console.log('[AUTH] onboarding status →', status,
            'institution?', !!inst,
            inst ? `(name="${inst.name}", owner_user_id=${inst.owner_user_id})` : '');
        } catch (err) {
          fetchError = err?.response?.status
            ? `HTTP ${err.response.status}: ${err.response.data?.message || ''}`
            : (err?.message || 'unknown error');
          console.log('[AUTH] my-status failed:', fetchError);
          status = 'registered';
        }
        setOnboardingStatus(status);
        setInstitution(inst);
      }

      setUser(userData);

      // FCM registration — fire-and-forget. Delayed so setUser has
      // flushed and the navigator mounted before the OS prompt (on
      // Android 13+ / iOS) pops. Parents are excluded (bell only).
      if (shouldRegisterPush(userData)) {
        fcmRegister().catch((e) => console.log('[AUTH] fcm register threw:', e?.message));
      }

      return { success: true, user: userData, onboardingStatus: status, institution: inst };
    } catch (err) {
      const message = err.response?.data?.message || 'Login failed';
      return { success: false, message };
    }
  };

  const register = async (data) => {
    try {
      const response = await apiClient.post('/auth/register', data);
      const { token, user: userData } = response.data;

      if (token) {
        await saveToken(token);

        // Same race-fix as login(): set status + institution before user so
        // the navigator mounts with the right initialRouteName.
        let status = null;
        let inst   = null;
        if (userData.role === 'admin') {
          try {
            const res = await apiClient.get('/onboarding/my-status');
            status = res.data.status;
            inst   = res.data.institution || null;
          } catch {
            status = 'registered';
          }
          setOnboardingStatus(status);
          setInstitution(inst);
        }
        setUser(userData);
        // FCM registration on register/resume — same fire-and-forget
        // pattern as login(). Parents don't get push.
        if (shouldRegisterPush(userData)) {
          fcmRegister().catch((e) => console.log('[AUTH] fcm register threw:', e?.message));
        }

        return {
          success:          true,
          resumed:          !!response.data.resumed,
          user:             userData,
          onboardingStatus: status,
          institution:      inst,
        };
      }

      // Fallback: if no token in register response, do login
      return await login(data.email, data.password);
    } catch (err) {
      // Resume Registration — if the backend detected an incomplete
      // draft for this email/phone, surface the resume payload so the
      // screen can prompt "Continue previous registration?". The
      // screen re-invokes register() with { ...data, resume: true }.
      if (err.response?.status === 409 && err.response?.data?.code === 'RESUME_AVAILABLE') {
        return {
          success:         false,
          resumable:       true,
          code:            'RESUME_AVAILABLE',
          field:           err.response.data.field,
          resume:          err.response.data.resume,
          message:         err.response.data.message,
        };
      }
      const message = err.response?.data?.message || 'Registration failed';
      return {
        success: false,
        message,
        code:    err.response?.data?.code || null,
        field:   err.response?.data?.field || null,
      };
    }
  };

  const logout = async () => {
    // eslint-disable-next-line no-console
    console.log('[Auth] logout invoked');
    // STEP 1 — tear down auth state SYNCHRONOUSLY first. This is the
    // change that fixes "Sign out button does nothing": we no longer
    // await fcmRevoke (which can hang up to axios's 10-second timeout
    // when the device is offline) before switching navigator roots.
    // The moment setUser(null) commits, AppNavigator re-renders and
    // drops the student stack, so the user visually returns to the
    // Welcome screen within a single frame.
    setUser(null);
    setOnboardingStatus(null);
    setInstitution(null);

    // STEP 2 — flush the token from the OS keychain so the next
    // launch doesn't auto-resume this session. Awaited (short op) so
    // any race with an immediate re-login can't read a stale token.
    try {
      await deleteToken();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Auth] deleteToken failed (continuing anyway):', err?.message);
    }

    // STEP 3 — best-effort FCM token revocation. Fire-and-forget so
    // the sign-out never blocks on network. The backend endpoint is
    // idempotent, so a missed revoke on this device just means the
    // ex-user's next login will re-register a fresh token.
    Promise.resolve()
      .then(() => fcmRevoke())
      .catch((err) => console.warn('[Auth] fcm revoke threw:', err?.message));

    return { success: true };
  };

  const refreshOnboardingStatus = async () => {
    const status = await checkOnboardingStatus();
    return status;
  };

  return (
    <AuthContext.Provider value={{
      user,
      institution,
      loading,
      login,
      register,
      logout,
      onboardingStatus,
      refreshOnboardingStatus,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
