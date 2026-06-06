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
          // No stored session — start at Welcome.
          if (!cancelled) setLoading(false);
          return;
        }

        // Try to resume the session. The api client auto-attaches the token
        // via the interceptor in client.js, so we can just call /auth/me.
        try {
          const meRes = await apiClient.get('/auth/me');
          const userData = meRes.data?.user;
          if (!userData) throw new Error('No user in /auth/me response');

          console.log('[AUTH] session resumed → user id=', userData.id,
            'role=', userData.role, 'email=', userData.email);

          // Admins need onboardingStatus + institution loaded before the
          // navigator mounts (same race fix as login()).
          if (userData.role === 'admin') {
            try {
              const onb = await apiClient.get('/onboarding/my-status');
              if (!cancelled) {
                setOnboardingStatus(onb.data?.status || 'registered');
                setInstitution(onb.data?.institution || null);
              }
            } catch (err) {
              console.log('[AUTH] my-status failed during resume:', err?.message);
              if (!cancelled) {
                setOnboardingStatus('registered');
                setInstitution(null);
              }
            }
          }

          if (!cancelled) setUser(userData);
        } catch (err) {
          // 401 means the token is expired or invalid - wipe it so the
          // next request doesn't keep sending a zombie Authorization
          // header. Anything else (offline, server down) leaves the token
          // alone so the next launch can try again.
          const status = err?.response?.status;
          if (status === 401) {
            console.log('[AUTH] stored token rejected (401) — wiping');
            try { await deleteToken(); } catch {}
          } else {
            console.log('[AUTH] resume failed (non-401):', err?.message);
          }
        }
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
    await deleteToken();
    setUser(null);
    setOnboardingStatus(null);
    setInstitution(null);
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
