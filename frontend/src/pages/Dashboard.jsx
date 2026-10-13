import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Users, Calendar, AlertTriangle, TrendingUp, Sparkles, Database, FileSpreadsheet, Download, Upload, FileUp, ArchiveRestore, HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  const [wbUploading, setWbUploading] = useState(false);
  const wbFileRef = useRef(null);
  const [wbResult, setWbResult] = useState(null);
  const restoreFileRef = useRef(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);

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

  const downloadUnifiedTemplate = async () => {
    try {
      const res = await api.get("/import/template.xlsx", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "template_import_jadwal.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Template terpadu diunduh (Guru + Mapel + Kelas + Penugasan_Matrix).");
    } catch (e) {
      toast.error("Gagal mengunduh template terpadu");
    }
  };

  const handleWorkbookUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.xlsx?m?$/.test(file.name.toLowerCase())) {
      toast.error("File harus berformat .xlsx (gunakan Template Terpadu)");
      e.target.value = "";
      return;
    }
    setWbUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/import/workbook", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setWbResult(res.data);
      const s = res.data?.summary;
      const total = ["guru", "mapel", "kelas", "penugasan"].reduce(
        (n, k) => n + (s?.[k]?.added || 0) + (s?.[k]?.updated || 0), 0
      );
      if ((res.data?.errors || []).length > 0) {
        toast.warning(`Impor selesai dengan ${(res.data.errors || []).length} baris bermasalah. Lihat rincian.`, { duration: 6000 });
      } else {
        toast.success(`Impor terpadu berhasil: ${total} data diproses`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal mengunggah workbook");
    } finally {
      setWbUploading(false);
      e.target.value = "";
    }
  };

  const downloadBackup = async () => {
    try {
      const res = await api.get("/backup");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jadwalpro_backup_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Backup diunduh (guru + availability + mapel + kelas + penugasan + jadwal + konfigurasi hari).");
    } catch (e) {
      toast.error("Gagal mengunduh backup");
    }
  };

  const pickRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      toast.error("File harus berformat .json (hasil Unduh Backup)");
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = payload?.data;
      if (!data || typeof data !== "object") throw new Error("bad format");
      const counts = Object.fromEntries(
        Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])
      );
      if (Object.keys(counts).length === 0) throw new Error("empty");
      setPendingRestore({ file, name: file.name, exported_at: payload.exported_at, counts });
      setRestoreConfirm("");
    } catch (err) {
      toast.error("File backup tidak valid");
    }
  };

  const doRestore = async () => {
    if (!pendingRestore || restoreConfirm !== "RESTORE") return;
    setRestoring(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingRestore.file);
      const res = await api.post("/restore", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const r = res.data?.restored || {};
      const total = Object.values(r).reduce((n, v) => n + (v || 0), 0);
      if ((res.data?.errors || []).length > 0) {
        toast.warning(`Restore selesai (${total} dokumen) dengan ${res.data.errors.length} item dilewati.`, { duration: 6000 });
      } else {
        toast.success(`Restore berhasil: ${total} dokumen dikembalikan`);
      }
      setPendingRestore(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Restore gagal");
    } finally {
      setRestoring(false);
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <FileSpreadsheet size={18} />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="font-semibold text-emerald-900">Impor Terpadu — 1 file untuk semua</div>
            <div className="text-xs text-emerald-800 mt-0.5">
              Unduh template .xlsx (Guru + Mapel + Kelas + Penugasan_Matrix), isi sekaligus, lalu unggah sekali.
            </div>
          </div>
          <input
            ref={wbFileRef}
            type="file"
            accept=".xlsx,.xlsm"
            className="hidden"
            data-testid="upload-workbook-input"
            onChange={handleWorkbookUpload}
          />
          <Button data-testid="download-workbook-template-btn" variant="outline" className="bg-white" onClick={downloadUnifiedTemplate}>
            <Download size={16} className="mr-2" /> Template (.xlsx)
          </Button>
          <Button
            data-testid="upload-workbook-btn"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={wbUploading}
            onClick={() => wbFileRef.current?.click()}
          >
            {wbUploading ? <FileUp size={16} className="mr-2 animate-pulse" /> : <Upload size={16} className="mr-2" />}
            {wbUploading ? "Mengunggah..." : "Unggah (.xlsx)"}
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ArchiveRestore size={18} />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="font-semibold text-slate-900">Backup & Restore</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Simpan seluruh data + pengaturan (termasuk availability) ke 1 file JSON, dan kembalikan kapan pun.
            </div>
          </div>
          <input
            ref={restoreFileRef}
            type="file"
            accept=".json"
            className="hidden"
            data-testid="restore-file-input"
            onChange={pickRestoreFile}
          />
          <Button data-testid="download-backup-btn" variant="outline" onClick={downloadBackup}>
            <HardDriveDownload size={16} className="mr-2" /> Backup
          </Button>
          <Button
            data-testid="restore-backup-btn"
            variant="outline"
            className="border-amber-200 text-amber-700 hover:bg-amber-50"
            onClick={() => restoreFileRef.current?.click()}
          >
            <Upload size={16} className="mr-2" /> Restore
          </Button>
        </div>
      </div>

      <Dialog open={!!wbResult} onOpenChange={(v) => { if (!v) setWbResult(null); }}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Hasil Impor Terpadu</DialogTitle>
          </DialogHeader>
          {wbResult && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {["guru", "mapel", "kelas", "penugasan"].map((k) => (
                  <div key={k} className="border border-slate-200 rounded-md p-2.5">
                    <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{k}</div>
                    <div className="mt-1 font-mono text-slate-800">
                      +{wbResult.summary?.[k]?.added || 0} baru · ~{wbResult.summary?.[k]?.updated || 0} diperbarui
                    </div>
                  </div>
                ))}
              </div>
              {(wbResult.errors || []).length > 0 ? (
                <div>
                  <div className="text-xs font-semibold text-amber-700 mb-1">
                    {wbResult.errors.length} baris bermasalah (menampilkan 10 pertama):
                  </div>
                  <ul className="max-h-48 overflow-y-auto text-xs space-y-1 bg-amber-50 border border-amber-200 rounded-md p-2">
                    {wbResult.errors.slice(0, 10).map((er, i) => (
                      <li key={i} className="text-amber-900">
                        <span className="font-mono">{er.sheet} #{er.row}:</span> {er.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-emerald-700 text-xs">Semua baris berhasil diproses tanpa error.</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setWbResult(null)} className="bg-emerald-600 hover:bg-emerald-700 text-white">Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingRestore} onOpenChange={(v) => { if (!v) setPendingRestore(null); }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-700">Restore dari Backup?</DialogTitle>
          </DialogHeader>
          {pendingRestore && (
            <div className="space-y-3 py-2 text-sm text-slate-600">
              <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5 font-mono text-xs">
                <div className="truncate">{pendingRestore.name}</div>
                {pendingRestore.exported_at && <div className="text-slate-400">Diekspor: {pendingRestore.exported_at}</div>}
                <div className="mt-1">
                  {Object.entries(pendingRestore.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}
                </div>
              </div>
              <p>
                Data saat ini pada koleksi tersebut akan <strong>diganti seluruhnya</strong>.
                Ketik <code className="px-1.5 py-0.5 bg-slate-100 rounded font-mono text-xs">RESTORE</code> untuk mengonfirmasi.
              </p>
              <div>
                <Label>Konfirmasi</Label>
                <Input
                  data-testid="restore-confirm-input"
                  value={restoreConfirm}
                  onChange={(e) => setRestoreConfirm(e.target.value)}
                  placeholder="RESTORE"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRestore(null)}>Batal</Button>
            <Button
              data-testid="restore-confirm-btn"
              onClick={doRestore}
              disabled={restoreConfirm !== "RESTORE" || restoring}
              className="bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
            >
              {restoring ? "Memulihkan..." : "Ya, Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
