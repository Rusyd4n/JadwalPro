import { Fragment, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { DAYS, DAY_ID } from "@/lib/constants";
import {
  useConfig, maxPeriodCount, isSlotValid, getSlotTiming, getBreakRow,
} from "@/lib/scheduleConfig";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function Views() {
  const { configs } = useConfig();
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [schedule, setSchedule] = useState([]);

  useEffect(() => {
    (async () => {
      const [t, s, c, sch] = await Promise.all([
        api.get("/teachers"), api.get("/subjects"), api.get("/classes"), api.get("/schedule"),
      ]);
      setTeachers(t.data); setSubjects(s.data); setClasses(c.data); setSchedule(sch.data);
    })();
  }, []);

  const teacherMap = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers]);
  const subjectMap = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s])), [subjects]);
  const maxSlots = useMemo(() => maxPeriodCount(configs), [configs]);
  const rows = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i + 1), [maxSlots]);

  // ---- Kode master: guru = nomor tersimpan (PK), mapel = alfabet (A..Z, AA..) ----
  const sortedTeachers = useMemo(
    () => [...teachers].sort((a, b) => (a.nomor ?? 9999) - (b.nomor ?? 9999)),
    [teachers]
  );
  const teacherNo = useMemo(
    () => Object.fromEntries(teachers.map((t) => [t.id, t.nomor ?? "?"])),
    [teachers]
  );
  const sortedSubjects = useMemo(
    () => [...subjects].sort((a, b) => a.name.localeCompare(b.name, "id")),
    [subjects]
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
  const subjectCode = useMemo(
    () => Object.fromEntries(sortedSubjects.map((s, i) => [s.id, codeOfIndex(i)])),
    [sortedSubjects]
  );
  const sortedClasses = useMemo(() => {
    const order = { X: 0, XI: 1, XII: 2 };
    return [...classes].sort(
      (a, b) => (order[a.grade] ?? 9) - (order[b.grade] ?? 9) || a.name.localeCompare(b.name, "id")
    );
  }, [classes]);
  // Lookup cepat: "day|slot|class_id" -> entry jadwal
  const scheduleLookup = useMemo(() => {
    const m = {};
    schedule.forEach((s) => {
      m[`${s.day}|${s.slot}|${s.class_id}`] = s;
    });
    return m;
  }, [schedule]);
  const codeFor = (entry) =>
    entry ? `${teacherNo[entry.teacher_id] ?? "?"}${"/"}${subjectCode[entry.subject_id] ?? "?"}` : "";

  // ---- Grid Master ala Excel: grup Hari x sub-kolom Kelas, sel = "noGuru/kodeMapel" ----
  const renderMaster = () => {
    if (sortedClasses.length === 0) {
      return <div className="text-center text-slate-400 py-12 text-sm">Belum ada data kelas.</div>;
    }
    return (
      <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th rowSpan={2} className="p-2 text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-20 w-20 border-r border-slate-200">
                Jam
              </th>
              {DAYS.map((d) => (
                <th
                  key={d}
                  colSpan={sortedClasses.length}
                  className="p-2 text-xs uppercase tracking-wide text-slate-700 border-l border-slate-200 bg-slate-100"
                >
                  {DAY_ID[d]}
                </th>
              ))}
            </tr>
            <tr>
              {DAYS.map((d) => (
                <Fragment key={d}>
                  {sortedClasses.map((c) => (
                    <th
                      key={`${d}-${c.id}`}
                      data-testid={`master-head-${d}-${c.id}`}
                      className="p-1.5 text-[11px] font-mono text-slate-500 border-l border-slate-100 min-w-[64px]"
                    >
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
                    <td className="p-1.5 sticky left-0 bg-white border-r border-slate-200 z-10">
                      <div className="font-semibold text-slate-800 text-xs text-center">JP {slot}</div>
                      <div className="font-mono text-[10px] text-slate-400 text-center">
                        {getSlotTiming(configs, DAYS[0], slot)?.start_str || ""}
                      </div>
                    </td>
                    {DAYS.map((day) => (
                      <Fragment key={day}>
                        {sortedClasses.map((c) => {
                          if (!isSlotValid(configs, day, slot)) {
                            return (
                              <td key={c.id} className="p-0.5 border-l border-slate-50">
                                <div className="bg-slate-100/70 text-slate-300 text-center py-2 text-[11px]">—</div>
                              </td>
                            );
                          }
                          const entry = scheduleLookup[`${day}|${slot}|${c.id}`];
                          if (!entry) {
                            return (
                              <td key={c.id} className="p-0.5 border-l border-slate-50">
                                <div className="text-slate-200 text-center py-2 text-[11px]">·</div>
                              </td>
                            );
                          }
                          const subject = subjectMap[entry.subject_id];
                          const color = subject?.color || "#059669";
                          return (
                            <td
                              key={c.id}
                              data-testid={`master-cell-${day}-${slot}-${c.id}`}
                              title={`${teacherMap[entry.teacher_id]?.name || "?"} — ${subject?.name || "?"} (${c.name})`}
                              className="p-0.5 border-l border-slate-50"
                            >
                              <div
                                className="text-center py-1.5 px-1 rounded text-xs font-mono font-semibold"
                                style={{ background: color + "26", color: "#0f172a", borderLeft: `3px solid ${color}` }}
                              >
                                {codeFor(entry)}
                              </div>
                            </td>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tr>
                  {breakRow && (
                    <tr className="bg-amber-50/60">
                      <td className="p-1 sticky left-0 bg-amber-50 border-r border-slate-200 text-[10px] text-amber-800 uppercase tracking-wide text-center z-10">
                        Break
                      </td>
                      {DAYS.map((day) => {
                        const breaks = breakRow[day] || [];
                        return (
                          <td key={day} colSpan={sortedClasses.length} className="p-1 border-l border-slate-200">
                            <div className="cell-break text-center py-1 text-[10px] font-medium rounded">
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
    );
  };

  const renderLegend = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Legenda Guru (nomor)
        </div>
        <table className="w-full text-sm">
          <tbody>
            {sortedTeachers.map((t) => (
              <tr key={t.id} className="border-b border-slate-100 last:border-0">
                <td className="p-2 w-12 text-center font-mono font-semibold text-slate-700">{t.nomor ?? "?"}</td>
                <td className="p-2 text-slate-800">{t.name}</td>
              </tr>
            ))}
            {sortedTeachers.length === 0 && (
              <tr><td className="p-3 text-slate-400 text-center">—</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Legenda Mapel (kode)
        </div>
        <table className="w-full text-sm">
          <tbody>
            {sortedSubjects.map((s, i) => (
              <tr key={s.id} className="border-b border-slate-100 last:border-0">
                <td className="p-2 w-12 text-center font-mono font-semibold" style={{ color: s.color || "#059669" }}>
                  {codeOfIndex(i)}
                </td>
                <td className="p-2 text-slate-800">{s.name}</td>
                <td className="p-2 w-20 text-xs font-mono text-slate-400">{s.code || ""}</td>
              </tr>
            ))}
            {sortedSubjects.length === 0 && (
              <tr><td className="p-3 text-slate-400 text-center">—</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("JadwalPro — MA Persis Katapang", 40, 40);
    doc.setFontSize(12);
    doc.text("Jadwal Master (kode: noGuru/kodeMapel)", 40, 60);
      const head = [
        ["JP", ...DAYS.flatMap((d) => sortedClasses.map(() => DAY_ID[d]))],
        ["", ...DAYS.flatMap(() => sortedClasses.map((c) => c.name))],
      ];
      const body = rows.map((slot) => {
        const row = [`JP ${slot}`];
        DAYS.forEach((day) => {
          sortedClasses.forEach((c) => {
            if (!isSlotValid(configs, day, slot)) { row.push("—"); return; }
            const entry = scheduleLookup[`${day}|${slot}|${c.id}`];
            row.push(entry ? codeFor(entry) : "");
          });
        });
        return row;
      });
      autoTable(doc, {
        head, body, startY: 80,
        styles: { fontSize: 6, cellPadding: 2 },
        headStyles: { fillColor: [5, 150, 105] },
      });
      autoTable(doc, {
        head: [["No", "Nama Guru"]],
        body: sortedTeachers.map((t) => [t.nomor ?? "?", t.name]),
        startY: doc.lastAutoTable.finalY + 16,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [5, 150, 105] },
      });
      autoTable(doc, {
        head: [["Kode", "Nama Mapel"]],
        body: sortedSubjects.map((s, i) => [codeOfIndex(i), s.name]),
        startY: doc.lastAutoTable.finalY + 16,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [5, 150, 105] },
      });
      doc.save("Jadwal Master.pdf");
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jadwal Master</h1>
          <p className="text-sm text-slate-500 mt-1">Keseluruhan jadwal kelas & guru — sel berisi kode gabungan nomor guru / kode mapel.</p>
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

      <div className="text-xs text-slate-500 mb-2">Format kode: nomor guru / kode mapel (mis. 27/L). Arahkan kursor ke sel untuk detail. Lihat legenda di bawah.</div>
      {renderMaster()}
      {renderLegend()}
    </div>
  );
}
