import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const ConfigContext = createContext({ configs: [], loading: true, refresh: async () => {} });

export function ConfigProvider({ children }) {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const r = await api.get("/day-configs");
      setConfigs(r.data);
    } catch (e) {
      /* not authed yet */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  const value = useMemo(() => ({ configs, loading, refresh }), [configs, loading]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext);
}

// ---------- helpers ----------
export function getConfigForDay(configs, day) {
  return configs.find((c) => c.day === day);
}

export function periodsOf(cfg) {
  return (cfg?.items || []).filter((i) => i.type === "period");
}

export function periodCount(configs, day) {
  return periodsOf(getConfigForDay(configs, day)).length;
}

export function maxPeriodCount(configs) {
  if (!configs.length) return 10;
  return Math.max(...configs.map((c) => periodsOf(c).length));
}

function fmtMin(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function computeTimeline(cfg) {
  if (!cfg) return [];
  const [sh, sm] = (cfg.start_time || "07:00").split(":").map(Number);
  let cursor = sh * 60 + sm;
  return cfg.items.map((item, idx) => {
    const start = cursor;
    cursor += item.duration_min || 0;
    return {
      ...item,
      index: idx,
      start_min: start,
      end_min: cursor,
      start_str: fmtMin(start),
      end_str: fmtMin(cursor),
    };
  });
}

export function getSlotTiming(configs, day, slot) {
  const cfg = getConfigForDay(configs, day);
  if (!cfg) return null;
  return computeTimeline(cfg).filter((t) => t.type === "period")[slot - 1] || null;
}

export function getBreaksAfterPeriod(cfg, periodIdx) {
  if (!cfg) return [];
  const items = cfg.items;
  let periodsPassed = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type === "period") {
      periodsPassed++;
      if (periodsPassed === periodIdx) {
        const result = [];
        for (let j = i + 1; j < items.length; j++) {
          if (items[j].type === "period") break;
          result.push(items[j]);
        }
        return result;
      }
    }
  }
  return [];
}

// Return { day: [breakItems] } if any day has breaks after periodIdx; else null
export function getBreakRow(configs, periodIdx) {
  const perDay = {};
  let hasAny = false;
  for (const cfg of configs) {
    const breaks = getBreaksAfterPeriod(cfg, periodIdx);
    if (breaks.length) hasAny = true;
    perDay[cfg.day] = breaks;
  }
  return hasAny ? perDay : null;
}

export function isSlotValid(configs, day, slot, classId) {
  const base = slot >= 1 && slot <= periodCount(configs, day);
  if (!base || !classId) return base;
  const lim = getConfigForDay(configs, day)?.class_limits?.[classId];
  if (lim == null) return base;
  return slot >= 1 && slot <= lim;
}
