import { DAY_ID } from "./constants";

/**
 * Kalimat penjelasan konflik untuk hover tooltip (title) sel jadwal.
 * @param {object} c conflict dari GET /schedule/conflicts
 * @param {object} teacherMap {id: teacher}
 * @param {object} classMap {id: schoolClass}
 */
export function conflictSnippet(c, teacherMap = {}, classMap = {}) {
  if (!c) return "";
  const day = DAY_ID[c.day] || c.day;
  const slot = `JP${c.slot}`;
  if (c.type === "teacher_double_booked") {
    const t = teacherMap[c.teacher_id]?.name || "Guru";
    const klasses = (c.class_ids || [])
      .map((id) => classMap[id]?.name || id)
      .join(" & ");
    return `Bentrok guru: ${t} mengajar ${klasses} pada ${day} ${slot} yang sama. Pindahkan salah satunya atau klik Rebuild.`;
  }
  if (c.type === "class_double_booked") {
    const k = classMap[c.class_id]?.name || "Kelas";
    return `Kelas ${k} terisi 2 pelajaran pada ${day} ${slot} yang sama. Pindahkan salah satunya.`;
  }
  if (c.type === "availability_violation") {
    const t = teacherMap[c.teacher_id]?.name || "Guru";
    return `${t} tidak tersedia pada ${day} ${slot}. Ubah di Availability Matrix lalu klik Rebuild, atau pindahkan manual.`;
  }
  if (c.type === "invalid_slot") {
    return `Slot ${day} ${slot} di luar konfigurasi hari (cek Konfigurasi). Klik Rebuild untuk merapikan.`;
  }
  return String(c.message || c.type || "Konflik jadwal");
}
