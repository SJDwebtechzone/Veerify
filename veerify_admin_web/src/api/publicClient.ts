import axios from 'axios';

// A bare-bones axios instance for public endpoints that do NOT require
// authentication (e.g. published legal pages).  It shares the same base URL
// as apiClient but intentionally has NO 401-redirect interceptor so that
// unauthenticated visitors can reach these pages without being sent to /login.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const publicClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default publicClient;
