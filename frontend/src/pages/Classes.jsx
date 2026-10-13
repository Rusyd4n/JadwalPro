import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, Users2, Edit3, Download, Upload, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function Classes() {
  const [items, setItems] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", grade: "X", wali_kelas_id: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleOne = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () =>
    setSelected((prev) => (prev.length === items.length && items.length > 0 ? [] : items.map((c) => c.id)));

  const load = async () => {
    const [c, t] = await Promise.all([api.get("/classes"), api.get("/teachers")]);
    setItems(c.data);
    setTeachers([...t.data].sort((a, b) => (a.nomor ?? 9999) - (b.nomor ?? 9999)));
    setSelected([]);
  };
  useEffect(() => { load(); }, []);

  const teacherLabel = (id) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.nomor ? `${t.nomor}. ` : ""}${t.name}` : "—";
  };

  const openNew = () => { setEditing(null); setForm({ name: "", grade: "X", wali_kelas_id: "" }); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, grade: c.grade, wali_kelas_id: c.wali_kelas_id || "" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Nama wajib diisi"); return; }
    try {
      if (editing) {
        await api.put(`/classes/${editing.id}`, { ...editing, ...form });
        toast.success("Kelas diperbarui");
      } else {
        await api.post("/classes", form);
        toast.success("Kelas ditambahkan");
      }
      setOpen(false);
      load();
    } catch (e) { toast.error("Gagal menyimpan"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Hapus kelas? Assignments & jadwal terkait ikut terhapus.")) return;
    await api.delete(`/classes/${id}`);
    toast.success("Terhapus");
    load();
  };

  const bulkRemove = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`Hapus ${selected.length} kelas terpilih? Assignments & jadwal terkait ikut terhapus.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/classes/bulk-delete", { ids: selected });
      toast.success(`${res.data.deleted_classes} kelas dihapus`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal hapus massal");
    } finally {
      setBulkDeleting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get("/classes/template", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "template_classes.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Template diunduh. Isi kolom nama, tingkat (X/XI/XII), wali_kelas (nomor/nama guru).");
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
      const res = await api.post("/classes/upload", fd, {
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

  const grouped = { X: [], XI: [], XII: [] };
  items.forEach((c) => {
    if (!grouped[c.grade]) grouped[c.grade] = [];
    grouped[c.grade].push(c);
  });

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kelas</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola daftar rombel per tingkat</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            data-testid="upload-classes-template-input"
            onChange={handleUpload}
          />
          <Button data-testid="download-classes-template-btn" variant="outline" onClick={downloadTemplate}>
            <Download size={16} className="mr-2" /> Unduh Template
          </Button>
          <Button
            data-testid="upload-classes-template-btn"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <FileUp size={16} className="mr-2 animate-pulse" /> : <Upload size={16} className="mr-2" />}
            {uploading ? "Mengunggah..." : "Unggah Template"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-class-btn" onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus size={16} className="mr-2" /> Tambah Kelas
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Kelas" : "Kelas Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Nama Kelas</Label>
                <Input
                  data-testid="class-name-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="X-1"
                />
              </div>
              <div>
                <Label>Tingkat</Label>
                <Select value={form.grade} onValueChange={(v) => setForm({ ...form, grade: v })}>
                  <SelectTrigger data-testid="class-grade-select" className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="X">X</SelectItem>
                    <SelectItem value="XI">XI</SelectItem>
                    <SelectItem value="XII">XII</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Wali Kelas</Label>
                <Select value={form.wali_kelas_id || "__none__"} onValueChange={(v) => setForm({ ...form, wali_kelas_id: v === "__none__" ? "" : v })}>
                  <SelectTrigger data-testid="class-wali-select" className="bg-white"><SelectValue placeholder="Pilih wali kelas..." /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="__none__">— Tanpa wali kelas —</SelectItem>
                    {teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.nomor ? `${t.nomor}. ` : ""}{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button data-testid="save-class-btn" onClick={save} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {items.length > 0 && (
        <div data-testid="bulk-bar" className="flex items-center gap-3 mb-4 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm">
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

      <div className="space-y-6">
        {Object.entries(grouped).map(([grade, list]) => (
          <div key={grade}>
            <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
              Tingkat {grade}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {list.length === 0 && <div className="text-slate-400 text-sm">Tidak ada kelas.</div>}
              {list.map((c) => (
                <div
                  key={c.id}
                  data-testid={`class-${c.id}`}
                  className={`bg-white border rounded-lg p-4 group relative transition-colors duration-150 ${selected.includes(c.id) ? "border-red-400 ring-1 ring-red-200" : "border-slate-200"}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      data-testid={`select-class-${c.id}`}
                      checked={selected.includes(c.id)}
                      onCheckedChange={() => toggleOne(c.id)}
                      className="mt-1"
                    />
                    <div className="w-10 h-10 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                      <Users2 size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Tingkat {c.grade}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={teacherLabel(c.wali_kelas_id)}>
                        Wali: {c.wali_kelas_id ? teacherLabel(c.wali_kelas_id) : <span className="text-slate-400">—</span>}
                      </div>
                    </div>
                    <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        data-testid={`edit-class-${c.id}`}
                        onClick={() => openEdit(c)}
                        className="p-1.5 hover:bg-slate-100 rounded"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        data-testid={`delete-class-${c.id}`}
                        onClick={() => remove(c.id)}
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
        ))}
      </div>
    </div>
  );
}
