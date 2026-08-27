import { useEffect, useState, useMemo } from "react";
import api from "@/lib/api";
import { DAYS, DAY_ID, SLOTS, FRIDAY_ACTIVE_SLOTS, isFridayPrayerSlot, isBreakAfter } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Trash2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

export default function ScheduleBuilder() {
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);

  const loadAll = async () => {
    const [t, s, c, a, sch, cf] = await Promise.all([
      api.get("/teachers"), api.get("/subjects"), api.get("/classes"),
      api.get("/assignments"), api.get("/schedule"), api.get("/schedule/conflicts"),
    ]);
    setTeachers(t.data); setSubjects(s.data); setClasses(c.data);
    setAssignments(a.data); setSchedule(sch.data); setConflicts(cf.data);
    if (!selectedClassId && c.data[0]) setSelectedClassId(c.data[0].id);
  };
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  const teacherMap = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers]);
  const subjectMap = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const classMap = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);

  // Assignments available for this class (only unfilled hours)
  const classAssignments = useMemo(() => {
    return assignments
      .filter((a) => a.class_id === selectedClassId)
      .map((a) => {
        const placed = schedule.filter((s) => s.class_id === a.class_id && s.subject_id === a.subject_id && s.teacher_id === a.teacher_id).length;
        return { ...a, placed, remaining: a.hours_per_week - placed };
      });
  }, [assignments, selectedClassId, schedule]);

  const slotAt = (day, slot) => schedule.find((s) => s.class_id === selectedClassId && s.day === day && s.slot === slot);

  const conflictAt = (day, slot) => {
    return conflicts.find((c) => c.day === day && c.slot === slot && (
      (c.class_ids && c.class_ids.includes(selectedClassId)) ||
      c.class_id === selectedClassId
    ));
  };

  const openPicker = (day, slot) => {
    if (isFridayPrayerSlot(day, slot)) return;
    setPickerSlot({ day, slot });
    setPickerOpen(true);
  };

  const pickAssignment = async (a) => {
    try {
      await api.post("/schedule", {
        id: `sch_${Math.random().toString(16).slice(2, 14)}`,
        class_id: selectedClassId,
        day: pickerSlot.day,
        slot: pickerSlot.slot,
        subject_id: a.subject_id,
        teacher_id: a.teacher_id,
      });
      setPickerOpen(false);
      loadAll();
    } catch (e) { toast.error("Gagal menempatkan slot"); }
  };

  const clearSlot = async (id) => {
    await api.delete(`/schedule/${id}`);
    loadAll();
  };

  const autoSchedule = async () => {
    setAutoLoading(true);
    try {
      const r = await api.post("/schedule/auto", {});
      toast.success(`Auto-scheduler menambahkan ${r.data.added} slot`);
      loadAll();
    } catch (e) { toast.error("Auto-scheduler gagal"); }
    finally { setAutoLoading(false); }
  };

  const clearAll = async () => {
    if (!window.confirm("Bersihkan semua jadwal?")) return;
    await api.post("/schedule/clear", {});
    toast.success("Jadwal dikosongkan");
    loadAll();
  };

  const totalConflictsForClass = conflicts.filter((c) => (c.class_ids && c.class_ids.includes(selectedClassId)) || c.class_id === selectedClassId).length;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedule Builder</h1>
          <p className="text-sm text-slate-500 mt-1">Klik sel kosong untuk menempatkan penugasan. Bentrokan diberi tanda merah.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger data-testid="class-select" className="w-40 bg-white"><SelectValue placeholder="Kelas..." /></SelectTrigger>
            <SelectContent className="bg-white">{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button data-testid="auto-schedule-btn" onClick={autoSchedule} disabled={autoLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Sparkles size={14} className="mr-2" /> {autoLoading ? "Menyusun..." : "Auto-Scheduler"}
          </Button>
          <Button data-testid="clear-schedule-btn" onClick={clearAll} variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
            <Trash2 size={14} className="mr-2" /> Bersihkan
          </Button>
        </div>
      </div>

      {totalConflictsForClass > 0 && (
        <div className="mb-4 p-3 border-l-4 border-red-500 bg-red-50 rounded-r flex items-center gap-2 text-sm text-red-900">
          <AlertTriangle size={16} /> {totalConflictsForClass} konflik terdeteksi pada kelas {classMap[selectedClassId]?.name}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
            <tr>
              <th className="p-2 text-left text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-10 w-24">JP</th>
              {DAYS.map((d) => <th key={d} className="p-2 text-xs uppercase tracking-wide text-slate-500 min-w-[160px]">{DAY_ID[d]}</th>)}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <>
                <tr key={slot} className="border-b border-slate-100">
                  <td className="p-2 sticky left-0 bg-white border-r border-slate-100 font-semibold text-slate-800">JP {slot}</td>
                  {DAYS.map((day) => {
                    const isPrayer = isFridayPrayerSlot(day, slot);
                    if (isPrayer) return <td key={day} className="p-1"><div className="cell-friday-prayer text-center py-3 text-[11px] font-medium rounded">Sholat Jum'at</div></td>;
                    const cell = slotAt(day, slot);
                    const conflict = conflictAt(day, slot);
                    if (cell) {
                      const subject = subjectMap[cell.subject_id];
                      const teacher = teacherMap[cell.teacher_id];
                      return (
                        <td key={day} className="p-1">
                          <div
                            data-testid={`schedule-cell-${day}-${slot}`}
                            className={`relative rounded p-2 text-xs group transition-colors duration-150 ${conflict ? "cell-conflict" : ""}`}
                            style={{ background: conflict ? undefined : (subject?.color || "#059669") + "20", borderLeft: `3px solid ${subject?.color || "#059669"}` }}
                          >
                            <div className="font-semibold text-slate-900 truncate">{subject?.name || "?"}</div>
                            <div className="text-slate-600 text-[11px] truncate">{teacher?.name?.split(",")[0] || "?"}</div>
                            {conflict && <div className="text-red-700 text-[10px] mt-0.5 font-medium">⚠ {conflict.type.replace(/_/g, " ")}</div>}
                            <button
                              onClick={() => clearSlot(cell.id)}
                              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded bg-white hover:bg-red-50 border border-slate-200 transition-opacity duration-150"
                            ><X size={10} /></button>
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={day} className="p-1">
                        <button
                          data-testid={`empty-cell-${day}-${slot}`}
                          onClick={() => openPicker(day, slot)}
                          className="w-full py-3 border border-dashed border-slate-200 rounded text-slate-400 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 text-xs transition-colors duration-150"
                        >+ Tambah</button>
                      </td>
                    );
                  })}
                </tr>
                {isBreakAfter("Monday", slot) && (
                  <tr><td colSpan={DAYS.length + 1} className="cell-break text-center text-xs font-medium py-1.5">{isBreakAfter("Monday", slot)}</td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>
              Tempatkan penugasan — {pickerSlot && DAY_ID[pickerSlot.day]} JP {pickerSlot?.slot}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto py-2">
            {classAssignments.length === 0 && <div className="text-sm text-slate-500 text-center py-6">Belum ada penugasan untuk kelas ini.</div>}
            {classAssignments.map((a) => {
              const teacher = teacherMap[a.teacher_id];
              const key = pickerSlot ? `${pickerSlot.day}-${pickerSlot.slot}` : "";
              const teacherUnavailable = teacher?.availability?.[key] === "unavailable";
              const filled = a.remaining <= 0;
              return (
                <button
                  key={a.id}
                  data-testid={`picker-${a.id}`}
                  onClick={() => pickAssignment(a)}
                  disabled={filled}
                  className={`w-full text-left p-3 border rounded-md transition-colors duration-150 ${
                    teacherUnavailable
                      ? "border-red-200 bg-red-50 hover:bg-red-100"
                      : filled
                      ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                      : "border-slate-200 hover:border-emerald-400 hover:bg-emerald-50"
                  }`}
                >
                  <div className="font-medium text-sm text-slate-900">{subjectMap[a.subject_id]?.name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{teacher?.name}</div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px]">
                    <span className="text-slate-500">Sudah {a.placed}/{a.hours_per_week} JP</span>
                    {teacherUnavailable && <span className="text-red-700 font-medium">⚠ Guru tidak tersedia</span>}
                  </div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
