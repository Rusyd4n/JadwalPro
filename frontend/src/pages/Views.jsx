import { Fragment, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { DAYS, DAY_ID } from "@/lib/constants";
import {
  useConfig, maxPeriodCount, isSlotValid, getSlotTiming, getBreakRow,
} from "@/lib/scheduleConfig";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Download } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function Views() {
  const { configs } = useConfig();
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [tab, setTab] = useState("class");
  const [classId, setClassId] = useState("");
  const [teacherId, setTeacherId] = useState("");

  useEffect(() => {
    (async () => {
      const [t, s, c, sch] = await Promise.all([
        api.get("/teachers"), api.get("/subjects"), api.get("/classes"), api.get("/schedule"),
      ]);
      setTeachers(t.data); setSubjects(s.data); setClasses(c.data); setSchedule(sch.data);
      if (c.data[0]) setClassId(c.data[0].id);
      if (t.data[0]) setTeacherId(t.data[0].id);
    })();
  }, []);

  const teacherMap = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers]);
  const subjectMap = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const classMap = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);
  const maxSlots = useMemo(() => maxPeriodCount(configs), [configs]);
  const rows = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i + 1), [maxSlots]);

  const cellFor = (filterFn, day, slot) => schedule.find((s) => s.day === day && s.slot === slot && filterFn(s));

  const renderMatrix = (filterFn, showTeacher = true) => (
    <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="p-2 text-left text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-10 w-28">Jam</th>
            {DAYS.map((d) => (
              <th key={d} className="p-2 text-xs uppercase tracking-wide text-slate-500 min-w-[140px]">{DAY_ID[d]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((slot) => {
            const breakRow = getBreakRow(configs, slot);
            return (
              <Fragment key={slot}>
                <tr className="border-b border-slate-100">
                  <td className="p-2 sticky left-0 bg-white border-r border-slate-100">
                    <div className="font-semibold text-slate-800 text-xs">JP {slot}</div>
                  </td>
                  {DAYS.map((day) => {
                    if (!isSlotValid(configs, day, slot)) {
                      return (
                        <td key={day} className="p-1">
                          <div className="text-slate-300 text-center py-3 text-xs">—</div>
                        </td>
                      );
                    }
                    const s = cellFor(filterFn, day, slot);
                    const timing = getSlotTiming(configs, day, slot);
                    if (!s) {
                      return (
                        <td key={day} className="p-1">
                          <div className="text-slate-300 text-center py-3 text-xs font-mono">
                            {timing?.start_str || "—"}
                          </div>
                        </td>
                      );
                    }
                    const subject = subjectMap[s.subject_id];
                    return (
                      <td key={day} className="p-1">
                        <div className="rounded p-2 text-xs" style={{ background: (subject?.color || "#059669") + "20", borderLeft: `3px solid ${subject?.color || "#059669"}` }}>
                          <div className="font-mono text-[10px] text-slate-500">{timing?.start_str}</div>
                          <div className="font-semibold text-slate-900 truncate">{subject?.name || "?"}</div>
                          <div className="text-slate-600 text-[11px] truncate">
                            {showTeacher ? (teacherMap[s.teacher_id]?.name?.split(",")[0] || "?") : classMap[s.class_id]?.name}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
                {breakRow && (
                  <tr>
                    <td className="p-1 sticky left-0 bg-slate-50 border-r border-slate-100 text-[10px] text-amber-800 uppercase tracking-wide">Break</td>
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
  );

  const exportPDF = () => {
    let title = "Jadwal Master";
    let filterFn = () => true;
    let showTeacher = true;
    if (tab === "class") {
      const cls = classMap[classId];
      title = `Jadwal Kelas ${cls?.name || ""}`;
      filterFn = (s) => s.class_id === classId;
    } else if (tab === "teacher") {
      const t = teacherMap[teacherId];
      title = `Jadwal Guru — ${t?.name || ""}`;
      filterFn = (s) => s.teacher_id === teacherId;
      showTeacher = false;
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("JadwalPro — MA Persis Katapang", 40, 40);
    doc.setFontSize(12);
    doc.text(title, 40, 60);

    const head = [["JP / Jam", ...DAYS.map((d) => DAY_ID[d])]];
    const body = rows.map((slot) => {
      const row = [`JP ${slot}`];
      DAYS.forEach((day) => {
        if (!isSlotValid(configs, day, slot)) { row.push("—"); return; }
        const s = schedule.find((x) => x.day === day && x.slot === slot && filterFn(x));
        const timing = getSlotTiming(configs, day, slot);
        if (!s) { row.push(timing?.start_str || "—"); return; }
        const subject = subjectMap[s.subject_id];
        const extra = showTeacher ? teacherMap[s.teacher_id]?.name?.split(",")[0] : classMap[s.class_id]?.name;
        row.push(`${timing?.start_str || ""}\n${subject?.name || "?"}\n${extra || ""}`);
      });
      return row;
    });
    autoTable(doc, {
      head, body, startY: 80,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [5, 150, 105] },
    });
    doc.save(`${title}.pdf`);
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Views & Export</h1>
          <p className="text-sm text-slate-500 mt-1">Lihat jadwal dari perspektif master, kelas, atau guru — dan ekspor ke PDF.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button data-testid="print-btn" onClick={() => window.print()} variant="outline">
            <Printer size={14} className="mr-2" /> Print
          </Button>
          <Button data-testid="pdf-btn" onClick={exportPDF} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Download size={14} className="mr-2" /> Ekspor PDF
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList data-testid="views-tabs" className="bg-white border border-slate-200">
          <TabsTrigger value="class" data-testid="tab-class">Per Kelas</TabsTrigger>
          <TabsTrigger value="teacher" data-testid="tab-teacher">Per Guru</TabsTrigger>
          <TabsTrigger value="master" data-testid="tab-master">Master</TabsTrigger>
        </TabsList>
        <TabsContent value="class" className="mt-4">
          <div className="mb-4 w-64">
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-white">{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {renderMatrix((s) => s.class_id === classId, true)}
        </TabsContent>
        <TabsContent value="teacher" className="mt-4">
          <div className="mb-4 w-72">
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-white">{teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {renderMatrix((s) => s.teacher_id === teacherId, false)}
        </TabsContent>
        <TabsContent value="master" className="mt-4">
          <div className="text-xs text-slate-500 mb-2">Semua slot terjadwal — cell menampilkan pelajaran + guru.</div>
          {renderMatrix(() => true, true)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
