export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_ID = {
  Monday: "Senin",
  Tuesday: "Selasa",
  Wednesday: "Rabu",
  Thursday: "Kamis",
  Friday: "Jumat",
  Saturday: "Sabtu",
};

// Slot times per day. Non-teaching slots (istirahat/sholat) are markers.
export const SLOT_TIMES_REGULAR = {
  1: "07:00 - 07:40",
  2: "07:40 - 08:20",
  3: "08:20 - 09:00",
  4: "09:00 - 09:40",
  5: "10:00 - 10:40",
  6: "10:40 - 11:20",
  7: "11:20 - 12:00",
  8: "12:00 - 12:40",
  9: "13:10 - 13:50",
  10: "13:50 - 14:30",
};

export const SLOT_TIMES_FRIDAY = {
  1: "07:00 - 07:40",
  2: "07:40 - 08:20",
  3: "08:20 - 09:00",
  4: "09:00 - 09:40",
  5: "10:00 - 10:40",
  6: "10:40 - 11:20",
  7: "12:30 - 13:10",
  8: "13:10 - 13:50",
};

export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const FRIDAY_ACTIVE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

export function getSlotTime(day, slot) {
  if (day === "Friday") return SLOT_TIMES_FRIDAY[slot] || "—";
  return SLOT_TIMES_REGULAR[slot] || "—";
}

export function isFridayPrayerSlot(day, slot) {
  return day === "Friday" && (slot === 9 || slot === 10);
}

// visual "after break" divider after slot 4 (Istirahat 1) and after slot 8 (Istirahat 2)
export function isBreakAfter(day, slot) {
  if (slot === 4) return "Istirahat 1 (09:40 - 10:00)";
  if (day !== "Friday" && slot === 8) return "Istirahat 2 (12:40 - 13:10)";
  if (day === "Friday" && slot === 6) return "Sholat Jumat (11:20 - 12:30)";
  return null;
}
