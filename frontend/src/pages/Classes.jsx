import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Plus, Trash2, Users2, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function Classes() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", grade: "X" });

  const load = async () => {
    const r = await api.get("/classes");
    setItems(r.data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: "", grade: "X" }); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, grade: c.grade }); setOpen(true); };

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
                  className="bg-white border border-slate-200 rounded-lg p-4 group relative"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                      <Users2 size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Tingkat {c.grade}</div>
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
