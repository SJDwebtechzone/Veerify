import React, { createContext, useState, useEffect, useContext } from 'react';
import { saveToken, getToken, deleteToken } from '../utils/storage';
import apiClient from '../api/client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [institution, setInstitution] = useState(null);
  // Session auto-resume is intentionally disabled — every app launch starts at
  // Welcome. We still flash a brief loading state while we wipe any stale token
  // from a previous session so the API client doesn't send a zombie Bearer
  // header on the first request after launch.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await deleteToken();
      } catch (err) {
        console.log('Could not clear stale token:', err?.message || err);
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
