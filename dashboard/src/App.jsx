import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore.js";
import Layout        from "./components/Layout.jsx";
import LoginPage     from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import DevicesPage   from "./pages/DevicesPage.jsx";
import ViolationsPage from "./pages/ViolationsPage.jsx";
import BlocklistPage from "./pages/BlocklistPage.jsx";
import EnrolPage     from "./pages/EnrolPage.jsx";

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
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
