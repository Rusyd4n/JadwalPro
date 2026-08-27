import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Users, Calendar, AlertTriangle, TrendingUp, Sparkles, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function StatCard({ label, value, icon: Icon, tone, testid, sub }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    red: "bg-red-50 text-red-700 border-red-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
  };
  return (
    <div data-testid={testid} className="bg-white border border-slate-200 rounded-lg p-5 flex items-start justify-between">
      <div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
        <div className="text-3xl font-semibold mt-2 text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      </div>
      <div className={`p-2.5 rounded-md border ${tones[tone] || tones.slate}`}>
        <Icon size={18} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [s, c] = await Promise.all([api.get("/dashboard/stats"), api.get("/schedule/conflicts")]);
      setStats(s.data);
      setConflicts(c.data);
    } catch (e) { /* noop */ }
  };

  useEffect(() => { load(); }, []);

  const runSeed = async () => {
    setLoading(true);
    try {
      await api.post("/seed", {});
      toast.success("Data awal berhasil dimuat");
      load();
    } catch (e) {
      toast.error("Gagal memuat seed data");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Ringkasan penjadwalan Madrasah Aliyah Persis Katapang</p>
        </div>
        <Button
          data-testid="seed-btn"
          onClick={runSeed}
          disabled={loading}
          variant="outline"
          className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
        >
          <Database size={14} className="mr-2" /> {loading ? "Memuat..." : "Muat Data Awal"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-teachers" label="Total Guru" value={stats?.total_teachers ?? 0} icon={Users} tone="emerald" />
        <StatCard testid="stat-classes" label="Total Kelas" value={stats?.total_classes ?? 0} icon={Calendar} tone="slate" />
        <StatCard testid="stat-conflicts" label="Konflik Aktif" value={stats?.total_conflicts ?? 0} icon={AlertTriangle} tone={stats?.total_conflicts > 0 ? "red" : "emerald"} />
        <StatCard
          testid="stat-completion"
          label="Completion Rate"
          value={`${stats?.completion_rate ?? 0}%`}
          icon={TrendingUp}
          tone="sky"
          sub={`${stats?.total_scheduled ?? 0} / ${stats?.total_required ?? 0} JP`}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Konflik Terkini</h2>
              <p className="text-xs text-slate-500">Daftar bentrokan yang harus diselesaikan</p>
            </div>
            {conflicts.length > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-medium border border-red-200">
                {conflicts.length} konflik
              </span>
            )}
          </div>
          {conflicts.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Tidak ada konflik saat ini. Sistem aman.
            </div>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {conflicts.slice(0, 15).map((c, idx) => (
                <li key={idx} data-testid={`conflict-item-${idx}`} className="p-3 border-l-4 border-red-500 bg-red-50 rounded-r text-sm text-red-900">
                  <div className="font-medium">{c.type.replace(/_/g, " ")}</div>
                  <div className="text-xs text-red-700 mt-0.5">{c.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-slate-900 text-white rounded-lg p-6">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-emerald-400" />
            <h3 className="font-semibold tracking-tight">Alur Kerja</h3>
          </div>
          <ol className="mt-4 space-y-3 text-sm text-slate-300">
            <li><span className="text-emerald-400 font-mono mr-2">01</span>Tambah guru & atur ketersediaan</li>
            <li><span className="text-emerald-400 font-mono mr-2">02</span>Alokasikan beban mengajar (JP/minggu)</li>
            <li><span className="text-emerald-400 font-mono mr-2">03</span>Klik Auto-Scheduler atau susun manual</li>
            <li><span className="text-emerald-400 font-mono mr-2">04</span>Selesaikan konflik & cetak PDF</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
