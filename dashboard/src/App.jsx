import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RedirectToSignIn, useAuth } from "@clerk/react";
import { setTokenGetter } from "./lib/api.js";
import Layout         from "./components/Layout.jsx";
import LoginPage      from "./pages/LoginPage.jsx";
import DashboardPage  from "./pages/DashboardPage.jsx";
import DevicesPage    from "./pages/DevicesPage.jsx";
import ViolationsPage from "./pages/ViolationsPage.jsx";
import BlocklistPage  from "./pages/BlocklistPage.jsx";
import EnrolPage      from "./pages/EnrolPage.jsx";

/**
 * Bridges Clerk's async getToken into api.js so the axios interceptor
 * can attach the session Bearer token to every request.
 * Must render inside ClerkProvider (which wraps App in main.jsx).
 */
function ClerkTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

/** Route guard — Clerk v6: useAuth() replaces removed SignedIn/SignedOut components. */
function RequireAuth({ children }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <RedirectToSignIn />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ClerkTokenBridge />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index                element={<DashboardPage />} />
          <Route path="devices"       element={<DevicesPage />} />
          <Route path="violations"    element={<ViolationsPage />} />
          <Route path="blocklist"     element={<BlocklistPage />} />
          <Route path="enrol"         element={<EnrolPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
