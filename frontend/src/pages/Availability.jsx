import { Fragment, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DAYS, DAY_ID } from "@/lib/constants";
import {
  useConfig, maxPeriodCount, periodCount, isSlotValid, getSlotTiming, getBreakRow,
} from "@/lib/scheduleConfig";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

function emptyAvailabilityFromConfigs(configs) {
  const av = {};
  configs.forEach((cfg) => {
    const count = cfg.items.filter((i) => i.type === "period").length;
    for (let s = 1; s <= count; s++) av[`${cfg.day}-${s}`] = "available";
  });
  return av;
}

export default function Availability() {
  const { configs } = useConfig();
  const [teachers, setTeachers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [availability, setAvailability] = useState({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await api.get("/teachers");
      setTeachers(r.data);
      if (r.data[0]) setSelectedId(r.data[0].id);
    })();
  }, []);

  useEffect(() => {
    const t = teachers.find((x) => x.id === selectedId);
    // Merge with base to ensure all cells present
    const base = configs.length ? emptyAvailabilityFromConfigs(configs) : {};
    setAvailability({ ...base, ...(t?.availability || {}) });
    setDirty(false);
  }, [selectedId, teachers, configs]);

  const maxSlots = useMemo(() => maxPeriodCount(configs), [configs]);
  const rows = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i + 1), [maxSlots]);

  const toggle = (day, slot) => {
    if (!isSlotValid(configs, day, slot)) return;
    const key = `${day}-${slot}`;
    const current = availability[key] || "available";
    const next = current === "available" ? "unavailable" : "available";
    setAvailability({ ...availability, [key]: next });
    setDirty(true);
  };

  const save = async () => {
    const t = teachers.find((x) => x.id === selectedId);
    if (!t) return;
    try {
      await api.put(`/teachers/${t.id}`, { ...t, availability });
      toast.success("Ketersediaan tersimpan");
      const r = await api.get("/teachers");
      setTeachers(r.data);
      setDirty(false);
    } catch (e) { toast.error("Gagal menyimpan"); }
  };

  const selected = teachers.find((x) => x.id === selectedId);
  const availableCount = Object.entries(availability).filter(([k, v]) => {
    const [day, slotStr] = k.split("-");
    const slot = parseInt(slotStr, 10);
    return v === "available" && isSlotValid(configs, day, slot);
  }).length;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Availability Matrix</h1>
          <p className="text-sm text-slate-500 mt-1">Klik sel untuk mengubah status ketersediaan guru</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger data-testid="teacher-select" className="w-72 bg-white">
              <SelectValue placeholder="Pilih guru..." />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {teachers.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            data-testid="save-availability-btn"
            onClick={save}
            disabled={!dirty}
            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            <Save size={14} className="mr-2" /> Simpan
          </Button>
        </div>
      </div>

      {selected && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Guru terpilih</div>
              <div className="text-lg font-semibold mt-1">{selected.name}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Slot tersedia</div>
              <div className="text-lg font-semibold mt-1 text-emerald-700">{availableCount} slot</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Maks JP/minggu</div>
              <div className="text-lg font-semibold mt-1">{selected.max_hours_per_week}</div>
            </div>
          </div>

          {selected.notes && (
            <div className="mb-5 border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-900 rounded-r">
              <strong>Catatan:</strong> {selected.notes}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg matrix-scroll">
            <table className="w-full text-sm" data-testid="availability-matrix">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left text-xs uppercase tracking-wide text-slate-500 sticky left-0 bg-slate-50 z-10">JP / Hari</th>
                  {DAYS.map((d) => (
                    <th key={d} className="p-2 text-xs uppercase tracking-wide text-slate-500 min-w-[130px]">{DAY_ID[d]}</th>
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
                          <div className="font-semibold text-slate-800">JP {slot}</div>
                        </td>
                        {DAYS.map((day) => {
                          const valid = isSlotValid(configs, day, slot);
                          if (!valid) {
                            return (
                              <td key={day} className="p-1">
                                <div className="text-center py-2 text-[11px] text-slate-300">—</div>
                              </td>
                            );
                          }
                          const key = `${day}-${slot}`;
                          const status = availability[key];
                          const timing = getSlotTiming(configs, day, slot);
                          const cls = status === "unavailable" ? "cell-unavailable" : "cell-available";
                          return (
                            <td key={day} className="p-1">
                              <button
                                data-testid={`avail-cell-${day}-${slot}`}
                                onClick={() => toggle(day, slot)}
                                className={`w-full py-2 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors duration-150 hover:ring-2 hover:ring-emerald-500 ${cls}`}
                              >
                                {status === "unavailable" ? (
                                  <><XCircle size={12} /> Off</>
                                ) : (
                                  <><CheckCircle2 size={12} /> {timing ? `${timing.start_str}` : ""}</>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                      {breakRow && (
                        <tr>
                          <td className="p-1 sticky left-0 bg-slate-50 border-r border-slate-100 text-[10px] text-amber-800 uppercase tracking-wide">Break</td>
                          {DAYS.map((day) => {
                            const breaks = breakRow[day] || [];
                            if (!breaks.length) {
                              return <td key={day} className="p-1"></td>;
                            }
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
        </>
      )}
    </div>
  );
}
