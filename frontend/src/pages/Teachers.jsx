import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, Edit3, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    slots.forEach((s) => { av[`${d}-${s}`] = "available"; });
  });
  return av;
}

export default function Teachers() {
  const [teachers, setTeachers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", whatsapp: "", max_hours_per_week: 24, notes: "" });

  const load = async () => {
    const r = await api.get("/teachers");
    setTeachers(r.data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", email: "", whatsapp: "", max_hours_per_week: 24, notes: "" });
    setOpen(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ name: t.name, email: t.email || "", whatsapp: t.whatsapp || "", max_hours_per_week: t.max_hours_per_week, notes: t.notes || "" });
    setOpen(true);
  };
  const save = async () => {
    if (!form.name.trim()) { toast.error("Nama wajib diisi"); return; }
    try {
      if (editing) {
        await api.put(`/teachers/${editing.id}`, { ...editing, ...form });
        toast.success("Guru diperbarui");
      } else {
        await api.post("/teachers", { ...form, availability: emptyAvailability() });
        toast.success("Guru ditambahkan");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error("Gagal menyimpan");
    }
  };
  const remove = async (id) => {
    if (!window.confirm("Hapus guru ini? Semua penugasan terkait akan ikut terhapus.")) return;
    await api.delete(`/teachers/${id}`);
    toast.success("Guru dihapus");
    load();
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Guru</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola daftar guru, kontak, dan beban maksimal per minggu</p>
        </div>
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
              <div>
                <Label>Nama Lengkap</Label>
                <Input data-testid="teacher-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Drs. ..." />
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
                <Label>Maks. JP/minggu</Label>
                <Input type="number" value={form.max_hours_per_week} onChange={(e) => setForm({ ...form, max_hours_per_week: parseInt(e.target.value || "0", 10) })} />
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="p-3">Nama</th>
              <th className="p-3">Kontak</th>
              <th className="p-3">Maks JP</th>
              <th className="p-3">Catatan</th>
              <th className="p-3 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {teachers.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada guru. Klik "Muat Data Awal" di dashboard.</td></tr>
            )}
            {teachers.map((t) => (
              <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150">
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
                <td className="p-3 font-mono text-slate-700">{t.max_hours_per_week}</td>
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
