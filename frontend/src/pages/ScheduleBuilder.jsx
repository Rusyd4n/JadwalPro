import { useEffect, useState, useMemo } from "react";
import api from "@/lib/api";
import { DAYS, DAY_ID, SLOTS, isFridayPrayerSlot, isBreakAfter } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Trash2, AlertTriangle, X, GripVertical, Info } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";

// ---------------- Draggable pool card ----------------
function DraggablePoolCard({ assignment, subject, teacher }) {
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
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            Tersisa {assignment.remaining}/{assignment.hours_per_week} JP
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Draggable filled cell ----------------
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
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded bg-white hover:bg-red-50 border border-slate-200 transition-opacity duration-150"
        data-testid={`clear-slot-${cell.id}`}
      >
        <X size={10} />
      </button>
    </div>
  );
}

// ---------------- Droppable wrapper ----------------
function DroppableCell({ day, slot, disabled, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell::${day}::${slot}`,
    data: { type: "cell", day, slot },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`drop-cell-${day}-${slot}`}
      className={`rounded transition-colors duration-150 ${
        isOver && !disabled ? "ring-2 ring-emerald-500 bg-emerald-50" : ""
      }`}
    >
      {children}
    </div>
  );
}

// ---------------- Main ----------------
export default function ScheduleBuilder() {
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const loadAll = async () => {
    const [t, s, c, a, sch, cf] = await Promise.all([
      api.get("/teachers"),
      api.get("/subjects"),
      api.get("/classes"),
      api.get("/assignments"),
      api.get("/schedule"),
      api.get("/schedule/conflicts"),
    ]);
    setTeachers(t.data);
    setSubjects(s.data);
    setClasses(c.data);
    setAssignments(a.data);
    setSchedule(sch.data);
    setConflicts(cf.data);
    if (!selectedClassId && c.data[0]) setSelectedClassId(c.data[0].id);
  };
  useEffect(() => {
    loadAll();
    /* eslint-disable-next-line */
  }, []);

  const teacherMap = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t])),
    [teachers]
  );
  const subjectMap = useMemo(
    () => Object.fromEntries(subjects.map((s) => [s.id, s])),
    [subjects]
  );
  const classMap = useMemo(
    () => Object.fromEntries(classes.map((c) => [c.id, c])),
    [classes]
  );

  const classAssignments = useMemo(() => {
    return assignments
      .filter((a) => a.class_id === selectedClassId)
      .map((a) => {
        const placed = schedule.filter(
          (s) =>
            s.class_id === a.class_id &&
            s.subject_id === a.subject_id &&
            s.teacher_id === a.teacher_id
        ).length;
        return { ...a, placed, remaining: a.hours_per_week - placed };
      });
  }, [assignments, selectedClassId, schedule]);

  const totalRemaining = classAssignments.reduce((s, a) => s + Math.max(0, a.remaining), 0);

  const slotAt = (day, slot) =>
    schedule.find(
      (s) => s.class_id === selectedClassId && s.day === day && s.slot === slot
    );

  const conflictAt = (day, slot) => {
    return conflicts.find(
      (c) =>
        c.day === day &&
        c.slot === slot &&
        ((c.class_ids && c.class_ids.includes(selectedClassId)) || c.class_id === selectedClassId)
    );
  };

  const placeSlot = async ({ class_id, day, slot, subject_id, teacher_id }) => {
    await api.post("/schedule", {
      id: `sch_${Math.random().toString(16).slice(2, 14)}`,
      class_id,
      day,
      slot,
      subject_id,
      teacher_id,
    });
  };

  const handleDragStart = (event) => {
    setActiveDrag(event.active.data.current);
  };

  const handleDragEnd = async (event) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const overData = over.data.current;
    if (!overData || overData.type !== "cell") return;
    const { day, slot } = overData;
    if (isFridayPrayerSlot(day, slot)) {
      toast.error("Slot Sholat Jum'at tidak dapat digunakan");
      return;
    }
    const activeData = active.data.current;
    try {
      if (activeData.type === "assign") {
        const a = activeData.assignment;
        if (a.remaining <= 0) {
          toast.error("Jam mengajar sudah terpenuhi");
          return;
        }
        const teacher = teacherMap[a.teacher_id];
        if (teacher?.availability?.[`${day}-${slot}`] === "unavailable") {
          toast.warning(`${teacher.name} tidak tersedia — konflik akan tercatat`);
        }
        await placeSlot({
          class_id: selectedClassId,
          day,
          slot,
          subject_id: a.subject_id,
          teacher_id: a.teacher_id,
        });
        toast.success(`Ditempatkan pada ${DAY_ID[day]} JP ${slot}`);
      } else if (activeData.type === "slot") {
        const cell = activeData.cell;
        if (cell.day === day && cell.slot === slot) return;
        await api.delete(`/schedule/${cell.id}`);
        await placeSlot({
          class_id: cell.class_id,
          day,
          slot,
          subject_id: cell.subject_id,
          teacher_id: cell.teacher_id,
        });
        toast.success(`Dipindahkan ke ${DAY_ID[day]} JP ${slot}`);
      }
      loadAll();
    } catch (e) {
      toast.error("Gagal memindahkan slot");
      loadAll();
    }
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
    } catch (e) {
      toast.error("Auto-scheduler gagal");
    } finally {
      setAutoLoading(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Bersihkan semua jadwal?")) return;
    await api.post("/schedule/clear", {});
    toast.success("Jadwal dikosongkan");
    loadAll();
  };

  const totalConflictsForClass = conflicts.filter(
    (c) =>
      (c.class_ids && c.class_ids.includes(selectedClassId)) ||
      c.class_id === selectedClassId
  ).length;

  // Overlay content while dragging
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
            <Select value={selectedClassId} onValueChange={setSelectedClassId}>
              <SelectTrigger data-testid="class-select" className="w-40 bg-white">
                <SelectValue placeholder="Kelas..." />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              data-testid="auto-schedule-btn"
              onClick={autoSchedule}
              disabled={autoLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Sparkles size={14} className="mr-2" />
              {autoLoading ? "Menyusun..." : "Auto-Scheduler"}
            </Button>
            <Button
              data-testid="clear-schedule-btn"
              onClick={clearAll}
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} className="mr-2" />
              Bersihkan
            </Button>
          </div>
        </div>

        {totalConflictsForClass > 0 && (
          <div className="mb-4 p-3 border-l-4 border-red-500 bg-red-50 rounded-r flex items-center gap-2 text-sm text-red-900">
            <AlertTriangle size={16} />
            {totalConflictsForClass} konflik terdeteksi pada kelas {classMap[selectedClassId]?.name}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Assignment Pool */}
          <aside className="bg-white border border-slate-200 rounded-lg p-4 h-fit sticky top-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm text-slate-900 tracking-tight">
                  Belum Terjadwal
                </h3>
                <p className="text-[11px] text-slate-500">
                  Kelas {classMap[selectedClassId]?.name || "—"}
                </p>
              </div>
              <span
                data-testid="pool-remaining"
                className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium border border-emerald-200"
              >
                {totalRemaining} JP
              </span>
            </div>
            {classAssignments.length === 0 ? (
              <div className="text-xs text-slate-400 flex items-start gap-1.5 p-2 bg-slate-50 rounded">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>Tambahkan penugasan (Teaching Load) untuk mulai menjadwalkan.</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {classAssignments.map((a) => (
                  <DraggablePoolCard
                    key={a.id}
                    assignment={a}
                    subject={subjectMap[a.subject_id]}
                    teacher={teacherMap[a.teacher_id]}
                  />
                ))}
              </div>
            )}
          </aside>

          {/* Schedule Matrix */}
          <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="p-2 text-left text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-10 w-24">
                    JP
                  </th>
                  {DAYS.map((d) => (
                    <th
                      key={d}
                      className="p-2 text-xs uppercase tracking-wide text-slate-500 min-w-[160px]"
                    >
                      {DAY_ID[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SLOTS.map((slot) => (
                  <>
                    <tr key={slot} className="border-b border-slate-100">
                      <td className="p-2 sticky left-0 bg-white border-r border-slate-100 font-semibold text-slate-800">
                        JP {slot}
                      </td>
                      {DAYS.map((day) => {
                        const isPrayer = isFridayPrayerSlot(day, slot);
                        if (isPrayer)
                          return (
                            <td key={day} className="p-1">
                              <div className="cell-friday-prayer text-center py-3 text-[11px] font-medium rounded">
                                Sholat Jum'at
                              </div>
                            </td>
                          );
                        const cell = slotAt(day, slot);
                        const conflict = conflictAt(day, slot);
                        return (
                          <td key={day} className="p-1">
                            <DroppableCell day={day} slot={slot} disabled={isPrayer}>
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
                    {isBreakAfter("Monday", slot) && (
                      <tr>
                        <td
                          colSpan={DAYS.length + 1}
                          className="cell-break text-center text-xs font-medium py-1.5"
                        >
                          {isBreakAfter("Monday", slot)}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div
            className="p-2.5 border rounded-md text-xs bg-white shadow-lg scale-105"
            style={{ borderLeft: `3px solid ${overlaySubject?.color || "#059669"}` }}
          >
            <div className="font-semibold text-slate-900">
              {overlaySubject?.name || "?"}
            </div>
            <div className="text-slate-600 text-[11px]">
              {overlayTeacher?.name?.split(",")[0] || "?"}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
