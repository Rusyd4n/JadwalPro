import { useEffect, useState } from "react";
import api from "@/lib/api";
import { DAYS, DAY_ID } from "@/lib/constants";
import { useConfig, computeTimeline } from "@/lib/scheduleConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Coffee, Sparkles, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export default function Config() {
  const { configs, refresh } = useConfig();
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [selectedDay, setSelectedDay] = useState("Monday");

  useEffect(() => {
    const map = {};
    configs.forEach((c) => (map[c.day] = JSON.parse(JSON.stringify(c))));
    setDrafts(map);
  }, [configs]);

  const cfg = drafts[selectedDay];
  const updateCfg = (patch) => setDrafts({ ...drafts, [selectedDay]: { ...cfg, ...patch } });

  const renumberPeriods = (items) => {
    let n = 0;
    return items.map((it) => {
      if (it.type === "period") {
        n++;
        return { ...it, label: `JP ${n}` };
      }
      return it;
    });
  };

  const setItem = (idx, patch) => {
    const items = cfg.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    updateCfg({ items });
  };

  const removeItem = (idx) => {
    const items = renumberPeriods(cfg.items.filter((_, i) => i !== idx));
    updateCfg({ items });
  };

  const moveItem = (idx, dir) => {
    const items = [...cfg.items];
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    updateCfg({ items: renumberPeriods(items) });
  };

  const addItem = (type) => {
    const periodCount = cfg.items.filter((i) => i.type === "period").length;
    const newItem =
      type === "period"
        ? { type: "period", label: `JP ${periodCount + 1}`, duration_min: 40 }
        : { type: "break", label: "Istirahat", duration_min: 20 };
    updateCfg({ items: [...cfg.items, newItem] });
  };

  const saveDay = async () => {
    setSaving(true);
    try {
      await api.put(`/day-configs/${selectedDay}`, cfg);
      toast.success(`Konfigurasi ${DAY_ID[selectedDay]} tersimpan`);
      await refresh();
    } catch (e) {
      toast.error("Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const resetDay = async () => {
    if (!window.confirm(`Reset ${DAY_ID[selectedDay]} ke pengaturan default?`)) return;
    try {
      await api.post(`/day-configs/${selectedDay}/reset`, {});
      toast.success("Reset selesai");
      await refresh();
    } catch (e) {
      toast.error("Gagal reset");
    }
  };

  const applyToAllRegular = async () => {
    if (!window.confirm("Terapkan konfigurasi ini ke semua hari kecuali Jumat?")) return;
    try {
      for (const d of DAYS) {
        if (d === "Friday" || d === selectedDay) continue;
        await api.put(`/day-configs/${d}`, { ...cfg, day: d });
      }
      toast.success("Diterapkan ke hari lain");
      await refresh();
    } catch (e) {
      toast.error("Gagal menerapkan");
    }
  };

  if (!cfg)
    return <div className="p-8 text-slate-500">Memuat konfigurasi...</div>;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Konfigurasi Jadwal</h1>
          <p className="text-sm text-slate-500 mt-1">
            Atur durasi JP, jumlah periode, dan istirahat untuk setiap hari — termasuk override khusus Jumat.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedDay !== "Friday" && (
            <Button data-testid="apply-to-all-btn" onClick={applyToAllRegular} variant="outline">
              <Sparkles size={14} className="mr-2" />
              Terapkan ke Hari Lain
            </Button>
          )}
          <Button data-testid="reset-day-btn" onClick={resetDay} variant="outline" className="text-slate-600">
            <RotateCcw size={14} className="mr-2" /> Reset Default
          </Button>
          <Button
            data-testid="save-config-btn"
            onClick={saveDay}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Save size={14} className="mr-2" /> {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </div>

      <Tabs value={selectedDay} onValueChange={setSelectedDay}>
        <TabsList data-testid="config-tabs" className="bg-white border border-slate-200 mb-4">
          {DAYS.map((d) => (
            <TabsTrigger key={d} value={d} data-testid={`config-tab-${d}`}>
              {DAY_ID[d]}
            </TabsTrigger>
          ))}
        </TabsList>

        {DAYS.map((d) => {
          const draft = drafts[d];
          if (!draft) return null;
          const timeline = computeTimeline(draft);
          const totalPeriods = draft.items.filter((i) => i.type === "period").length;
          const endTime = timeline.length ? timeline[timeline.length - 1].end_str : "—";
          return (
            <TabsContent key={d} value={d}>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <div className="bg-white border border-slate-200 rounded-lg p-5">
                  <div className="flex items-end gap-4 mb-5 flex-wrap">
                    <div className="max-w-[180px]">
                      <Label>Waktu Mulai</Label>
                      <Input
                        type="time"
                        data-testid="config-start-time"
                        value={draft.start_time || "07:00"}
                        onChange={(e) =>
                          setDrafts({ ...drafts, [d]: { ...draft, start_time: e.target.value } })
                        }
                      />
                    </div>
                    <div className="text-xs text-slate-500 pb-2">
                      Total <strong>{totalPeriods}</strong> JP · Selesai pukul{" "}
                      <span className="font-mono">{endTime}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {draft.items.map((it, idx) => {
                      const t = timeline[idx];
                      const isPeriod = it.type === "period";
                      return (
                        <div
                          key={idx}
                          data-testid={`config-item-${idx}`}
                          className={`flex items-center gap-2 p-2 rounded border ${
                            isPeriod
                              ? "border-emerald-200 bg-emerald-50/40"
                              : "border-amber-200 bg-amber-50/40"
                          }`}
                        >
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                              isPeriod
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {isPeriod ? "JP" : "Break"}
                          </span>
                          <Input
                            className="flex-1 min-w-0"
                            value={it.label}
                            onChange={(e) => setItem(idx, { label: e.target.value })}
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <Input
                              type="number"
                              min={1}
                              className="w-20"
                              value={it.duration_min}
                              onChange={(e) =>
                                setItem(idx, { duration_min: parseInt(e.target.value || "0", 10) })
                              }
                            />
                            <span className="text-xs text-slate-500">min</span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 w-24 text-right shrink-0">
                            {t?.start_str} – {t?.end_str}
                          </div>
                          <button
                            data-testid={`item-up-${idx}`}
                            onClick={() => moveItem(idx, -1)}
                            disabled={idx === 0}
                            className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-30 transition-colors duration-150"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            data-testid={`item-down-${idx}`}
                            onClick={() => moveItem(idx, +1)}
                            disabled={idx === draft.items.length - 1}
                            className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-30 transition-colors duration-150"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            data-testid={`item-remove-${idx}`}
                            onClick={() => removeItem(idx)}
                            className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors duration-150"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      data-testid="add-period-btn"
                      onClick={() => addItem("period")}
                      variant="outline"
                      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      <Plus size={14} className="mr-2" />
                      Tambah Periode
                    </Button>
                    <Button
                      data-testid="add-break-btn"
                      onClick={() => addItem("break")}
                      variant="outline"
                      className="border-amber-200 text-amber-700 hover:bg-amber-50"
                    >
                      <Coffee size={14} className="mr-2" />
                      Tambah Istirahat
                    </Button>
                  </div>
                </div>

                <aside className="bg-white border border-slate-200 rounded-lg p-4 h-fit">
                  <h3 className="font-semibold text-sm mb-2">Ringkasan {DAY_ID[d]}</h3>
                  <div className="space-y-1">
                    {timeline.map((t, i) => (
                      <div
                        key={i}
                        className={`text-xs flex items-center justify-between px-2 py-1 rounded ${
                          t.type === "period"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        <span className="truncate">{t.label}</span>
                        <span className="font-mono ml-2">
                          {t.start_str}–{t.end_str}
                        </span>
                      </div>
                    ))}
                  </div>
                  {d === "Friday" && (
                    <div className="mt-3 p-2.5 rounded bg-sky-50 border border-sky-200 text-[11px] text-sky-800">
                      <strong>Tip:</strong> Sesuaikan durasi break "Sholat Jum'at" agar sesuai waktu ibadah lokal.
                    </div>
                  )}
                </aside>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
