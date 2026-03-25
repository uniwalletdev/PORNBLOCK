/**
 * authStore.js — no longer used for session management (Clerk handles auth).
 * Kept as a no-op module so any stray imports don't cause build errors.
 */
export const useAuthStore = () => ({});
export function setAuth() {}
export function logout() {}
