import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, ClipboardList, Download, Upload, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ teacher_id: "", subject_id: "", class_id: "", hours_per_week: 2 });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleOne = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelected((prev) => (prev.length === assignments.length && assignments.length > 0 ? [] : assignments.map((a) => a.id)));

  const load = async () => {
    const [a, t, s, c] = await Promise.all([
      api.get("/assignments"), api.get("/teachers"), api.get("/subjects"), api.get("/classes"),
    ]);
    setAssignments(a.data); setTeachers(t.data); setSubjects(s.data); setClasses(c.data);
    setSelected([]);
  };
  useEffect(() => { load(); }, []);

  const nameOf = (arr, id) => arr.find((x) => x.id === id)?.name || "—";

  const save = async () => {
    if (!form.teacher_id || !form.subject_id || !form.class_id) { toast.error("Lengkapi semua field"); return; }
    try {
      await api.post("/assignments", form);
      toast.success("Penugasan ditambahkan");
      setOpen(false);
      setForm({ teacher_id: "", subject_id: "", class_id: "", hours_per_week: 2 });
      load();
    } catch (e) { toast.error("Gagal menyimpan"); }
  };
  const remove = async (id) => {
    await api.delete(`/assignments/${id}`);
    toast.success("Penugasan dihapus");
    load();
  };

  const bulkRemove = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`Hapus ${selected.length} penugasan terpilih?`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/assignments/bulk-delete", { ids: selected });
      toast.success(`${res.data.deleted} penugasan dihapus`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal hapus massal");
    } finally {
      setBulkDeleting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get("/assignments/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "template_assignments.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Template diunduh. Isi kolom nama_guru, mata_pelajaran, kelas, jp_per_minggu.");
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
      const res = await api.post("/assignments/upload", fd, {
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
          <h1 className="text-3xl font-bold tracking-tight">Teaching Load</h1>
          <p className="text-sm text-slate-500 mt-1">Alokasikan mata pelajaran ke guru dan kelas beserta jumlah JP per minggu</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            data-testid="upload-template-input"
            onChange={handleUpload}
          />
          <Button data-testid="download-template-btn" variant="outline" onClick={downloadTemplate}>
            <Download size={16} className="mr-2" /> Unduh Template
          </Button>
          <Button
            data-testid="upload-template-btn"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <FileUp size={16} className="mr-2 animate-pulse" /> : <Upload size={16} className="mr-2" />}
            {uploading ? "Mengunggah..." : "Unggah Template"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-assignment-btn" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus size={16} className="mr-2" /> Tambah Penugasan
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle>Penugasan Baru</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Guru</Label>
                <Select value={form.teacher_id} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
                  <SelectTrigger data-testid="assign-teacher-select" className="bg-white"><SelectValue placeholder="Pilih guru..." /></SelectTrigger>
                  <SelectContent className="bg-white">{teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.nomor ? `${t.nomor}. ` : ""}{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mata Pelajaran</Label>
                <Select value={form.subject_id} onValueChange={(v) => setForm({ ...form, subject_id: v })}>
                  <SelectTrigger data-testid="assign-subject-select" className="bg-white"><SelectValue placeholder="Pilih mata pelajaran..." /></SelectTrigger>
                  <SelectContent className="bg-white">{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Kelas</Label>
                <Select value={form.class_id} onValueChange={(v) => setForm({ ...form, class_id: v })}>
                  <SelectTrigger data-testid="assign-class-select" className="bg-white"><SelectValue placeholder="Pilih kelas..." /></SelectTrigger>
                  <SelectContent className="bg-white">{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>JP per Minggu</Label>
                <Input data-testid="assign-hours-input" type="number" min={1} max={12} value={form.hours_per_week} onChange={(e) => setForm({ ...form, hours_per_week: parseInt(e.target.value || "0", 10) })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button data-testid="save-assignment-btn" onClick={save} className="bg-emerald-600 hover:bg-emerald-700 text-white">Simpan</Button>
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
          <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3 w-10">
                <Checkbox
                  data-testid="select-all"
                  checked={assignments.length > 0 && selected.length === assignments.length ? true : selected.length > 0 ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="p-3">Guru</th>
              <th className="p-3">Mata Pelajaran</th>
              <th className="p-3">Kelas</th>
              <th className="p-3">JP/Minggu</th>
              <th className="p-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">
                <ClipboardList className="mx-auto mb-2 text-slate-300" size={24} />
                Belum ada penugasan.
              </td></tr>
            )}
            {assignments.map((a) => (
              <tr key={a.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150 ${selected.includes(a.id) ? "bg-red-50/50" : ""}`}>
                <td className="p-3">
                  <Checkbox
                    data-testid={`select-assignment-${a.id}`}
                    checked={selected.includes(a.id)}
                    onCheckedChange={() => toggleOne(a.id)}
                  />
                </td>
                <td className="p-3 font-medium text-slate-900">{nameOf(teachers, a.teacher_id)}</td>
                <td className="p-3 text-slate-700">{nameOf(subjects, a.subject_id)}</td>
                <td className="p-3"><span className="px-2 py-0.5 rounded bg-slate-100 text-xs font-mono">{nameOf(classes, a.class_id)}</span></td>
                <td className="p-3 font-mono text-slate-700">{a.hours_per_week} JP</td>
                <td className="p-3 text-right">
                  <button data-testid={`delete-assignment-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors duration-150"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}