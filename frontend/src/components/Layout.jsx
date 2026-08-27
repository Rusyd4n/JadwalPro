import { useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, Calendar, ClipboardList, Grid3x3, Eye, LogOut, GraduationCap } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";

const NAV = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { path: "/teachers", label: "Data Guru", icon: Users, testid: "nav-teachers" },
  { path: "/availability", label: "Availability Matrix", icon: Grid3x3, testid: "nav-availability" },
  { path: "/assignments", label: "Teaching Load", icon: ClipboardList, testid: "nav-assignments" },
  { path: "/schedule", label: "Schedule Builder", icon: Calendar, testid: "nav-schedule" },
  { path: "/views", label: "Views & Export", icon: Eye, testid: "nav-views" },
];

export default function Layout({ user, children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* ignore */ }
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col shrink-0 no-print">
        <div className="px-6 pt-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md bg-emerald-500 flex items-center justify-center">
              <GraduationCap size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-semibold tracking-tight">EduSchedule AI</div>
              <div className="text-[11px] text-slate-400">MA Persis Katapang</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {NAV.map((item) => {
            const active = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                data-testid={item.testid}
                onClick={() => navigate(item.path)}
                className={`w-full text-left px-3 py-2.5 rounded-md flex items-center gap-3 text-sm transition-colors duration-150 ${
                  active
                    ? "bg-emerald-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center gap-3 px-3 py-2">
            {user?.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{user?.name || "Admin"}</div>
              <div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
            </div>
          </div>
          <Button
            data-testid="logout-btn"
            onClick={logout}
            variant="ghost"
            className="w-full mt-1 text-slate-300 hover:text-white hover:bg-slate-800 justify-start gap-2"
          >
            <LogOut size={14} /> Keluar
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden print-container">{children}</main>
    </div>
  );
}
