import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, BookOpen, Edit3, Download, Upload, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

const COLOR_OPTIONS = [
  "#059669", "#0EA5E9", "#F59E0B", "#8B5CF6", "#10B981",
  "#EF4444", "#EC4899", "#F97316", "#3B82F6", "#84CC16",
];

export default function Subjects() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", color: "#059669" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleOne = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelected((prev) => (prev.length === items.length && items.length > 0 ? [] : items.map((s) => s.id)));

  const load = async () => {
    const r = await api.get("/subjects");
    setItems(r.data);
    setSelected([]);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", code: "", color: "#059669" });
    setOpen(true);
  };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, code: s.code || "", color: s.color || "#059669" });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Nama wajib diisi"); return; }
    try {
      if (editing) {
        await api.put(`/subjects/${editing.id}`, { ...editing, ...form });
        toast.success("Mata pelajaran diperbarui");
      } else {
        await api.post("/subjects", form);
        toast.success("Mata pelajaran ditambahkan");
      }
      setOpen(false);
      load();
    } catch (e) { toast.error("Gagal menyimpan"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Hapus mata pelajaran? Assignments & jadwal terkait ikut terhapus.")) return;
    await api.delete(`/subjects/${id}`);
    toast.success("Terhapus");
    load();
  };

  const bulkRemove = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`Hapus ${selected.length} mapel terpilih? Assignments & jadwal terkait ikut terhapus.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/subjects/bulk-delete", { ids: selected });
      toast.success(`${res.data.deleted_subjects} mapel dihapus`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal hapus massal");
    } finally {
      setBulkDeleting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get("/subjects/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "template_subjects.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Template diunduh. Isi kolom nama, kode, warna.");
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
      const res = await api.post("/subjects/upload", fd, {
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
          <h1 className="text-3xl font-bold tracking-tight">Mata Pelajaran</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola daftar subjek yang diajarkan di madrasah</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            data-testid="upload-subjects-template-input"
            onChange={handleUpload}
          />
          <Button data-testid="download-subjects-template-btn" variant="outline" onClick={downloadTemplate}>
            <Download size={16} className="mr-2" /> Unduh Template
          </Button>
          <Button
            data-testid="upload-subjects-template-btn"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <FileUp size={16} className="mr-2 animate-pulse" /> : <Upload size={16} className="mr-2" />}
            {uploading ? "Mengunggah..." : "Unggah Template"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-subject-btn" onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus size={16} className="mr-2" /> Tambah Mata Pelajaran
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Mata Pelajaran" : "Mata Pelajaran Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Nama</Label>
                <Input
                  data-testid="subject-name-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Matematika"
                />
              </div>
              <div>
                <Label>Kode</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="MTK"
                />
              </div>
              <div>
                <Label>Warna</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      data-testid={`color-${c}`}
                      onClick={() => setForm({ ...form, color: c })}
                      className={`w-8 h-8 rounded-md border-2 transition-transform duration-150 ${
                        form.color === c ? "border-slate-900 scale-110" : "border-transparent"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button data-testid="save-subject-btn" onClick={save} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {items.length > 0 && (
        <div data-testid="bulk-bar" className="flex items-center gap-3 mb-3 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm">
          <Checkbox
            data-testid="select-all"
            checked={selected.length === items.length ? true : selected.length > 0 ? "indeterminate" : false}
            onCheckedChange={toggleAll}
          />
          <span className="text-slate-600">
            {selected.length > 0 ? `${selected.length} dipilih` : "Pilih semua"}
          </span>
          {selected.length > 0 && (
            <>
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
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.length === 0 && (
          <div className="col-span-full text-center text-slate-400 py-12">
            Belum ada mata pelajaran. Klik "Muat Data Awal" di Dashboard.
          </div>
        )}
        {items.map((s) => (
          <div
            key={s.id}
            data-testid={`subject-${s.id}`}
            className={`bg-white border rounded-lg p-4 group relative overflow-hidden transition-colors duration-150 ${selected.includes(s.id) ? "border-red-400 ring-1 ring-red-200" : "border-slate-200"}`}
          >
            <div className="absolute top-0 left-0 h-1 w-full" style={{ background: s.color }} />
            <div className="flex items-start gap-3">
              <Checkbox
                data-testid={`select-subject-${s.id}`}
                checked={selected.includes(s.id)}
                onCheckedChange={() => toggleOne(s.id)}
                className="mt-1"
              />
              <div
                className="w-10 h-10 rounded-md flex items-center justify-center text-white shrink-0"
                style={{ background: s.color }}
              >
                <BookOpen size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 truncate">{s.name}</div>
                <div className="text-xs text-slate-500 font-mono uppercase mt-0.5">{s.code || "—"}</div>
              </div>
              <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <button
                  data-testid={`edit-subject-${s.id}`}
                  onClick={() => openEdit(s)}
                  className="p-1.5 hover:bg-slate-100 rounded"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  data-testid={`delete-subject-${s.id}`}
                  onClick={() => remove(s.id)}
                  className="p-1.5 hover:bg-red-50 text-red-600 rounded"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
