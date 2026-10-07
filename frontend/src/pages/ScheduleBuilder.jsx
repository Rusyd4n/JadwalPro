import { Fragment, useEffect, useState, useMemo } from "react";
import api from "@/lib/api";
import { DAYS, DAY_ID } from "@/lib/constants";
import {
  useConfig, maxPeriodCount, isSlotValid, getSlotTiming, getBreakRow,
} from "@/lib/scheduleConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Trash2, AlertTriangle, X, GripVertical, Info, RefreshCw, PanelLeftClose, PanelLeftOpen, LayoutGrid, Square, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, useDraggable, useDroppable, DragOverlay,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";

function DraggablePoolCard({ assignment, subject, teacher, classLabel }) {
  const filled = assignment.remaining <= 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `assign::${assignment.id}`,
    data: { type: "assign", assignment },
    disabled: filled,
  });
  return (
    <div
      ref={setNodeRef}
      {...(filled ? {} : attributes)}
      {...(filled ? {} : listeners)}
      data-testid={`pool-card-${assignment.id}`}
      className={`p-2.5 border rounded-md text-xs select-none transition-colors duration-150 ${
        filled
          ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
          : "border-slate-200 bg-white hover:border-emerald-400 cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-30" : ""}`}
      style={{ borderLeft: `3px solid ${subject?.color || "#059669"}` }}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical size={12} className="text-slate-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 truncate">{subject?.name || "?"}</div>
          <div className="text-slate-600 truncate">{teacher?.name || "?"}</div>
          <div className="mt-1 flex items-center gap-1.5">
            {classLabel && (
              <span className="px-1.5 py-px rounded bg-slate-100 text-[10px] font-mono text-slate-600">{classLabel}</span>
            )}
            <span className="text-[10px] font-mono text-slate-500">
              Tersisa {assignment.remaining}/{assignment.hours_per_week} JP
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DraggableFilledCell({ cell, subject, teacher, conflict, onClear }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `slot::${cell.id}`,
    data: { type: "slot", cell },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`schedule-cell-${cell.day}-${cell.slot}`}
      className={`relative rounded p-2 text-xs group cursor-grab active:cursor-grabbing transition-colors duration-150 ${
        conflict ? "cell-conflict" : ""
      } ${isDragging ? "opacity-30" : ""}`}
      style={{
        background: conflict ? undefined : (subject?.color || "#059669") + "20",
        borderLeft: `3px solid ${subject?.color || "#059669"}`,
      }}
    >
      <div className="font-semibold text-slate-900 truncate">{subject?.name || "?"}</div>
      <div className="text-slate-600 text-[11px] truncate">
        {teacher?.name?.split(",")[0] || "?"}
      </div>
      {conflict && (
        <div className="text-red-700 text-[10px] mt-0.5 font-medium">
          ⚠ {conflict.type.replace(/_/g, " ")}
        </div>
      )}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded bg-white hover:bg-red-50 border border-slate-200 transition-opacity duration-150"
        data-testid={`clear-slot-${cell.id}`}
      >
        <X size={10} />
      </button>
    </div>
  );
}

function MasterScheduleCell({ cell, code, color, title, conflict, dimmed, onClear }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `slot::${cell.id}`,
    data: { type: "slot", cell },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`master-cell-${cell.day}-${cell.slot}-${cell.class_id}`}
      title={title}
      className={`relative rounded text-center py-1.5 px-1 text-xs font-mono font-semibold group cursor-grab active:cursor-grabbing transition-colors duration-150 ${
        conflict ? "cell-conflict" : ""
      } ${isDragging ? "opacity-30" : ""} ${dimmed ? "bg-white border border-slate-200 text-slate-400" : ""}`}
      style={
        conflict
          ? { borderLeft: `3px solid ${color}` }
          : dimmed
            ? undefined
            : { background: color + "26", borderLeft: `3px solid ${color}` }
      }
    >
      {code}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-px rounded bg-white hover:bg-red-50 border border-slate-200 transition-opacity duration-150"
        data-testid={`clear-slot-${cell.id}`}
      >
        <X size={8} />
      </button>
    </div>
  );
}

function DroppableCell({ day, slot, classId, disabled, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell::${day}::${slot}${classId ? `::${classId}` : ""}`,
    data: { type: "cell", day, slot, classId },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`drop-cell-${day}-${slot}${classId ? `-${classId}` : ""}`}
      className={`rounded transition-colors duration-150 ${
        isOver && !disabled ? "ring-2 ring-emerald-500 bg-emerald-50" : ""
      }`}
    >
      {children}
    </div>
  );
}

export default function ScheduleBuilder() {
  const { configs } = useConfig();
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [mode, setMode] = useState("class");
  const [panelOpen, setPanelOpen] = useState(true);
  const [masterFilters, setMasterFilters] = useState([]);
  const [filterInput, setFilterInput] = useState("");

  const addMasterFilter = () => {
    const tok = filterInput.trim().toUpperCase();
    if (!tok) return;
    if (masterFilters.includes(tok)) {
      setFilterInput("");
      return;
    }
    if (masterFilters.length >= 5) {
      toast.warning("Maksimal 5 filter aktif");
      return;
    }
    setMasterFilters((prev) => [...prev, tok]);
    setFilterInput("");
  };
  const removeMasterFilter = (tok) => setMasterFilters((prev) => prev.filter((x) => x !== tok));

  const cellMatchesFilter = (entry) => {
    if (masterFilters.length === 0 || !entry) return true;
    const code = `${teacherNo[entry.teacher_id] ?? "?"}${"/"}${subjectCode[entry.subject_id] ?? "?"}`.toUpperCase();
    const [tn, sc] = code.split("/");
    return masterFilters.some((f) => f === code || f === tn || f === sc);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  const maxSlots = useMemo(() => maxPeriodCount(configs), [configs]);
  const rows = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i + 1), [maxSlots]);

  const classAssignments = useMemo(() => {
    return assignments
      .filter((a) => a.class_id === selectedClassId)
      .map((a) => {
        const placed = schedule.filter(
          (s) => s.class_id === a.class_id && s.subject_id === a.subject_id && s.teacher_id === a.teacher_id
        ).length;
        return { ...a, placed, remaining: a.hours_per_week - placed };
      });
  }, [assignments, selectedClassId, schedule]);

  const totalRemaining = classAssignments.reduce((s, a) => s + Math.max(0, a.remaining), 0);
  const slotAt = (day, slot) => schedule.find((s) => s.class_id === selectedClassId && s.day === day && s.slot === slot);
  const conflictAt = (day, slot) =>
    conflicts.find((c) => c.day === day && c.slot === slot && ((c.class_ids && c.class_ids.includes(selectedClassId)) || c.class_id === selectedClassId));

  // ---- Mode Master: kode ringkas + lookup semua kelas ----
  const sortedClasses = useMemo(() => {
    const order = { X: 0, XI: 1, XII: 2 };
    return [...classes].sort(
      (a, b) => (order[a.grade] ?? 9) - (order[b.grade] ?? 9) || a.name.localeCompare(b.name, "id")
    );
  }, [classes]);
  const teacherNo = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t.nomor ?? "?"])),
    [teachers]
  );
  const codeOfIndex = (idx) => {
    let s = "";
    let n = idx;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };
  const sortedSubjects = useMemo(
    () => [...subjects].sort((a, b) => a.name.localeCompare(b.name, "id")),
    [subjects]
  );
  const subjectCode = useMemo(
    () => Object.fromEntries(sortedSubjects.map((s, i) => [s.id, codeOfIndex(i)])),
    [sortedSubjects]
  );
  const scheduleLookup = useMemo(() => {
    const m = {};
    schedule.forEach((s) => {
      m[`${s.day}|${s.slot}|${s.class_id}`] = s;
    });
    return m;
  }, [schedule]);
  const codeFor = (entry) =>
    entry ? `${teacherNo[entry.teacher_id] ?? "?"}${"/"}${subjectCode[entry.subject_id] ?? "?"}` : "";
  const allPool = useMemo(() => {
    return assignments
      .map((a) => {
        const placed = schedule.filter(
          (s) => s.class_id === a.class_id && s.subject_id === a.subject_id && s.teacher_id === a.teacher_id
        ).length;
        return { ...a, placed, remaining: a.hours_per_week - placed };
      })
      .filter((a) => a.remaining > 0);
  }, [assignments, schedule]);
  const totalRemainingAll = allPool.reduce((s, a) => s + Math.max(0, a.remaining), 0);
  const conflictAtMaster = (day, slot, classId) =>
    conflicts.find((c) => c.day === day && c.slot === slot && ((c.class_ids && c.class_ids.includes(classId)) || c.class_id === classId));

  const placeSlot = async ({ class_id, day, slot, subject_id, teacher_id }, force = false) => {
    await api.post(`/schedule${force ? "?force=true" : ""}`, {
      id: `sch_${Math.random().toString(16).slice(2, 14)}`,
      class_id, day, slot, subject_id, teacher_id,
    });
  };

  const describeErr = (e) => e.response?.data?.detail?.message || e.response?.data?.detail || "Gagal memindahkan slot";

  const handleDragStart = (event) => setActiveDrag(event.active.data.current);
  const handleDragEnd = async (event) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const overData = over.data.current;
    if (!overData || overData.type !== "cell") return;
    const { day, slot } = overData;
    const targetClassId = overData.classId || selectedClassId;
    if (!isSlotValid(configs, day, slot)) {
      toast.error(`Slot tidak tersedia pada ${DAY_ID[day]} JP ${slot}`);
      return;
    }
    const activeData = active.data.current;
    const tryPlace = async (args, force = false) => {
      try {
        await placeSlot(args, force);
        return true;
      } catch (e) {
        const detail = e.response?.data?.detail;
        if (e.response?.status === 409 && detail?.can_force && !force) {
          if (window.confirm(`${detail.message}. Tetap tempatkan (dicatat sebagai konflik)?`)) {
            return tryPlace(args, true);
          }
          return false;
        }
        toast.error(detail?.message || detail || "Gagal memindahkan slot");
        return false;
      }
    };
    try {
      if (activeData.type === "assign") {
        const a = activeData.assignment;
        if (a.remaining <= 0) { toast.error("Jam mengajar sudah terpenuhi"); return; }
        const ok = await tryPlace({ class_id: targetClassId, day, slot, subject_id: a.subject_id, teacher_id: a.teacher_id });
        if (ok) toast.success(`Ditempatkan pada ${classMap[targetClassId]?.name || ""} ${DAY_ID[day]} JP ${slot}`);
      } else if (activeData.type === "slot") {
        const cell = activeData.cell;
        if (cell.day === day && cell.slot === slot && cell.class_id === targetClassId) return;
        await api.delete(`/schedule/${cell.id}`);
        const ok = await tryPlace({ class_id: targetClassId, day, slot, subject_id: cell.subject_id, teacher_id: cell.teacher_id });
        if (!ok) {
          // kembalikan slot asal bila penempatan baru ditolak (mis. guru bentrok)
          await placeSlot({ class_id: cell.class_id, day: cell.day, slot: cell.slot, subject_id: cell.subject_id, teacher_id: cell.teacher_id }, true);
        } else {
          toast.success(`Dipindahkan ke ${classMap[targetClassId]?.name || ""} ${DAY_ID[day]} JP ${slot}`);
        }
      }
      loadAll();
    } catch (e) {
      toast.error(describeErr(e));
      loadAll();
    }
  };

  const clearSlot = async (id) => { await api.delete(`/schedule/${id}`); loadAll(); };
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

  const rebuild = async () => {
    if (!window.confirm("Sinkron ulang jadwal ke availability terbaru? Slot yang melanggar (bentrok guru / tidak tersedia) akan dihapus lalu diisi ulang otomatis.")) return;
    setRebuildLoading(true);
    try {
      const r = await api.post("/schedule/rebuild", {});
      const d = r.data;
      toast.success(`Rebuild selesai: ${d.removed} slot melanggar dihapus, ${d.added} slot diisi ulang. Sisa konflik: ${d.conflicts_remaining}`);
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rebuild gagal");
    } finally {
      setRebuildLoading(false);
    }
  };

  const totalConflictsForClass = conflicts.filter(
    (c) => (c.class_ids && c.class_ids.includes(selectedClassId)) || c.class_id === selectedClassId
  ).length;

  const overlaySubject = activeDrag && (activeDrag.type === "assign"
    ? subjectMap[activeDrag.assignment.subject_id]
    : subjectMap[activeDrag.cell.subject_id]);
  const overlayTeacher = activeDrag && (activeDrag.type === "assign"
    ? teacherMap[activeDrag.assignment.teacher_id]
    : teacherMap[activeDrag.cell.teacher_id]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <div className="p-8">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Schedule Builder</h1>
            <p className="text-sm text-slate-500 mt-1">
              Seret kartu penugasan dari panel kiri ke sel jadwal. Pindahkan slot yang sudah ada dengan menyeretnya.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              data-testid="toggle-panel-btn"
              onClick={() => setPanelOpen((v) => !v)}
              variant="outline"
              title={panelOpen ? "Sembunyikan panel" : "Tampilkan panel"}
            >
              {panelOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </Button>
            <div className="flex rounded-md border border-slate-200 overflow-hidden">
              <button
                data-testid="mode-class-btn"
                onClick={() => setMode("class")}
                className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors duration-150 ${mode === "class" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <Square size={12} /> Per Kelas
              </button>
              <button
                data-testid="mode-master-btn"
                onClick={() => setMode("master")}
                className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors duration-150 ${mode === "master" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <LayoutGrid size={12} /> Master
              </button>
            </div>
            {mode === "class" && (
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger data-testid="class-select" className="w-40 bg-white">
                  <SelectValue placeholder="Kelas..." />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button data-testid="auto-schedule-btn" onClick={autoSchedule} disabled={autoLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Sparkles size={14} className="mr-2" />
              {autoLoading ? "Menyusun..." : "Auto-Scheduler"}
            </Button>
            <Button data-testid="rebuild-schedule-btn" onClick={rebuild} disabled={rebuildLoading} variant="outline" className="border-sky-200 text-sky-700 hover:bg-sky-50" title="Hapus slot yang melanggar availability terbaru, lalu isi ulang otomatis">
              <RefreshCw size={14} className="mr-2" />
              {rebuildLoading ? "Membangun..." : "Rebuild"}
            </Button>
            <Button data-testid="clear-schedule-btn" onClick={clearAll} variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
              <Trash2 size={14} className="mr-2" /> Bersihkan
            </Button>
          </div>
        </div>

        {mode === "class" ? (
          totalConflictsForClass > 0 && (
            <div className="mb-4 p-3 border-l-4 border-red-500 bg-red-50 rounded-r flex items-center gap-2 text-sm text-red-900">
              <AlertTriangle size={16} />
              {totalConflictsForClass} konflik terdeteksi pada kelas {classMap[selectedClassId]?.name}
            </div>
          )
        ) : (
          conflicts.length > 0 && (
            <div className="mb-4 p-3 border-l-4 border-red-500 bg-red-50 rounded-r flex items-center gap-2 text-sm text-red-900">
              <AlertTriangle size={16} />
              {conflicts.length} konflik terdeteksi di seluruh jadwal
            </div>
          )
        )}

        <div className={`grid grid-cols-1 gap-4 ${panelOpen ? "lg:grid-cols-[280px_1fr]" : "lg:grid-cols-1"}`}>
          {panelOpen && (
          <aside className="bg-white border border-slate-200 rounded-lg p-4 h-fit lg:sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm text-slate-900 tracking-tight">Belum Terjadwal</h3>
                <p className="text-[11px] text-slate-500">
                  {mode === "class" ? `Kelas ${classMap[selectedClassId]?.name || "—"}` : "Semua kelas"}
                </p>
              </div>
              <span data-testid="pool-remaining" className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-200">
                {mode === "class" ? totalRemaining : totalRemainingAll} JP
              </span>
            </div>
            {(mode === "class" ? classAssignments.length === 0 : allPool.length === 0) ? (
              <div className="text-xs text-slate-400 flex items-start gap-1.5 p-2 bg-slate-50 rounded">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>Tambahkan penugasan (Teaching Load) untuk mulai menjadwalkan.</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {(mode === "class" ? classAssignments : allPool).map((a) => (
                  <DraggablePoolCard
                    key={a.id}
                    assignment={a}
                    subject={subjectMap[a.subject_id]}
                    teacher={teacherMap[a.teacher_id]}
                    classLabel={mode === "master" ? classMap[a.class_id]?.name : undefined}
                  />
                ))}
              </div>
            )}
          </aside>
          )}
          {mode === "class" ? (
          <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-10 w-24">JP</th>
                  {DAYS.map((d) => (
                    <th key={d} className="p-2 text-xs uppercase tracking-wide text-slate-500 min-w-[160px]">
                      {DAY_ID[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((slot) => {
                  const breakRow = getBreakRow(configs, slot);
                  return (
                    <Fragment key={slot}>
                      <tr className="border-b border-slate-100">
                        <td className="p-2 sticky left-0 bg-white border-r border-slate-100 font-semibold text-slate-800">
                          JP {slot}
                        </td>
                        {DAYS.map((day) => {
                          const valid = isSlotValid(configs, day, slot);
                          if (!valid) {
                            return (
                              <td key={day} className="p-1">
                                <div className="text-center py-3 text-[11px] text-slate-300">—</div>
                              </td>
                            );
                          }
                          const cell = slotAt(day, slot);
                          const conflict = conflictAt(day, slot);
                          return (
                            <td key={day} className="p-1">
                              <DroppableCell day={day} slot={slot}>
                                {cell ? (
                                  <DraggableFilledCell
                                    cell={cell}
                                    subject={subjectMap[cell.subject_id]}
                                    teacher={teacherMap[cell.teacher_id]}
                                    conflict={conflict}
                                    onClear={() => clearSlot(cell.id)}
                                  />
                                ) : (
                                  <div
                                    data-testid={`empty-cell-${day}-${slot}`}
                                    className="w-full py-3 border border-dashed border-slate-200 rounded text-slate-400 text-center text-xs"
                                  >
                                    Seret ke sini
                                  </div>
                                )}
                              </DroppableCell>
                            </td>
                          );
                        })}
                      </tr>
                      {breakRow && (
                        <tr>
                          <td className="p-1 sticky left-0 bg-slate-50 border-r border-slate-100 text-[10px] text-amber-800 uppercase tracking-wide">
                            Break
                          </td>
                          {DAYS.map((day) => {
                            const breaks = breakRow[day] || [];
                            if (!breaks.length) return <td key={day} className="p-1"></td>;
                            return (
                              <td key={day} className="p-1">
                                {breaks.map((b, i) => (
                                  <div key={i} className="cell-break text-center py-1 text-[10px] font-medium rounded">
                                    {b.label} · {b.duration_min}m
                                  </div>
                                ))}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : (
          <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
            <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-slate-100">
              Mode Master — sel menampilkan kode <span className="font-mono font-semibold">noGuru/kodeMapel</span> (arahkan kursor untuk detail). Seret kartu ke kolom kelas tujuan.
            </div>
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 flex-wrap bg-slate-50/60">
              <div className="flex items-center gap-1.5">
                <Input
                  data-testid="master-filter-input"
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addMasterFilter(); }}
                  placeholder="Filter: 27, L, 27/L…"
                  className="w-44 h-8 text-xs font-mono bg-white"
                />
                <Button data-testid="master-filter-add" size="sm" variant="outline" onClick={addMasterFilter}>
                  <Plus size={13} className="mr-1" /> Filter
                </Button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {masterFilters.map((f) => (
                  <span
                    key={f}
                    data-testid={`master-filter-chip-${f}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 text-white text-[11px] font-mono"
                  >
                    {f}
                    <button
                      data-testid={`master-filter-remove-${f}`}
                      onClick={() => removeMasterFilter(f)}
                      className="hover:text-red-300 transition-colors duration-150"
                      title="Hapus filter"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {masterFilters.length === 0 ? (
                  <span className="text-[11px] text-slate-400">Belum ada filter — semua sel berwarna. Maks 5.</span>
                ) : (
                  <button
                    data-testid="master-filter-clear"
                    onClick={() => setMasterFilters([])}
                    className="text-[11px] text-slate-500 hover:text-slate-800 underline"
                  >
                    Bersihkan ({masterFilters.length}/5)
                  </button>
                )}
              </div>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-20 w-16 border-r border-slate-200">JP</th>
                  {DAYS.map((d) => (
                    <th key={d} colSpan={sortedClasses.length} className="p-2 text-xs uppercase tracking-wide text-slate-700 border-l border-slate-200 bg-slate-100">
                      {DAY_ID[d]}
                    </th>
                  ))}
                </tr>
                <tr>
                  {DAYS.map((d) => (
                    <Fragment key={d}>
                      {sortedClasses.map((c) => (
                        <th key={`${d}-${c.id}`} className="p-1 text-[10px] font-mono text-slate-500 border-l border-slate-100 min-w-[60px]">
                          {c.name}
                        </th>
                      ))}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((slot) => {
                  const breakRow = getBreakRow(configs, slot);
                  return (
                    <Fragment key={slot}>
                      <tr className="border-b border-slate-100">
                        <td className="p-1.5 sticky left-0 bg-white border-r border-slate-200 z-10 text-center font-semibold text-slate-800 text-xs">
                          {slot}
                        </td>
                        {DAYS.map((day) => (
                          <Fragment key={day}>
                            {sortedClasses.map((c) => {
                              if (!isSlotValid(configs, day, slot)) {
                                return (
                                  <td key={c.id} className="p-0.5 border-l border-slate-50">
                                    <div className="bg-slate-100/70 text-slate-300 text-center py-1.5 text-[11px]">—</div>
                                  </td>
                                );
                              }
                              const entry = scheduleLookup[`${day}|${slot}|${c.id}`];
                              const conflict = conflictAtMaster(day, slot, c.id);
                              return (
                                <td key={c.id} className="p-0.5 border-l border-slate-50">
                                  <DroppableCell day={day} slot={slot} classId={c.id}>
                                    {entry ? (
                                      <MasterScheduleCell
                                        cell={entry}
                                        code={codeFor(entry)}
                                        color={subjectMap[entry.subject_id]?.color || "#059669"}
                                        title={`${teacherMap[entry.teacher_id]?.name || "?"} — ${subjectMap[entry.subject_id]?.name || "?"} (${c.name})`}
                                        conflict={conflict}
                                        dimmed={!cellMatchesFilter(entry)}
                                        onClear={() => clearSlot(entry.id)}
                                      />
                                    ) : (
                                      <div
                                        data-testid={`empty-master-cell-${day}-${slot}-${c.id}`}
                                        className="w-full py-1.5 border border-dashed border-slate-200 rounded text-slate-300 text-center text-[10px]"
                                      >
                                        +
                                      </div>
                                    )}
                                  </DroppableCell>
                                </td>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tr>
                      {breakRow && (
                        <tr className="bg-amber-50/60">
                          <td className="p-1 sticky left-0 bg-amber-50 border-r border-slate-200 z-10"></td>
                          {DAYS.map((day) => {
                            const breaks = breakRow[day] || [];
                            return (
                              <td key={day} colSpan={sortedClasses.length} className="p-1 border-l border-slate-200">
                                <div className="cell-break text-center py-0.5 text-[10px] font-medium rounded">
                                  {breaks.length ? breaks.map((b) => b.label).join(" · ") : "—"}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div
            className="p-2.5 border rounded-md text-xs bg-white shadow-lg scale-105"
            style={{ borderLeft: `3px solid ${overlaySubject?.color || "#059669"}` }}
          >
            <div className="font-semibold text-slate-900">{overlaySubject?.name || "?"}</div>
            <div className="text-slate-600 text-[11px]">{overlayTeacher?.name?.split(",")[0] || "?"}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
