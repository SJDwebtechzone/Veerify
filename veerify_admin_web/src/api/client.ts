import axios from 'axios';

// const API_BASE_URL = 'http://localhost:5000/api';
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auto-attach token to every request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('veerify-admin-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-handle 401 (token expired)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('veerify-admin-token');
      localStorage.removeItem('veerify-admin-user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;