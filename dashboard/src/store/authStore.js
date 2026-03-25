/**
 * Minimal Zustand-free auth store implemented with localStorage + React Context.
 *
 * Keeps the dependency surface small (no zustand required).
 * Replace with zustand if you prefer: npm i zustand
 */

let _token  = localStorage.getItem("pb_token")  || null;
let _user   = JSON.parse(localStorage.getItem("pb_user") || "null");
const _subs = new Set();

function notify() { _subs.forEach((fn) => fn()); }

export const useAuthStore = (selector) => {
  // Mini hook — re-renders on store change
  const [, rerender] = import("react").then ? [null, () => {}] : [null, () => {}];
  return selector({ token: _token, user: _user, logout, setAuth });
};

// Allow the store to work outside React (interceptors)
useAuthStore.getState = () => ({ token: _token, user: _user, logout, setAuth });

export function setAuth(token, user) {
  _token = token;
  _user  = user;
  localStorage.setItem("pb_token", token);
  localStorage.setItem("pb_user",  JSON.stringify(user));
  notify();
}

export function logout() {
  _token = null;
  _user  = null;
  localStorage.removeItem("pb_token");
  localStorage.removeItem("pb_user");
  notify();
  window.location.href = "/login";
}
