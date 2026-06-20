import React, { createContext, useState, useEffect, useContext } from 'react';
import { saveToken, getToken, deleteToken } from '../utils/storage';
import apiClient from '../api/client';

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

        return { success: true, user: userData, onboardingStatus: status, institution: inst };
      }

      // Fallback: if no token in register response, do login
      return await login(data.email, data.password);
    } catch (err) {
      const message = err.response?.data?.message || 'Registration failed';
      return { success: false, message };
    }
  };

  const logout = async () => {
    // eslint-disable-next-line no-console
    console.log('[Auth] logout invoked');
    // Tear down auth state first so the navigator switches roots
    // immediately, before we touch keychain. If the keychain delete
    // throws, the user is already logged out as far as the app is
    // concerned and they won't end up stuck in a half-authenticated
    // state.
    setUser(null);
    setOnboardingStatus(null);
    setInstitution(null);
    try {
      await deleteToken();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Auth] deleteToken failed (continuing anyway):', err?.message);
    }
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
