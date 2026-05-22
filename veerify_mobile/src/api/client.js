import axios from 'axios';
import { getToken } from '../utils/storage';

// 🔥 IMPORTANT: Replace with YOUR laptop's IP
// For Android emulator, use: http://10.0.2.2:5000/api
// For physical device, use: http://192.168.1.5:5000/api (your actual IP)
const API_BASE_URL = 'http://10.0.2.2:5000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Auto-attach token to every request
apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (err) {
    console.error('Token retrieval error:', err);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.log('API Error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.log('Network Error: cannot reach backend');
    }
    return Promise.reject(error);
  }
);

export default apiClient;