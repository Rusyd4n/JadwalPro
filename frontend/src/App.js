import { useEffect, useState, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, Outlet } from "react-router-dom";
import api from "@/lib/api";
import { Toaster } from "@/components/ui/sonner";
import { ConfigProvider } from "@/lib/scheduleConfig";

import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Teachers from "@/pages/Teachers";
import Availability from "@/pages/Availability";
import Assignments from "@/pages/Assignments";
import ScheduleBuilder from "@/pages/ScheduleBuilder";
import Views from "@/pages/Views";
import Subjects from "@/pages/Subjects";
import Classes from "@/pages/Classes";
import Config from "@/pages/Config";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH

function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    const hash = location.hash || "";
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = match[1];
    (async () => {
      try {
        const r = await api.post("/auth/session", { session_id });
        window.history.replaceState(null, "", "/dashboard");
        navigate("/dashboard", { replace: true, state: { user: r.data.user } });
      } catch (e) {
        navigate("/login", { replace: true });
      }
    })();
  }, [location, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-slate-600 text-sm">Menyiapkan sesi...</div>
    </div>
  );
}

function ProtectedShell() {
  const [state, setState] = useState({ auth: null, user: null });

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/auth/me");
        setState({ auth: true, user: r.data });
      } catch (e) {
        setState({ auth: false, user: null });
      }
    })();
  }, []);

  if (state.auth === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 text-sm">Memuat...</div>
      </div>
    );
  }
  if (!state.auth) return <Navigate to="/login" replace />;
  return (
    <ConfigProvider>
      <Layout user={state.user}>
        <Outlet />
      </Layout>
    </ConfigProvider>
  );
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/teachers" element={<Teachers />} />
        <Route path="/subjects" element={<Subjects />} />
        <Route path="/classes" element={<Classes />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/assignments" element={<Assignments />} />
        <Route path="/schedule" element={<ScheduleBuilder />} />
        <Route path="/views" element={<Views />} />
        <Route path="/config" element={<Config />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRouter />
      <Toaster richColors position="top-right" closeButton />
    </BrowserRouter>
  );
}

export default App;
