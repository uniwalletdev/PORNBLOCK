import axios from "axios";

// Clerk's getToken is async — it's injected by ClerkTokenBridge in App.jsx
// so we never call Clerk hooks outside React.
let _getToken = () => Promise.resolve(null);
export function setTokenGetter(fn) { _getToken = fn; }

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 15_000,
});

// Attach Clerk session token to every request.
api.interceptors.request.use(async (config) => {
  try {
    const token = await _getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {
    // Not signed in — request goes without auth header.
  }
  return config;
});

// Clerk manages session refresh automatically, so we just propagate the error.
api.interceptors.response.use(
  (res) => res,
  (err) => Promise.reject(err),
);

export default api;
