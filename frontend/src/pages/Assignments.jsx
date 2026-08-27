import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const load = async () => {
    const [a, t, s, c] = await Promise.all([
      api.get("/assignments"), api.get("/teachers"), api.get("/subjects"), api.get("/classes"),
    ]);
    setAssignments(a.data); setTeachers(t.data); setSubjects(s.data); setClasses(c.data);
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

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teaching Load</h1>
          <p className="text-sm text-slate-500 mt-1">Alokasikan mata pelajaran ke guru dan kelas beserta jumlah JP per minggu</p>
        </div>
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
                  <SelectContent className="bg-white">{teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Guru</th>
              <th className="p-3">Mata Pelajaran</th>
              <th className="p-3">Kelas</th>
              <th className="p-3">JP/Minggu</th>
              <th className="p-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">
                <ClipboardList className="mx-auto mb-2 text-slate-300" size={24} />
                Belum ada penugasan.
              </td></tr>
            )}
            {assignments.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-150">
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
