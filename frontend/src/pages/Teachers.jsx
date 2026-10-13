import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, Edit3, UserRound, Download, Upload, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DAYS, SLOTS, FRIDAY_ACTIVE_SLOTS } from "@/lib/constants";

function emptyAvailability() {
  const av = {};
  DAYS.forEach((d) => {
    const slots = d === "Friday" ? FRIDAY_ACTIVE_SLOTS : SLOTS;
    slots.forEach((s) => { av[`${d}-${s}`] = "unavailable"; });
  });
  return av;
}

export default function Teachers() {
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ nomor: "", name: "", email: "", whatsapp: "", notes: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleOne = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelected((prev) => (prev.length === teachers.length && teachers.length > 0 ? [] : teachers.map((t) => t.id)));

  const load = async () => {
    const [t, a] = await Promise.all([api.get("/teachers"), api.get("/assignments")]);
    const sorted = [...t.data].sort((x, y) => (x.nomor ?? 9999) - (y.nomor ?? 9999));
    setTeachers(sorted);
    setAssignments(a.data);
    setSelected([]);
  };
  useEffect(() => { load(); }, []);

  const bebanOf = (teacherId) => assignments.filter((a) => a.teacher_id === teacherId)
    .reduce((s, a) => s + (a.hours_per_week || 0), 0);

  const openNew = () => {
    setEditing(null);
    setForm({ nomor: "", name: "", email: "", whatsapp: "", notes: "" });
    setOpen(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ nomor: t.nomor ?? "", name: t.name, email: t.email || "", whatsapp: t.whatsapp || "", notes: t.notes || "" });
    setOpen(true);
  };
  const save = async () => {
    if (!form.name.trim()) { toast.error("Nama wajib diisi"); return; }
    const nomor = form.nomor === "" ? null : parseInt(form.nomor, 10);
    if (form.nomor !== "" && (!Number.isInteger(nomor) || nomor < 1)) { toast.error("Nomor harus bilangan bulat ≥ 1"); return; }
    try {
      if (editing) {
        await api.put(`/teachers/${editing.id}`, { ...editing, ...form, nomor });
        toast.success("Guru diperbarui");
      } else {
        await api.post("/teachers", { ...form, nomor, availability: emptyAvailability() });
        toast.success("Guru ditambahkan");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal menyimpan");
    }
  };
  const remove = async (id) => {
    if (!window.confirm("Hapus guru ini? Semua penugasan terkait akan ikut terhapus.")) return;
    await api.delete(`/teachers/${id}`);
    toast.success("Guru dihapus");
    load();
  };

  const bulkRemove = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`Hapus ${selected.length} guru terpilih? Penugasan & jadwal terkait ikut terhapus.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/teachers/bulk-delete", { ids: selected });
      toast.success(`${res.data.deleted_teachers} guru dihapus`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal hapus massal");
    } finally {
      setBulkDeleting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get("/teachers/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "template_teachers.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Template diunduh. Isi kolom nomor, nama, email, whatsapp, catatan.");
    } catch (e) {
      toast.error("Gagal mengunduh template");
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("File harus berformat .csv (gunakan template)");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/teachers/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const { added = 0, updated = 0, errors = [] } = res.data || {};
      if (errors.length > 0) {
        const preview = errors.slice(0, 3).map((er) => `Baris ${er.row}: ${er.message}`).join("; ");
        toast.warning(`Diimpor: ${added} baru, ${updated} diperbarui. ${errors.length} baris gagal. ${preview}`, { duration: 8000 });
      } else {
        toast.success(`Berhasil impor ${added} baru, ${updated} diperbarui`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gagal mengunggah template");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Guru</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola daftar guru — nomor = primary key (kode guru di jadwal). Beban JP dihitung otomatis dari Teaching Load.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            data-testid="upload-teachers-template-input"
            onChange={handleUpload}
          />
          <Button data-testid="download-teachers-template-btn" variant="outline" onClick={downloadTemplate}>
            <Download size={16} className="mr-2" /> Unduh Template
          </Button>
          <Button
            data-testid="upload-teachers-template-btn"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <FileUp size={16} className="mr-2 animate-pulse" /> : <Upload size={16} className="mr-2" />}
            {uploading ? "Mengunggah..." : "Unggah Template"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-teacher-btn" onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus size={16} className="mr-2" /> Tambah Guru
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Guru" : "Tambah Guru Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Nomor (PK)</Label>
                  <Input data-testid="teacher-nomor-input" type="number" min={1} value={form.nomor} onChange={(e) => setForm({ ...form, nomor: e.target.value })} placeholder="Otomatis" />
                </div>
                <div className="col-span-2">
                  <Label>Nama Lengkap</Label>
                  <Input data-testid="teacher-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Drs. ..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="guru@example.com" />
                </div>
                <div>
                  <Label>WhatsApp</Label>
                  <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="0812..." />
                </div>
              </div>
              <div>
                <Label>Catatan</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Preferensi/keterangan..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button data-testid="save-teacher-btn" onClick={save} className="bg-emerald-600 hover:bg-emerald-700 text-white">Simpan</Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {selected.length > 0 && (
          <div data-testid="bulk-bar" className="flex items-center gap-3 px-3 py-2 bg-red-50 border-b border-red-200 text-sm">
            <span className="font-medium text-red-800">{selected.length} dipilih</span>
            <Button
              data-testid="bulk-delete-btn"
              size="sm"
              disabled={bulkDeleting}
              onClick={bulkRemove}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 size={14} className="mr-1.5" /> {bulkDeleting ? "Menghapus..." : "Hapus Terpilih"}
            </Button>
            <button onClick={() => setSelected([])} className="text-xs text-slate-500 hover:text-slate-800 underline">
              Batal
            </button>
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="p-3 w-10">
                <Checkbox
                  data-testid="select-all"
                  checked={teachers.length > 0 && selected.length === teachers.length ? true : selected.length > 0 ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="p-3 w-16">Nomor</th>
              <th className="p-3">Nama</th>
              <th className="p-3">Kontak</th>
              <th className="p-3">Beban JP</th>
              <th className="p-3">Catatan</th>
              <th className="p-3 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {teachers.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">Belum ada guru. Klik "Muat Data Awal" di dashboard.</td></tr>
            )}
            {teachers.map((t) => (
              <tr key={t.id} data-testid={`teacher-row-${t.id}`} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150 ${selected.includes(t.id) ? "bg-red-50/50" : ""}`}>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    data-testid={`select-teacher-${t.id}`}
                    checked={selected.includes(t.id)}
                    onCheckedChange={() => toggleOne(t.id)}
                  />
                </td>
                <td className="p-3 w-16 font-mono font-semibold text-emerald-700">{t.nomor ?? "—"}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"><UserRound size={14} /></div>
                    <div className="font-medium text-slate-900">{t.name}</div>
                  </div>
                </td>
                <td className="p-3 text-slate-600 text-xs">
                  {t.email && <div>{t.email}</div>}
                  {t.whatsapp && <div>{t.whatsapp}</div>}
                  {!t.email && !t.whatsapp && <span className="text-slate-400">—</span>}
                </td>
                <td className="p-3 font-mono text-slate-700">{bebanOf(t.id)} JP</td>
                <td className="p-3 text-slate-600 text-xs max-w-md">{t.notes || <span className="text-slate-400">—</span>}</td>
                <td className="p-3 text-right">
                  <button data-testid={`edit-teacher-${t.id}`} onClick={() => openEdit(t)} className="p-1.5 hover:bg-slate-100 rounded transition-colors duration-150"><Edit3 size={14} /></button>
                  <button data-testid={`delete-teacher-${t.id}`} onClick={() => remove(t.id)} className="p-1.5 hover:bg-red-50 text-red-600 rounded ml-1 transition-colors duration-150"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
