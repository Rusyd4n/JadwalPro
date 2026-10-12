from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import csv
import io
import colorsys
import json
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Owner allowlist — only these emails can log in (open access is fine but this is the primary owner)
OWNER_EMAILS = {"jauhar.jundi@gmail.com"}

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
# Slots 1-10; Friday only 1-8 (9-10 reserved for Sholat Jumat / off)
REGULAR_SLOTS = list(range(1, 11))
FRIDAY_SLOTS = list(range(1, 9))


def now_utc():
    return datetime.now(timezone.utc)


def new_id(prefix: str = "id") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------- Models ----------------
class Teacher(BaseModel):
    id: str = Field(default_factory=lambda: new_id("t"))
    nomor: Optional[int] = None  # primary key tampil (kode guru di Views: 27/L)
    name: str
    email: Optional[str] = ""
    whatsapp: Optional[str] = ""
    # availability: dict keyed "Monday-1" -> "available" | "unavailable"
    availability: Dict[str, str] = Field(default_factory=dict)
    notes: Optional[str] = ""


class Subject(BaseModel):
    id: str = Field(default_factory=lambda: new_id("s"))
    name: str
    code: Optional[str] = ""
    color: Optional[str] = "#059669"


class SchoolClass(BaseModel):
    id: str = Field(default_factory=lambda: new_id("c"))
    name: str
    grade: str  # X, XI, XII
    wali_kelas_id: Optional[str] = ""  # relasi -> teachers.id


class Assignment(BaseModel):
    id: str = Field(default_factory=lambda: new_id("a"))
    teacher_id: str
    subject_id: str
    class_id: str
    hours_per_week: int


class BulkDelete(BaseModel):
    ids: List[str]


class ScheduleSlot(BaseModel):
    id: str = Field(default_factory=lambda: new_id("sch"))
    class_id: str
    day: str
    slot: int
    subject_id: str
    teacher_id: str


class SessionData(BaseModel):
    session_id: str


class PeriodItem(BaseModel):
    type: str  # "period" | "break"
    label: str
    duration_min: int = 40


class DayConfig(BaseModel):
    id: str = Field(default_factory=lambda: new_id("dcfg"))
    day: str
    start_time: str = "07:00"
    items: List[PeriodItem] = Field(default_factory=list)
    # batas JP per kelas: {class_id: max_period} — mis. Jumat X-1/X-2 hanya 7 JP
    class_limits: Dict[str, int] = Field(default_factory=dict)


DEFAULT_ITEMS_REGULAR = [
    {"type": "period", "label": "JP 1", "duration_min": 40},
    {"type": "period", "label": "JP 2", "duration_min": 40},
    {"type": "period", "label": "JP 3", "duration_min": 40},
    {"type": "period", "label": "JP 4", "duration_min": 40},
    {"type": "break", "label": "Istirahat 1", "duration_min": 20},
    {"type": "period", "label": "JP 5", "duration_min": 40},
    {"type": "period", "label": "JP 6", "duration_min": 40},
    {"type": "period", "label": "JP 7", "duration_min": 40},
    {"type": "period", "label": "JP 8", "duration_min": 40},
    {"type": "break", "label": "Istirahat 2", "duration_min": 30},
    {"type": "period", "label": "JP 9", "duration_min": 40},
    {"type": "period", "label": "JP 10", "duration_min": 40},
]
DEFAULT_ITEMS_FRIDAY = [
    {"type": "period", "label": "JP 1", "duration_min": 40},
    {"type": "period", "label": "JP 2", "duration_min": 40},
    {"type": "period", "label": "JP 3", "duration_min": 40},
    {"type": "period", "label": "JP 4", "duration_min": 40},
    {"type": "break", "label": "Istirahat 1", "duration_min": 20},
    {"type": "period", "label": "JP 5", "duration_min": 40},
    {"type": "period", "label": "JP 6", "duration_min": 40},
    {"type": "break", "label": "Sholat Jum'at", "duration_min": 70},
    {"type": "period", "label": "JP 7", "duration_min": 40},
    {"type": "period", "label": "JP 8", "duration_min": 40},
]


async def ensure_day_configs():
    if await db.day_configs.count_documents({}) == 0:
        docs = []
        for day in DAYS:
            docs.append({
                "id": new_id("dcfg"),
                "day": day,
                "start_time": "07:00",
                "items": DEFAULT_ITEMS_FRIDAY if day == "Friday" else list(DEFAULT_ITEMS_REGULAR),
            })
        await db.day_configs.insert_many(docs)


async def get_valid_slots_by_day() -> Dict[str, set]:
    await ensure_day_configs()
    configs = await db.day_configs.find({}, {"_id": 0}).to_list(20)
    result = {}
    for c in configs:
        periods = [i for i in c.get("items", []) if i.get("type") == "period"]
        result[c["day"]] = set(range(1, len(periods) + 1))
    return result


async def load_class_limits() -> Dict[str, Dict[str, int]]:
    """Muat batas JP per kelas: {day: {class_id: max_period}}."""
    await ensure_day_configs()
    configs = await db.day_configs.find({}, {"_id": 0}).to_list(20)
    out: Dict[str, Dict[str, int]] = {}
    for c in configs:
        lim = c.get("class_limits") or {}
        if lim:
            out[c["day"]] = {str(k): int(v) for k, v in lim.items()}
    return out


def valid_slots_for(valid_global: Dict[str, set], limits: Dict[str, Dict[str, int]],
                    class_id: str, day: str) -> set:
    """Slot valid untuk kelas tertentu (terapkan class_limits bila ada)."""
    base = valid_global.get(day, set())
    lim = (limits.get(day) or {}).get(class_id)
    if lim is None:
        return base
    return {s for s in base if 1 <= s <= lim}


async def get_breaks_after_map() -> Dict[str, set]:
    """Petakan periode JP yang diikuti break, per hari.

    Dipakai scheduler agar blok 2/3 JP tidak menyeberangi istirahat.
    """
    await ensure_day_configs()
    configs = await db.day_configs.find({}, {"_id": 0}).to_list(20)
    out: Dict[str, set] = {}
    for cfg in configs:
        items = cfg.get("items", [])
        seen = set()
        p = 0
        idx = 0
        while idx < len(items):
            if items[idx].get("type") == "period":
                p += 1
                j = idx + 1
                while j < len(items) and items[j].get("type") != "period":
                    if items[j].get("type") == "break":
                        seen.add(p)
                        break
                    j += 1
            idx += 1
        out[cfg["day"]] = seen
    return out


# ---------------- Auth ----------------
async def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth and auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    session_doc = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session_doc:
        return None
    expires_at = session_doc.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < now_utc():
        return None
    user = await db.users.find_one({"user_id": session_doc["user_id"]}, {"_id": 0})
    return user


async def require_user(request: Request) -> dict:
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/session")
async def auth_session(payload: SessionData, response: Response):
    """Exchange session_id from Emergent for our session_token cookie."""
    async with httpx.AsyncClient(timeout=15.0) as ac:
        r = await ac.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = r.json()

    email = data.get("email", "").lower()
    # Optional: enforce allowlist. For flexibility we allow any Google account but mark owner.
    is_owner = email in OWNER_EMAILS

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture"), "is_owner": is_owner}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "is_owner": is_owner,
            "created_at": now_utc().isoformat(),
        })

    session_token = data.get("session_token")
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": now_utc().isoformat(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    user_out = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user_out}


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@api_router.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}


# ---------------- Teachers ----------------
async def _next_teacher_nomor(exclude_id: Optional[str] = None) -> int:
    docs = await db.teachers.find({}, {"_id": 0, "id": 1, "nomor": 1}).to_list(2000)
    used = [d["nomor"] for d in docs if d.get("nomor") is not None and d["id"] != exclude_id]
    return (max(used) if used else 0) + 1


@api_router.get("/teachers", response_model=List[Teacher])
async def list_teachers(request: Request):
    await require_user(request)
    await ensure_teacher_numbers()
    docs = await db.teachers.find({}, {"_id": 0}).to_list(500)
    return [Teacher(**d) for d in docs]


@api_router.post("/teachers", response_model=Teacher)
async def create_teacher(payload: Teacher, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    if doc.get("nomor") is None:
        doc["nomor"] = await _next_teacher_nomor()
    else:
        clash = await db.teachers.find_one({"nomor": doc["nomor"]}, {"_id": 0})
        if clash:
            raise HTTPException(status_code=409, detail=f"Nomor {doc['nomor']} sudah dipakai {clash.get('name', '')}")
    await db.teachers.insert_one(doc)
    return Teacher(**doc)


@api_router.put("/teachers/{teacher_id}", response_model=Teacher)
async def update_teacher(teacher_id: str, payload: Teacher, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    doc["id"] = teacher_id
    if doc.get("nomor") is not None:
        clash = await db.teachers.find_one({"nomor": doc["nomor"]}, {"_id": 0})
        if clash and clash["id"] != teacher_id:
            raise HTTPException(status_code=409, detail=f"Nomor {doc['nomor']} sudah dipakai {clash.get('name', '')}")
    await db.teachers.update_one({"id": teacher_id}, {"$set": doc}, upsert=True)
    return Teacher(**doc)


@api_router.delete("/teachers/{teacher_id}")
async def delete_teacher(teacher_id: str, request: Request):
    await require_user(request)
    await db.teachers.delete_one({"id": teacher_id})
    await db.assignments.delete_many({"teacher_id": teacher_id})
    await db.schedule.delete_many({"teacher_id": teacher_id})
    await db.classes.update_many({"wali_kelas_id": teacher_id}, {"$set": {"wali_kelas_id": ""}})
    return {"ok": True}


@api_router.post("/teachers/bulk-delete")
async def bulk_delete_teachers(payload: BulkDelete, request: Request):
    """Hapus banyak guru sekaligus + cascade assignments & schedule."""
    await require_user(request)
    ids = payload.ids or []
    if not ids:
        raise HTTPException(status_code=400, detail="Tidak ada ID yang dipilih")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Maksimal 500 item per bulk delete")
    t = await db.teachers.delete_many({"id": {"$in": ids}})
    a = await db.assignments.delete_many({"teacher_id": {"$in": ids}})
    s = await db.schedule.delete_many({"teacher_id": {"$in": ids}})
    await db.classes.update_many({"wali_kelas_id": {"$in": ids}}, {"$set": {"wali_kelas_id": ""}})
    return {"ok": True, "deleted_teachers": t.deleted_count,
            "deleted_assignments": a.deleted_count, "deleted_schedule": s.deleted_count}


TEACHER_TEMPLATE_HEADERS = ["nomor", "nama", "email", "whatsapp", "catatan"]


def _default_teacher_availability() -> Dict[str, str]:
    """Default guru BARU: semua slot 'unavailable' (off).

    Admin wajib menyalakan (available) slot yang benar di Availability Matrix.
    Mencegah scheduler menempatkan guru di jam yang belum dikonfirmasi.
    """
    av: Dict[str, str] = {}
    for day in DAYS:
        slots = FRIDAY_SLOTS if day == "Friday" else REGULAR_SLOTS
        for s in slots:
            av[f"{day}-{s}"] = "unavailable"
    return av


async def ensure_teacher_numbers() -> None:
    """Backfill nomor untuk guru lama yang belum punya (urut nama, lanjutkan max)."""
    docs = await db.teachers.find({}, {"_id": 0}).to_list(2000)
    used = {d["nomor"] for d in docs if d.get("nomor") is not None}
    missing = sorted([d for d in docs if d.get("nomor") is None], key=lambda d: d.get("name", ""))
    nxt = (max(used) if used else 0) + 1
    for d in missing:
        await db.teachers.update_one({"id": d["id"]}, {"$set": {"nomor": nxt}})
        nxt += 1


def auto_subject_color(index: int) -> str:
    """Warna kontras deterministik via golden-angle hue rotation."""
    h = ((index * 137.508) % 360) / 360.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.68, 0.62)
    return "#%02X%02X%02X" % (int(r * 255), int(g * 255), int(b * 255))


def resolve_teacher(maps: dict, value: str):
    """Cari guru by nomor ('27', '27. Nama', '27 - Nama') atau nama lengkap."""
    import re as _re
    v = (value or "").strip()
    if not v:
        return None
    t_by_nomor, t_by_name = maps
    if v.isdigit() and int(v) in t_by_nomor:
        return t_by_nomor[int(v)]
    m = _re.match(r"^(\d+)\s*[.\-–:)]\s+.+$", v)
    if m and int(m.group(1)) in t_by_nomor:
        return t_by_nomor[int(m.group(1))]
    return t_by_name.get(v.lower())


def resolve_subject(maps: dict, value: str):
    """Cari mapel by kode dulu, lalu nama."""
    v = (value or "").strip()
    if not v:
        return None
    s_by_code, s_by_name = maps
    hit = s_by_code.get(v.lower()) or s_by_name.get(v.lower())
    return hit


def _decode_csv_bytes(raw: bytes) -> str:
    """Decode CSV bytes toleran: coba UTF-8 (BOM), lalu Windows-1252/Latin-1.

    File dari Excel Indonesia sering tersimpan sebagai ANSI (cp1252)
    atau CSV dengan delimiter ';' — bukan UTF-8 murni.
    latin-1 selalu berhasil decode, jadi error UTF-8 tidak lagi muncul;
    validasi isi tetap via header/delimiter.
    """
    if not raw:
        raise HTTPException(status_code=400, detail="File CSV kosong")
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, ValueError):
            continue
    raise HTTPException(
        status_code=400,
        detail="File tidak terbaca. Simpan ulang sebagai CSV (UTF-8 atau ANSI) lalu coba lagi.",
    )


def _make_csv_reader(text: str) -> csv.DictReader:
    """Buat DictReader dengan auto-deteksi delimiter ',' vs ';' vs tab.

    Excel Indonesia memakai ';' karena koma dipakai desimal.
    """
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="File CSV kosong / tanpa header")
    # Bersihkan BOM di awal file bila masih tersisa
    text = text.lstrip("\ufeff")
    lines = [ln for ln in text.splitlines() if ln.strip()][:5]
    sample = "\n".join(lines)
    delimiter = ","
    if sample:
        counts = {d: sample.count(d) for d in (",", ";", "\t")}
        best = max(counts, key=lambda k: counts[k])
        if counts[best] > 0:
            delimiter = best
    try:
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter, skipinitialspace=True)
    except Exception:
        raise HTTPException(status_code=400, detail="File CSV tidak valid / rusak")
    if not reader.fieldnames or not any((f or "").strip(" \t\r\n\ufeff") for f in reader.fieldnames):
        raise HTTPException(status_code=400, detail="File CSV kosong / tanpa header")
    # Bersihkan BOM/spasi pada nama header agar mapping alias tetap cocok
    reader.fieldnames = [(f or "").strip().lstrip("\ufeff") for f in reader.fieldnames]
    return reader


@api_router.get("/teachers/template")
async def download_teacher_template(request: Request):
    """Unduh template CSV untuk bulk input guru."""
    await require_user(request)
    docs = await db.teachers.find({}, {"_id": 0}).to_list(500)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(TEACHER_TEMPLATE_HEADERS)
    if docs:
        for d in docs[:2]:
            writer.writerow([d.get("name", ""), d.get("email", ""), d.get("whatsapp", ""),
                             d.get("max_hours_per_week", 24), d.get("notes", "")])
    else:
        writer.writerow(["Drs. Dadang Ahmad Tajudin", "", "081200000001", 24, "Contoh catatan"])
        writer.writerow(["Zaenal Mutaqin, S.Ag", "", "081200000002", 24, ""])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=template_teachers.csv"},
    )


@api_router.post("/teachers/upload")
async def upload_teachers(request: Request, file: UploadFile = File(...)):
    """Unggah CSV guru. Cocokkan by nomor dulu, lalu nama."""
    await require_user(request)
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File harus berformat .csv")
    raw = await file.read()
    text = _decode_csv_bytes(raw)
    reader = _make_csv_reader(text)

    def canon(h: str) -> str:
        h = (h or "").strip().lower()
        if h in ("nomor", "no", "number", "kode_guru", "kode guru"):
            return "nomor"
        if h in ("nama", "name", "nama_lengkap", "nama lengkap", "guru"):
            return "nama"
        if h in ("email", "e-mail"):
            return "email"
        if h in ("whatsapp", "wa", "no_wa", "telepon", "phone"):
            return "whatsapp"
        if h in ("catatan", "notes", "note", "keterangan"):
            return "catatan"
        return h

    mapped = {f: canon(f) for f in reader.fieldnames}
    if "nama" not in mapped.values():
        raise HTTPException(status_code=400,
                            detail=f"Header kurang: nama. Header wajib: {', '.join(TEACHER_TEMPLATE_HEADERS)}")

    await ensure_teacher_numbers()
    docs = await db.teachers.find({}, {"_id": 0}).to_list(1000)
    by_nomor = {d["nomor"]: d for d in docs if d.get("nomor") is not None}
    by_name = {d["name"].strip().lower(): d for d in docs}
    used_nomor = set(by_nomor)
    nxt = (max(used_nomor) if used_nomor else 0) + 1
    added, updated = 0, 0
    errors: List[dict] = []
    for i, row in enumerate(reader, start=2):
        norm = {mapped[k]: (v or "").strip() for k, v in row.items() if k is not None}
        if not any(norm.values()):
            continue
        name = norm.get("nama", "")
        if not name:
            errors.append({"row": i, "message": "Nama wajib diisi"})
            continue
        nomor_raw = norm.get("nomor", "")
        nomor = None
        if nomor_raw:
            try:
                nomor = int(float(str(nomor_raw).replace(",", ".")))
            except (ValueError, TypeError):
                errors.append({"row": i, "message": f"Nomor tidak valid: '{nomor_raw}'"})
                continue
        target = by_nomor.get(nomor) if nomor is not None else None
        if target is None:
            target = by_name.get(name.lower())
        if target is not None:
            if nomor is not None:
                other = by_nomor.get(nomor)
                if other is not None and other["id"] != target["id"]:
                    errors.append({"row": i, "message": f"Nomor {nomor} milik {other.get('name', '')}, tapi nama cocok dengan {target.get('name', '')} — perbaiki file"})
                    continue
                name_hit = by_name.get(name.lower())
                if name_hit is not None and name_hit["id"] != target["id"]:
                    errors.append({"row": i, "message": f"Nama cocok dengan {name_hit.get('name', '')} (nomor {name_hit.get('nomor', '?')}), tapi nomor {nomor} milik {target.get('name', '')} — perbaiki file"})
                    continue
        if target is not None:
            final_nomor = target.get("nomor")
            if nomor is not None and nomor not in used_nomor:
                final_nomor = nomor
                used_nomor.add(nomor)
            await db.teachers.update_one(
                {"id": target["id"]},
                {"$set": {"nomor": final_nomor, "name": name, "email": norm.get("email", ""),
                          "whatsapp": norm.get("whatsapp", ""), "notes": norm.get("catatan", "")}},
            )
            if final_nomor is not None:
                by_nomor[final_nomor] = {**target, "nomor": final_nomor, "name": name}
            updated += 1
        else:
            if nomor is None:
                nomor = nxt
                nxt += 1
            if nomor in used_nomor:
                errors.append({"row": i, "message": f"Nomor {nomor} sudah dipakai"})
                continue
            used_nomor.add(nomor)
            doc = {"id": new_id("t"), "nomor": nomor, "name": name, "email": norm.get("email", ""),
                   "whatsapp": norm.get("whatsapp", ""), "notes": norm.get("catatan", ""),
                   "availability": _default_teacher_availability()}
            await db.teachers.insert_one(doc)
            by_nomor[nomor] = doc
            by_name[name.lower()] = doc
            added += 1
    return {"ok": True, "added": added, "updated": updated, "errors": errors, "skipped": len(errors)}


# ---------------- Subjects ----------------
@api_router.get("/subjects", response_model=List[Subject])
async def list_subjects(request: Request):
    await require_user(request)
    docs = await db.subjects.find({}, {"_id": 0}).to_list(500)
    return [Subject(**d) for d in docs]


@api_router.post("/subjects", response_model=Subject)
async def create_subject(payload: Subject, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    if not doc.get("color"):
        count = await db.subjects.count_documents({})
        doc["color"] = auto_subject_color(count)
    await db.subjects.insert_one(doc)
    return Subject(**doc)


@api_router.delete("/subjects/{subject_id}")
async def delete_subject(subject_id: str, request: Request):
    await require_user(request)
    await db.subjects.delete_one({"id": subject_id})
    await db.assignments.delete_many({"subject_id": subject_id})
    await db.schedule.delete_many({"subject_id": subject_id})
    return {"ok": True}


@api_router.post("/subjects/bulk-delete")
async def bulk_delete_subjects(payload: BulkDelete, request: Request):
    """Hapus banyak mapel sekaligus + cascade assignments & schedule."""
    await require_user(request)
    ids = payload.ids or []
    if not ids:
        raise HTTPException(status_code=400, detail="Tidak ada ID yang dipilih")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Maksimal 500 item per bulk delete")
    t = await db.subjects.delete_many({"id": {"$in": ids}})
    a = await db.assignments.delete_many({"subject_id": {"$in": ids}})
    s = await db.schedule.delete_many({"subject_id": {"$in": ids}})
    return {"ok": True, "deleted_subjects": t.deleted_count,
            "deleted_assignments": a.deleted_count, "deleted_schedule": s.deleted_count}


SUBJECT_TEMPLATE_HEADERS = ["nama", "kode"]


@api_router.get("/subjects/template")
async def download_subject_template(request: Request):
    """Unduh template CSV untuk bulk input mata pelajaran. Kolom kode = PK."""
    await require_user(request)
    docs = await db.subjects.find({}, {"_id": 0}).to_list(500)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(SUBJECT_TEMPLATE_HEADERS)
    if docs:
        for d in docs[:5]:
            writer.writerow([d.get("name", ""), d.get("code", "")])
    else:
        writer.writerow(["Matematika", "MTK"])
        writer.writerow(["Fiqih", "FQH"])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=template_subjects.csv"},
    )


@api_router.post("/subjects/upload")
async def upload_subjects(request: Request, file: UploadFile = File(...)):
    """Unggah CSV mapel. Cocokkan by kode dulu (PK), lalu nama. Warna auto."""
    await require_user(request)
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File harus berformat .csv")
    raw = await file.read()
    text = _decode_csv_bytes(raw)
    reader = _make_csv_reader(text)

    def canon(h: str) -> str:
        h = (h or "").strip().lower()
        if h in ("nama", "name", "mapel", "mata_pelajaran", "mata pelajaran"):
            return "nama"
        if h in ("kode", "code", "singkatan"):
            return "kode"
        return h

    mapped = {f: canon(f) for f in reader.fieldnames}
    if "nama" not in mapped.values():
        raise HTTPException(status_code=400,
                            detail=f"Header kurang: nama. Header wajib: {', '.join(SUBJECT_TEMPLATE_HEADERS)}")

    docs = await db.subjects.find({}, {"_id": 0}).to_list(1000)
    by_code = {str(d.get("code", "")).strip().lower(): d for d in docs if str(d.get("code", "")).strip()}
    by_name = {d["name"].strip().lower(): d for d in docs}
    color_idx = len(docs)
    added, updated = 0, 0
    errors: List[dict] = []
    for i, row in enumerate(reader, start=2):
        norm = {mapped[k]: (v or "").strip() for k, v in row.items() if k is not None}
        if not any(norm.values()):
            continue
        name = norm.get("nama", "")
        code = norm.get("kode", "")
        if not name:
            errors.append({"row": i, "message": "Nama wajib diisi"})
            continue
        target = (by_code.get(code.lower()) if code else None) or by_name.get(name.lower())
        if target is not None:
            final_code = target.get("code", "") or code
            if code and code.lower() not in by_code:
                final_code = code
            await db.subjects.update_one(
                {"id": target["id"]},
                {"$set": {"name": name, "code": final_code}},
            )
            if final_code:
                by_code[final_code.lower()] = target
            updated += 1
        else:
            color = auto_subject_color(color_idx)
            color_idx += 1
            doc = {"id": new_id("s"), "name": name, "code": code, "color": color}
            await db.subjects.insert_one(doc)
            if code:
                by_code[code.lower()] = doc
            by_name[name.lower()] = doc
            added += 1
    return {"ok": True, "added": added, "updated": updated, "errors": errors, "skipped": len(errors)}


# ---------------- Classes ----------------
@api_router.get("/classes", response_model=List[SchoolClass])
async def list_classes(request: Request):
    await require_user(request)
    docs = await db.classes.find({}, {"_id": 0}).to_list(500)
    return [SchoolClass(**d) for d in docs]


@api_router.post("/classes", response_model=SchoolClass)
async def create_class(payload: SchoolClass, request: Request):
    await require_user(request)
    await db.classes.insert_one(payload.model_dump())
    return payload


@api_router.delete("/classes/{class_id}")
async def delete_class(class_id: str, request: Request):
    await require_user(request)
    await db.classes.delete_one({"id": class_id})
    await db.assignments.delete_many({"class_id": class_id})
    await db.schedule.delete_many({"class_id": class_id})
    return {"ok": True}


@api_router.post("/classes/bulk-delete")
async def bulk_delete_classes(payload: BulkDelete, request: Request):
    """Hapus banyak kelas sekaligus + cascade assignments & schedule."""
    await require_user(request)
    ids = payload.ids or []
    if not ids:
        raise HTTPException(status_code=400, detail="Tidak ada ID yang dipilih")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Maksimal 500 item per bulk delete")
    t = await db.classes.delete_many({"id": {"$in": ids}})
    a = await db.assignments.delete_many({"class_id": {"$in": ids}})
    s = await db.schedule.delete_many({"class_id": {"$in": ids}})
    return {"ok": True, "deleted_classes": t.deleted_count,
            "deleted_assignments": a.deleted_count, "deleted_schedule": s.deleted_count}


CLASS_TEMPLATE_HEADERS = ["nama", "tingkat", "wali_kelas"]


def _normalize_grade(v: str) -> Optional[str]:
    v = (v or "").strip().upper()
    if v in ("X", "10"):
        return "X"
    if v in ("XI", "11"):
        return "XI"
    if v in ("XII", "12"):
        return "XII"
    return None


@api_router.get("/classes/template")
async def download_class_template(request: Request):
    """Unduh template CSV untuk bulk input kelas. Kolom wali_kelas = nomor/nama guru."""
    await require_user(request)
    await ensure_teacher_numbers()
    docs = await db.classes.find({}, {"_id": 0}).to_list(500)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    t_by_id = {t["id"]: t for t in teachers}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CLASS_TEMPLATE_HEADERS)
    if docs:
        for d in docs[:8]:
            w = t_by_id.get(d.get("wali_kelas_id", ""), {})
            wali = f"{w['nomor']}. {w['name']}" if w.get("nomor") else w.get("name", "")
            writer.writerow([d.get("name", ""), d.get("grade", ""), wali])
    else:
        writer.writerow(["X-1", "X", ""])
        writer.writerow(["XI-1", "XI", ""])
        writer.writerow(["XII-1", "XII", ""])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=template_classes.csv"},
    )


@api_router.post("/classes/upload")
async def upload_classes(request: Request, file: UploadFile = File(...)):
    """Unggah CSV kelas. Kolom wali_kelas = nomor/nama guru (opsional)."""
    await require_user(request)
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File harus berformat .csv")
    raw = await file.read()
    text = _decode_csv_bytes(raw)
    reader = _make_csv_reader(text)

    def canon(h: str) -> str:
        h = (h or "").strip().lower()
        if h in ("nama", "name", "kelas", "class", "nama_kelas"):
            return "nama"
        if h in ("tingkat", "grade", "kelas_tingkat", "jenjang"):
            return "tingkat"
        if h in ("wali_kelas", "wali kelas", "wali", "homeroom"):
            return "wali_kelas"
        return h

    mapped = {f: canon(f) for f in reader.fieldnames}
    if "nama" not in mapped.values():
        raise HTTPException(status_code=400,
                            detail=f"Header kurang: nama. Header wajib: {', '.join(CLASS_TEMPLATE_HEADERS)}")

    await ensure_teacher_numbers()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(1000)
    t_maps = ({t["nomor"]: t for t in teachers if t.get("nomor") is not None},
              {t["name"].strip().lower(): t for t in teachers})
    docs = await db.classes.find({}, {"_id": 0}).to_list(1000)
    by_name = {d["name"].strip().lower(): d for d in docs}
    added, updated = 0, 0
    errors: List[dict] = []
    for i, row in enumerate(reader, start=2):
        norm = {mapped[k]: (v or "").strip() for k, v in row.items() if k is not None}
        if not any(norm.values()):
            continue
        name = norm.get("nama", "")
        if not name:
            errors.append({"row": i, "message": "Nama wajib diisi"})
            continue
        grade = _normalize_grade(norm.get("tingkat", ""))
        if not grade:
            errors.append({"row": i, "message": f"Tingkat tidak valid: '{norm.get('tingkat', '')}' (isi X/XI/XII)"})
            continue
        wali_id = ""
        wali_raw = norm.get("wali_kelas", "")
        if wali_raw:
            wt = resolve_teacher(t_maps, wali_raw)
            if not wt:
                errors.append({"row": i, "message": f"Wali kelas tidak ditemukan: '{wali_raw}'"})
                continue
            wali_id = wt["id"]
        key = name.lower()
        if key in by_name:
            await db.classes.update_one({"id": by_name[key]["id"]},
                                        {"$set": {"name": name, "grade": grade, "wali_kelas_id": wali_id}})
            updated += 1
        else:
            doc = {"id": new_id("c"), "name": name, "grade": grade, "wali_kelas_id": wali_id}
            await db.classes.insert_one(doc)
            by_name[key] = doc
            added += 1
    return {"ok": True, "added": added, "updated": updated, "errors": errors, "skipped": len(errors)}


# ---------------- Assignments ----------------
@api_router.get("/assignments", response_model=List[Assignment])
async def list_assignments(request: Request):
    await require_user(request)
    docs = await db.assignments.find({}, {"_id": 0}).to_list(1000)
    return [Assignment(**d) for d in docs]


@api_router.post("/assignments", response_model=Assignment)
async def create_assignment(payload: Assignment, request: Request):
    await require_user(request)
    await db.assignments.insert_one(payload.model_dump())
    return payload


@api_router.put("/assignments/{assignment_id}", response_model=Assignment)
async def update_assignment(assignment_id: str, payload: Assignment, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    doc["id"] = assignment_id
    await db.assignments.update_one({"id": assignment_id}, {"$set": doc}, upsert=True)
    return Assignment(**doc)


@api_router.delete("/assignments/{assignment_id}")
async def delete_assignment(assignment_id: str, request: Request):
    await require_user(request)
    await db.assignments.delete_one({"id": assignment_id})
    return {"ok": True}


@api_router.post("/assignments/bulk-delete")
async def bulk_delete_assignments(payload: BulkDelete, request: Request):
    """Hapus banyak penugasan sekaligus."""
    await require_user(request)
    ids = payload.ids or []
    if not ids:
        raise HTTPException(status_code=400, detail="Tidak ada ID yang dipilih")
    if len(ids) > 1000:
        raise HTTPException(status_code=400, detail="Maksimal 1000 item per bulk delete")
    r = await db.assignments.delete_many({"id": {"$in": ids}})
    return {"ok": True, "deleted": r.deleted_count}


ASSIGNMENT_TEMPLATE_HEADERS = ["nama_guru", "mata_pelajaran", "kelas", "jp_per_minggu"]


@api_router.get("/assignments/template")
async def download_assignment_template(request: Request):
    """Unduh template CSV untuk bulk input assignments.

    Kolom: nama_guru, mata_pelajaran, kelas, jp_per_minggu.
    Nama harus sama persis (case-insensitive) dengan data master.
    """
    await require_user(request)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    subjects = await db.subjects.find({}, {"_id": 0}).to_list(500)
    classes = await db.classes.find({}, {"_id": 0}).to_list(500)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(ASSIGNMENT_TEMPLATE_HEADERS)
    # Baris contoh: pakai data master pertama bila ada, agar user tinggal timpa
    if teachers and subjects and classes:
        writer.writerow([teachers[0]["name"], subjects[0]["name"], classes[0]["name"], 2])
        if len(teachers) > 1 and len(subjects) > 1 and len(classes) > 1:
            writer.writerow([teachers[1]["name"], subjects[1]["name"], classes[1]["name"], 4])
    else:
        writer.writerow(["Drs. Dadang Ahmad Tajudin", "Matematika", "X-1", 2])
        writer.writerow(["Zaenal Mutaqin, S.Ag", "Fiqih", "XI-1", 4])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=template_assignments.csv"},
    )


@api_router.post("/assignments/upload")
async def upload_assignments(request: Request, file: UploadFile = File(...)):
    """Unggah file CSV template assignments.

    Guru dikenali by nomor dulu lalu nama; mapel by kode dulu lalu nama.
    Baris duplikat (guru+mapel+kelas sama) akan di-update JP-nya.
    """
    await require_user(request)
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File harus berformat .csv")

    raw = await file.read()
    text = _decode_csv_bytes(raw)
    reader = _make_csv_reader(text)

    # Normalisasi header -> key kanonis
    def canon(h: str) -> str:
        h = (h or "").strip().lower()
        if h in ("nama_guru", "guru", "teacher", "nama guru", "nomor_guru", "nomor guru"):
            return "nama_guru"
        if h in ("mata_pelajaran", "mapel", "subject", "mata pelajaran", "pelajaran"):
            return "mata_pelajaran"
        if h in ("kelas", "class", "nama_kelas", "nama kelas"):
            return "kelas"
        if h in ("jp_per_minggu", "jp", "jp/minggu", "hours", "hours_per_week", "jp per minggu"):
            return "jp_per_minggu"
        return h

    mapped_fields = {f: canon(f) for f in reader.fieldnames}
    missing = [c for c in ASSIGNMENT_TEMPLATE_HEADERS if c not in mapped_fields.values()]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Header kurang: {', '.join(missing)}. Header wajib: {', '.join(ASSIGNMENT_TEMPLATE_HEADERS)}",
        )

    await ensure_teacher_numbers()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    subjects = await db.subjects.find({}, {"_id": 0}).to_list(500)
    classes = await db.classes.find({}, {"_id": 0}).to_list(500)
    t_maps = ({t["nomor"]: t for t in teachers if t.get("nomor") is not None},
              {t["name"].strip().lower(): t for t in teachers})
    s_maps = ({str(s.get("code", "")).strip().lower(): s for s in subjects if str(s.get("code", "")).strip()},
              {s["name"].strip().lower(): s for s in subjects})
    # kelas juga dikenali via code bila ada
    class_map = {}
    for c in classes:
        class_map[c["name"].strip().lower()] = c
        if c.get("code"):
            class_map[str(c["code"]).strip().lower()] = c

    existing = await db.assignments.find({}, {"_id": 0}).to_list(2000)
    existing_key = {(a["teacher_id"], a["subject_id"], a["class_id"]): a for a in existing}

    added = 0
    updated = 0
    errors: List[dict] = []

    for i, row in enumerate(reader, start=2):  # baris 1 = header
        norm = {mapped_fields[k]: (v or "").strip() for k, v in row.items() if k is not None}
        if not any(norm.values()):
            continue  # lewati baris kosong
        t_name = norm.get("nama_guru", "")
        s_name = norm.get("mata_pelajaran", "")
        c_name = norm.get("kelas", "")
        jp_raw = norm.get("jp_per_minggu", "")

        teacher = resolve_teacher(t_maps, t_name)
        if not teacher:
            errors.append({"row": i, "message": f"Guru tidak ditemukan: '{t_name}' (isi nomor/nama sesuai template Guru)"})
            continue
        subject = resolve_subject(s_maps, s_name)
        if not subject:
            errors.append({"row": i, "message": f"Mata pelajaran tidak ditemukan: '{s_name}' (isi kode/nama sesuai template Mapel)"})
            continue
        school_class = class_map.get(c_name.lower())
        if not school_class:
            errors.append({"row": i, "message": f"Kelas tidak ditemukan: '{c_name}'"})
            continue
        try:
            jp = int(float(str(jp_raw).replace(",", ".")))
        except (ValueError, TypeError):
            errors.append({"row": i, "message": f"JP tidak valid: '{jp_raw}' (harus angka 1-40)"})
            continue
        if jp < 1 or jp > 40:
            errors.append({"row": i, "message": f"JP di luar rentang 1-40: '{jp_raw}'"})
            continue

        key = (teacher["id"], subject["id"], school_class["id"])
        if key in existing_key:
            await db.assignments.update_one(
                {"id": existing_key[key]["id"]},
                {"$set": {"hours_per_week": jp}},
            )
            updated += 1
        else:
            doc = {
                "id": new_id("a"),
                "teacher_id": teacher["id"],
                "subject_id": subject["id"],
                "class_id": school_class["id"],
                "hours_per_week": jp,
            }
            await db.assignments.insert_one(doc)
            existing_key[key] = doc
            added += 1

    return {"ok": True, "added": added, "updated": updated, "errors": errors, "skipped": len(errors)}


# ---------------- Unified Workbook Import (1 file untuk semua) ----------------
# Format didukung: .xlsx multi-sheet (Guru, Mapel, Kelas, Penugasan_Matrix)
# Sheet Penugasan_Matrix memakai format pivot user: kolom B=NAMA GURU,
# kolom C=MATA PELAJARAN, kolom D..=nama kelas (isi sel = JP), kolom terakhir JUMLAH.
SUBJECT_COLOR_PALETTE = ["#059669", "#0EA5E9", "#F59E0B", "#8B5CF6", "#10B981",
                         "#EF4444", "#EC4899", "#F97316", "#3B82F6", "#84CC16"]


def _norm_sheet_name(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "").replace("_", "")


def _infer_grade(name: str) -> str:
    v = (name or "").strip().upper()
    if v.startswith("XII"):
        return "XII"
    if v.startswith("XI"):
        return "XI"
    if v.startswith("X"):
        return "X"
    return "X"


def _norm_header(h: Any) -> str:
    return str(h or "").strip().lstrip("\ufeff").lower()


def _find_matrix_layout(headers: List[str]):
    """Kembalikan (guru_idx, mapel_idx, class_cols[(idx, class_name)]) atau None.

    class_cols = semua kolom selain NO/guru/mapel/JUMLAH yang headernya tidak kosong.
    """
    normed = [_norm_header(h) for h in headers]
    guru_idx = mapel_idx = None
    for i, h in enumerate(normed):
        if h in ("namaguru", "nama guru", "guru", "teacher", "nama"):
            if guru_idx is None:
                guru_idx = i
        if h in ("matapelajaran", "mata pelajaran", "mapel", "subject", "pelajaran"):
            if mapel_idx is None:
                mapel_idx = i
    if guru_idx is None or mapel_idx is None:
        return None
    skip = {"no", "nomor", "#", "jumlah", "total", "jml", "keterangan", "catatan"}
    class_cols = []
    for i, h in enumerate(headers):
        if i in (guru_idx, mapel_idx):
            continue
        nh = _norm_header(h)
        if not nh or nh in skip:
            continue
        class_cols.append((i, str(h).strip()))
    if not class_cols:
        return None
    return guru_idx, mapel_idx, class_cols


@api_router.get("/import/template.xlsx")
async def download_unified_template(request: Request):
    """Unduh 1 file .xlsx terpadu: Guru + Mapel + Kelas + Penugasan_Matrix.

    Sheet Penugasan_Matrix sudah terisi dari data DB (pivot) + 20 baris kosong
    berformula JUMLAH otomatis, validasi JP 0-40, dan dropdown tingkat.
    """
    await require_user(request)
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.worksheet.datavalidation import DataValidation
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl belum terinstal di server")

    teachers = await db.teachers.find({}, {"_id": 0}).to_list(1000)
    subjects = await db.subjects.find({}, {"_id": 0}).to_list(1000)
    classes = await db.classes.find({}, {"_id": 0}).to_list(500)
    assignments = await db.assignments.find({}, {"_id": 0}).to_list(5000)
    await ensure_teacher_numbers()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(1000)
    teachers.sort(key=lambda t: (t.get("nomor") or 9999))
    order = {"X": 0, "XI": 1, "XII": 2}
    classes = sorted(classes, key=lambda c: (order.get(c.get("grade", "X"), 9), c.get("name", "")))

    t_by_id = {t["id"]: t for t in teachers}
    s_by_id = {s["id"]: s for s in subjects}
    c_by_id = {c["id"]: c for c in classes}

    wb = openpyxl.Workbook()
    hdr_font = Font(bold=True, color="FFFFFF", size=11)
    hdr_fill = PatternFill("solid", fgColor="059669")
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center")

    def style_header(ws, ncols):
        for c in range(1, ncols + 1):
            cell = ws.cell(row=1, column=c)
            cell.font = hdr_font
            cell.fill = hdr_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(ncols)}{ws.max_row}"

    # --- Petunjuk ---
    ws0 = wb.active
    ws0.title = "Petunjuk"
    guide = [
        ["IMPORT TERPADU JADWALPRO — 1 FILE UNTUK SEMUA DATA"],
        [""],
        ["1. Sheet Guru: kolom nomor = PRIMARY KEY guru (dipakai di Views & referensi)."],
        ["   Sheet Mapel: kolom kode = PRIMARY KEY mapel. Sheet Kelas: wali_kelas = nomor/nama guru."],
        ["2. Isi sheet Penugasan_Matrix: tiap baris = 1 guru + 1 mapel, tiap kolom"],
        ["   kelas = JP per minggu (kosongkan / isi 0 bila tidak mengajar). Kolom kelas"],
        ["   mengikuti data Kelas saat ini. Guru boleh ditulis nomor saja ('27')."],
        ["3. Kolom JUMLAH terisi otomatis (formula). Jangan hapus header baris 1."],
        ["4. Guru/mapel/kelas baru otomatis dibuat saat upload (warna mapel otomatis)."],
        ["5. Upload SEKALI di halaman Teaching Load → Unggah Terpadu (.xlsx)."],
        [""],
        ["Aturan: JP 0-40 (bilangan bulat). Tingkat hanya X / XI / XII."],
        ["Duplikat (guru+mapel+kelas sama) akan di-update, bukan dobel."],
    ]
    for r in guide:
        ws0.append(r)
    ws0["A1"].font = Font(bold=True, size=13, color="059669")
    ws0.column_dimensions["A"].width = 78

    # --- Guru ---
    ws1 = wb.create_sheet("Guru")
    ws1.append(["nomor", "nama", "email", "whatsapp", "catatan"])
    for t in teachers:
        ws1.append([t.get("nomor", ""), t.get("name", ""), t.get("email", ""),
                    t.get("whatsapp", ""), t.get("notes", "")])
    if not teachers:
        ws1.append([1, "Drs. Dadang Ahmad Tajudin", "", "081200000001", "Contoh"])
    style_header(ws1, 5)
    for w, col in zip([10, 32, 24, 18, 30], "ABCDE"):
        ws1.column_dimensions[col].width = w

    # --- Mapel ---
    ws2 = wb.create_sheet("Mapel")
    ws2.append(["nama", "kode"])
    for s in subjects:
        ws2.append([s.get("name", ""), s.get("code", "")])
    if not subjects:
        ws2.append(["Matematika", "MTK"])
        ws2.append(["Fiqih", "FQH"])
    style_header(ws2, 2)
    for w, col in zip([30, 12], "AB"):
        ws2.column_dimensions[col].width = w

    # --- Kelas ---
    ws3 = wb.create_sheet("Kelas")
    ws3.append(["nama", "tingkat", "wali_kelas"])
    for c in classes:
        w = t_by_id.get(c.get("wali_kelas_id", ""), {})
        wali = f"{w['nomor']}. {w['name']}" if w.get("nomor") else w.get("name", "")
        ws3.append([c.get("name", ""), c.get("grade", ""), wali])
    if not classes:
        for n, g in [("X-1", "X"), ("X-2", "X"), ("XI-1", "XI"), ("XII-1", "XII")]:
            ws3.append([n, g, ""])
    style_header(ws3, 3)
    ws3.column_dimensions["A"].width = 18
    ws3.column_dimensions["B"].width = 12
    ws3.column_dimensions["C"].width = 30
    dv_grade = DataValidation(type="list", formula1='"X,XI,XII"', allow_blank=True)
    dv_grade.error = "Tingkat harus X / XI / XII"
    dv_grade.prompt = "Pilih tingkat"
    ws3.add_data_validation(dv_grade)
    dv_grade.add(f"B2:B{max(ws3.max_row + 50, 100)}")

    # --- Penugasan_Matrix (format pivot user) ---
    ws4 = wb.create_sheet("Penugasan_Matrix")
    class_names = [c["name"] for c in classes] or ["X-1", "X-2", "XI-1", "XI-2", "XII-1", "XII-2"]
    header = ["NO", "NAMA GURU", "MATA PELAJARAN"] + class_names + ["JUMLAH"]
    ws4.append(header)
    # Pivot assignments -> matrix rows
    pivot: Dict[tuple, Dict[str, int]] = {}
    for a in assignments:
        t = t_by_id.get(a.get("teacher_id"))
        s = s_by_id.get(a.get("subject_id"))
        c = c_by_id.get(a.get("class_id"))
        if not t or not s or not c:
            continue
        key = (t["name"], s["name"])
        pivot.setdefault(key, {})[c["name"]] = a.get("hours_per_week", 0)
    rno = 0
    for (tname, sname), per_class in sorted(pivot.items()):
        rno += 1
        ws4.append([rno, tname, sname] + [per_class.get(cn, "") for cn in class_names] + [None])
    if rno == 0:  # contoh 2 baris bila DB kosong
        ws4.append([1, "Drs. Dadang Ahmad Tajudin", "Matematika"] + [2, 2, "", 2, 2, "", None][:len(class_names)] + [None])
    first_empty = ws4.max_row + 1
    for i in range(20):  # baris kosong siap isi
        rno += 1
        ws4.append([rno, "", ""] + [""] * len(class_names) + [None])
    # Formula JUMLAH = SUM(kolom kelas)
    jml_col = len(header)  # 1-based
    first_class_col = 4
    last_class_col = 3 + len(class_names)
    for r in range(2, ws4.max_row + 1):
        ws4.cell(row=r, column=jml_col).value = (
            f"=SUM({get_column_letter(first_class_col)}{r}:{get_column_letter(last_class_col)}{r})"
        )
        ws4.cell(row=r, column=jml_col).alignment = center
    style_header(ws4, len(header))
    ws4.column_dimensions["A"].width = 6
    ws4.column_dimensions["B"].width = 34
    ws4.column_dimensions["C"].width = 24
    for c in range(first_class_col, last_class_col + 1):
        ws4.column_dimensions[get_column_letter(c)].width = 10
    ws4.column_dimensions[get_column_letter(jml_col)].width = 10
    dv_jp = DataValidation(type="whole", operator="between", formula1="0", formula2="40", allow_blank=True)
    dv_jp.error = "JP harus bilangan 0-40 (kosong = tidak mengajar)"
    dv_jp.prompt = "Isi JP 0-40"
    ws4.add_data_validation(dv_jp)
    dv_jp.add(f"{get_column_letter(first_class_col)}2:{get_column_letter(last_class_col)}{ws4.max_row + 50}")
    _ = first_empty  # penanda baris contoh vs kosong (tak dipakai di server)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=template_import_jadwal.xlsx"},
    )


@api_router.post("/import/workbook")
async def upload_unified_workbook(request: Request, file: UploadFile = File(...)):
    """Upload SEKALI 1 file .xlsx terpadu (Guru/Mapel/Kelas/Penugasan_Matrix).

    - Sheet master opsional; bila tidak ada, master dibuat otomatis dari matrix.
    - Sheet matrix format pivot (NAMA GURU | MATA PELAJARAN | kolom-kolom kelas = JP).
    - Juga menerima format panjang (nama_guru, mata_pelajaran, kelas, jp) bila
      sheet matrix ternyata berheader long-format.
    """
    await require_user(request)
    fname = (file.filename or "").lower()
    if not fname.endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="File harus berformat .xlsx (gunakan Template Terpadu)")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File kosong")
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl belum terinstal di server")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=False)
    except Exception:
        raise HTTPException(status_code=400, detail="File .xlsx tidak valid / rusak")

    def rows_of(ws):
        out = []
        for row in ws.iter_rows(values_only=True):
            vals = [( "" if v is None else str(v).strip()) for v in row]
            if any(vals):
                out.append(vals)
        return out

    sheets = {ws.title: rows_of(ws) for ws in wb.worksheets}
    norm_map = {_norm_sheet_name(t): t for t in sheets}

    def pick(*names):
        for n in names:
            if n in norm_map:
                return norm_map[n]
        return None

    guru_sheet = pick("guru", "gurus", "teacher", "teachers", "dataguru", "masterguru")
    mapel_sheet = pick("mapel", "mapels", "subject", "subjects", "matapelajaran", "pelajaran")
    mapel_sheet = mapel_sheet or pick("pelajaran")
    kelas_sheet = pick("kelas", "class", "classes", "datakelas", "rombel", "masterkelas")
    matrix_sheet = pick("penugasanmatrix", "penugasan", "tpenugasan", "assignments",
                        "assignment", "teachingload", "bebanmengajar", "jadwal", "matrix")
    if matrix_sheet is None and len(sheets) == 1:
        matrix_sheet = next(iter(sheets))  # single-sheet = anggap matrix

    summary: Dict[str, Any] = {"guru": {"added": 0, "updated": 0},
                               "mapel": {"added": 0, "updated": 0},
                               "kelas": {"added": 0, "updated": 0},
                               "penugasan": {"added": 0, "updated": 0}}
    errors: List[dict] = []

    def push_err(sheet, row, msg):
        if len(errors) < 80:
            errors.append({"sheet": sheet, "row": row, "message": msg})

    # ---- Master: guru (nomor = PK) ----
    await ensure_teacher_numbers()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(2000)
    t_by_nomor = {t["nomor"]: t for t in teachers if t.get("nomor") is not None}
    t_by_name = {t["name"].strip().lower(): t for t in teachers}
    t_nxt = (max(t_by_nomor) if t_by_nomor else 0) + 1
    if guru_sheet:
        rows = sheets[guru_sheet]
        if rows:
            hdr = [_norm_header(h) for h in rows[0]]
            ci = {h: i for i, h in enumerate(hdr)}

            def col(*names):
                for n in names:
                    if n in ci:
                        return ci[n]
                return None

            c_nomor = col("nomor", "no", "number", "kode_guru", "kode guru")
            c_nama = col("nama", "name", "namalengkap", "nama lengkap", "guru")
            c_email = col("email", "e-mail")
            c_wa = col("whatsapp", "wa", "nowa", "telepon", "phone")
            c_note = col("catatan", "notes", "note", "keterangan")
            if c_nama is None:
                raise HTTPException(status_code=400, detail=f"Sheet Guru: header 'nama' tidak ditemukan")
            for i, r in enumerate(rows[1:], start=2):
                def get(cidx):
                    return r[cidx].strip() if cidx is not None and cidx < len(r) else ""
                name = get(c_nama)
                if not name:
                    continue
                nomor = None
                if c_nomor is not None and get(c_nomor):
                    try:
                        nomor = int(float(get(c_nomor).replace(",", ".")))
                    except (ValueError, TypeError):
                        push_err(guru_sheet, i, f"Nomor tidak valid: '{get(c_nomor)}'")
                        continue
                target = (t_by_nomor.get(nomor) if nomor is not None else None) or t_by_name.get(name.lower())
                if target is not None and nomor is not None:
                    other = t_by_nomor.get(nomor)
                    if other is not None and other["id"] != target["id"]:
                        push_err(guru_sheet, i, f"Nomor {nomor} milik {other.get('name', '')}, tapi nama cocok dengan {target.get('name', '')} — perbaiki file")
                        continue
                    name_hit = t_by_name.get(name.lower())
                    if name_hit is not None and name_hit["id"] != target["id"]:
                        push_err(guru_sheet, i, f"Nama cocok dengan {name_hit.get('name', '')} (nomor {name_hit.get('nomor', '?')}), tapi nomor {nomor} milik {target.get('name', '')} — perbaiki file")
                        continue
                if target is not None:
                    final = target.get("nomor")
                    if nomor is not None and nomor not in t_by_nomor:
                        final = nomor
                        t_nxt = max(t_nxt, nomor + 1)
                    await db.teachers.update_one(
                        {"id": target["id"]},
                        {"$set": {"nomor": final, "name": name, "email": get(c_email),
                                  "whatsapp": get(c_wa), "notes": get(c_note)}},
                    )
                    if final is not None:
                        t_by_nomor[final] = {**target, "nomor": final, "name": name}
                    summary["guru"]["updated"] += 1
                else:
                    if nomor is None:
                        nomor = t_nxt
                        t_nxt += 1
                    if nomor in t_by_nomor:
                        push_err(guru_sheet, i, f"Nomor {nomor} sudah dipakai")
                        continue
                    doc = {"id": new_id("t"), "nomor": nomor, "name": name, "email": get(c_email),
                           "whatsapp": get(c_wa), "notes": get(c_note),
                           "availability": _default_teacher_availability()}
                    await db.teachers.insert_one(doc)
                    t_by_nomor[nomor] = doc
                    t_by_name[name.lower()] = doc
                    t_nxt = max(t_nxt, nomor + 1)
                    summary["guru"]["added"] += 1

    # ---- Master: mapel (kode = PK, warna otomatis) ----
    subjects = await db.subjects.find({}, {"_id": 0}).to_list(2000)
    s_by_code = {str(s.get("code", "")).strip().lower(): s for s in subjects if str(s.get("code", "")).strip()}
    s_by_name = {s["name"].strip().lower(): s for s in subjects}
    color_idx = len(subjects)
    if mapel_sheet:
        rows = sheets[mapel_sheet]
        if rows:
            hdr = [_norm_header(h) for h in rows[0]]
            ci = {h: i for i, h in enumerate(hdr)}

            def col(*names):
                for n in names:
                    if n in ci:
                        return ci[n]
                return None

            c_nama = col("nama", "name", "mapel", "matapelajaran", "mata pelajaran")
            c_kode = col("kode", "code", "singkatan")
            if c_nama is None:
                raise HTTPException(status_code=400, detail="Sheet Mapel: header 'nama' tidak ditemukan")
            for i, r in enumerate(rows[1:], start=2):
                def get(cidx):
                    return r[cidx].strip() if cidx is not None and cidx < len(r) else ""
                name = get(c_nama)
                if not name:
                    continue
                code = get(c_kode)
                target = (s_by_code.get(code.lower()) if code else None) or s_by_name.get(name.lower())
                if target is not None:
                    final_code = target.get("code", "") or code
                    if code and code.lower() not in s_by_code:
                        final_code = code
                    await db.subjects.update_one(
                        {"id": target["id"]},
                        {"$set": {"name": name, "code": final_code}},
                    )
                    if final_code:
                        s_by_code[final_code.lower()] = target
                    summary["mapel"]["updated"] += 1
                else:
                    color = auto_subject_color(color_idx)
                    color_idx += 1
                    doc = {"id": new_id("s"), "name": name, "code": code, "color": color}
                    await db.subjects.insert_one(doc)
                    if code:
                        s_by_code[code.lower()] = doc
                    s_by_name[name.lower()] = doc
                    summary["mapel"]["added"] += 1

    # ---- Master: kelas ----
    classes = await db.classes.find({}, {"_id": 0}).to_list(2000)
    c_by_name = {c["name"].strip().lower(): c for c in classes}
    if kelas_sheet:
        rows = sheets[kelas_sheet]
        if rows:
            hdr = [_norm_header(h) for h in rows[0]]
            ci = {h: i for i, h in enumerate(hdr)}

            def col(*names):
                for n in names:
                    if n in ci:
                        return ci[n]
                return None

            c_nama = col("nama", "name", "kelas", "class", "namakelas")
            c_tkt = col("tingkat", "grade", "jenjang")
            c_wali = col("walikelas", "wali kelas", "wali_kelas", "wali", "homeroom")
            if c_nama is None:
                raise HTTPException(status_code=400, detail="Sheet Kelas: header 'nama' tidak ditemukan")
            for i, r in enumerate(rows[1:], start=2):
                def get(cidx):
                    return r[cidx].strip() if cidx is not None and cidx < len(r) else ""
                name = get(c_nama)
                if not name:
                    continue
                grade = _normalize_grade(get(c_tkt)) if c_tkt is not None else _infer_grade(name)
                if not grade:
                    push_err(kelas_sheet, i, f"Tingkat tidak valid: '{get(c_tkt)}' (isi X/XI/XII)")
                    continue
                wali_id = ""
                if c_wali is not None and get(c_wali):
                    wt = resolve_teacher((t_by_nomor, t_by_name), get(c_wali))
                    if not wt:
                        push_err(kelas_sheet, i, f"Wali kelas tidak ditemukan: '{get(c_wali)}'")
                        continue
                    wali_id = wt["id"]
                key = name.lower()
                if key in c_by_name:
                    await db.classes.update_one({"id": c_by_name[key]["id"]},
                                                {"$set": {"name": name, "grade": grade,
                                                          "wali_kelas_id": wali_id}})
                    summary["kelas"]["updated"] += 1
                else:
                    doc = {"id": new_id("c"), "name": name, "grade": grade, "wali_kelas_id": wali_id}
                    await db.classes.insert_one(doc)
                    c_by_name[key] = doc
                    summary["kelas"]["added"] += 1

    # refresh maps (master baru dari sheet ikut dipakai matrix)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(2000)
    subjects = await db.subjects.find({}, {"_id": 0}).to_list(2000)
    classes = await db.classes.find({}, {"_id": 0}).to_list(2000)
    t_by_nomor = {t["nomor"]: t for t in teachers if t.get("nomor") is not None}
    t_by_name = {t["name"].strip().lower(): t for t in teachers}
    t_nxt = (max(t_by_nomor) if t_by_nomor else 0) + 1
    s_by_code = {str(s.get("code", "")).strip().lower(): s for s in subjects if str(s.get("code", "")).strip()}
    s_by_name = {s["name"].strip().lower(): s for s in subjects}
    c_by_name = {c["name"].strip().lower(): c for c in classes}
    color_idx = len(subjects)

    # ---- Penugasan (matrix pivot ATAU long-format) ----
    if matrix_sheet:
        ws = wb[matrix_sheet]
        # cari baris header dalam 5 baris pertama (antisipasi judul di atas tabel)
        header_row_idx, headers = None, None
        for r in range(1, min(6, ws.max_row + 1)):
            vals = [ws.cell(row=r, column=c).value for c in range(1, ws.max_column + 1)]
            normed = [_norm_header(v) for v in vals]
            has_guru = any(h in ("namaguru", "nama guru", "guru", "teacher", "nama") for h in normed)
            has_mapel = any(h in ("matapelajaran", "mata pelajaran", "mapel", "subject", "pelajaran") for h in normed)
            if has_guru and has_mapel:
                header_row_idx, headers = r, [("" if v is None else str(v).strip()) for v in vals]
                break
        if headers is None:
            raise HTTPException(status_code=400,
                                detail=f"Sheet {matrix_sheet}: header NAMA GURU + MATA PELAJARAN tidak ditemukan (5 baris pertama)")

        # Long-format? (header mengandung nama_guru/kelas/jp)
        long_norm = [_norm_header(h) for h in headers]
        is_long = any(h in ("namaguru", "nama_guru", "guru") for h in long_norm) and "kelas" in long_norm
        existing = await db.assignments.find({}, {"_id": 0}).to_list(5000)
        exist_key = {(a["teacher_id"], a["subject_id"], a["class_id"]): a for a in existing}

        async def ensure_teacher_from_value(value: str):
            t = resolve_teacher((t_by_nomor, t_by_name), value)
            if t:
                return t
            nonlocal t_nxt
            doc = {"id": new_id("t"), "nomor": t_nxt, "name": value.strip(), "email": "",
                   "whatsapp": "", "notes": "Auto-dibuat dari import workbook",
                   "availability": _default_teacher_availability()}
            await db.teachers.insert_one(doc)
            t_by_nomor[t_nxt] = doc
            t_by_name[value.strip().lower()] = doc
            t_nxt += 1
            summary["guru"]["added"] += 1
            return doc

        async def ensure_teacher(value: str):
            return await ensure_teacher_from_value(value)

        async def ensure_subject(value: str):
            s = resolve_subject((s_by_code, s_by_name), value)
            if s:
                return s
            nonlocal color_idx
            color = auto_subject_color(color_idx)
            color_idx += 1
            doc = {"id": new_id("s"), "name": value.strip(), "code": "", "color": color}
            await db.subjects.insert_one(doc)
            s_by_name[value.strip().lower()] = doc
            summary["mapel"]["added"] += 1
            return doc

        async def ensure_class(name: str):
            c = c_by_name.get(name.lower())
            if c:
                return c
            doc = {"id": new_id("c"), "name": name, "grade": _infer_grade(name), "wali_kelas_id": ""}
            await db.classes.insert_one(doc)
            c_by_name[name.lower()] = doc
            summary["kelas"]["added"] += 1
            return doc

        def parse_jp(v, sheet, excel_row):
            if v is None or (isinstance(v, str) and not v.strip()) or v == "":
                return 0
            try:
                jp = int(float(str(v).strip().replace(",", ".")))
            except (ValueError, TypeError):
                push_err(sheet, excel_row, f"JP tidak valid: '{v}' (harus angka 0-40)")
                return None
            if jp < 0 or jp > 40:
                push_err(sheet, excel_row, f"JP di luar 0-40: '{v}'")
                return None
            return jp

        if is_long:
            # format panjang: cari indeks kolom
            idx = {h: i for i, h in enumerate(long_norm)}
            ci_g = next((idx[h] for h in ("namaguru", "nama_guru", "guru") if h in idx), None)
            ci_m = next((idx[h] for h in ("matapelajaran", "mata_pelajaran", "mapel", "subject") if h in idx), None)
            ci_c, ci_j = idx.get("kelas"), next((idx.get(h) for h in ("jp_per_minggu", "jpperm", "jp", "hours") if h in idx), None)
            for excel_row in range(header_row_idx + 1, ws.max_row + 1):
                vals = [ws.cell(row=excel_row, column=c).value for c in range(1, len(headers) + 1)]

                def gv(i):
                    return "" if i is None or i >= len(vals) or vals[i] is None else str(vals[i]).strip()
                tname, sname, cname, jp_raw = gv(ci_g), gv(ci_m), gv(ci_c), vals[ci_j] if ci_j is not None and ci_j < len(vals) else ""
                if not (tname or sname or cname or jp_raw):
                    continue
                if not (tname and sname and cname):
                    push_err(matrix_sheet, excel_row, "Guru/mapel/kelas wajib diisi")
                    continue
                jp = parse_jp(jp_raw, matrix_sheet, excel_row)
                if jp is None or jp == 0:
                    continue
                t = await ensure_teacher(tname)
                s = await ensure_subject(sname)
                c = await ensure_class(cname)
                key = (t["id"], s["id"], c["id"])
                if key in exist_key:
                    await db.assignments.update_one({"id": exist_key[key]["id"]}, {"$set": {"hours_per_week": jp}})
                    summary["penugasan"]["updated"] += 1
                else:
                    doc = {"id": new_id("a"), "teacher_id": t["id"], "subject_id": s["id"],
                           "class_id": c["id"], "hours_per_week": jp}
                    await db.assignments.insert_one(doc)
                    exist_key[key] = doc
                    summary["penugasan"]["added"] += 1
        else:
            layout = _find_matrix_layout(headers)
            if layout is None:
                raise HTTPException(status_code=400,
                                    detail=f"Sheet {matrix_sheet}: kolom kelas tidak terdeteksi (tambah kolom nama kelas setelah MATA PELAJARAN)")
            gi, mi, class_cols = layout
            for excel_row in range(header_row_idx + 1, ws.max_row + 1):
                vals = [ws.cell(row=excel_row, column=c).value for c in range(1, len(headers) + 1)]

                def gv(i):
                    return "" if i >= len(vals) or vals[i] is None else str(vals[i]).strip()
                tname, sname = gv(gi), gv(mi)
                if not tname and not sname:
                    continue  # baris kosong
                if not tname or not sname:
                    push_err(matrix_sheet, excel_row, "NAMA GURU & MATA PELAJARAN wajib diisi")
                    continue
                t = await ensure_teacher(tname)
                s = await ensure_subject(sname)
                for ci, cname in class_cols:
                    cell = vals[ci] if ci < len(vals) else None
                    jp = parse_jp(cell, matrix_sheet, excel_row)
                    if jp is None or jp == 0:
                        continue
                    c = await ensure_class(cname)
                    key = (t["id"], s["id"], c["id"])
                    if key in exist_key:
                        await db.assignments.update_one({"id": exist_key[key]["id"]},
                                                        {"$set": {"hours_per_week": jp}})
                        summary["penugasan"]["updated"] += 1
                    else:
                        doc = {"id": new_id("a"), "teacher_id": t["id"], "subject_id": s["id"],
                               "class_id": c["id"], "hours_per_week": jp}
                        await db.assignments.insert_one(doc)
                        exist_key[key] = doc
                        summary["penugasan"]["added"] += 1

    return {"ok": True, "summary": summary, "errors": errors, "skipped": len(errors)}


# ---------------- Schedule ----------------
async def load_all_schedule() -> List[dict]:
    return await db.schedule.find({}, {"_id": 0}).to_list(5000)


def get_valid_slots(day: str) -> List[int]:
    return FRIDAY_SLOTS if day == "Friday" else REGULAR_SLOTS


def detect_conflicts(schedule: List[dict], teachers: List[dict], valid_slots_by_day: Optional[Dict[str, set]] = None, limits: Optional[Dict[str, Dict[str, int]]] = None) -> List[dict]:
    conflicts = []
    teacher_map = {t["id"]: t for t in teachers}
    # 1 & 3: teacher & class double-booked
    seen_teacher = {}
    seen_class = {}
    for s in schedule:
        key_t = (s["teacher_id"], s["day"], s["slot"])
        key_c = (s["class_id"], s["day"], s["slot"])
        if key_t in seen_teacher:
            conflicts.append({
                "type": "teacher_double_booked",
                "day": s["day"], "slot": s["slot"],
                "teacher_id": s["teacher_id"],
                "class_ids": [seen_teacher[key_t]["class_id"], s["class_id"]],
                "message": f"Guru diassign ke 2 kelas pada {s['day']} JP{s['slot']}"
            })
        else:
            seen_teacher[key_t] = s
        if key_c in seen_class:
            conflicts.append({
                "type": "class_double_booked",
                "day": s["day"], "slot": s["slot"],
                "class_id": s["class_id"],
                "message": f"Kelas double-booked pada {s['day']} JP{s['slot']}"
            })
        else:
            seen_class[key_c] = s
    # 2: availability violation
    for s in schedule:
        t = teacher_map.get(s["teacher_id"])
        if not t:
            continue
        key = f"{s['day']}-{s['slot']}"
        if t.get("availability", {}).get(key) == "unavailable":
            conflicts.append({
                "type": "availability_violation",
                "day": s["day"], "slot": s["slot"],
                "teacher_id": s["teacher_id"],
                "class_id": s["class_id"],
                "message": f"{t['name']} tidak tersedia pada {s['day']} JP{s['slot']}"
            })
        if valid_slots_by_day is not None and s["day"] in valid_slots_by_day:
            valid = valid_slots_for(valid_slots_by_day, limits or {}, s["class_id"], s["day"])
            if s["slot"] not in valid:
                conflicts.append({
                    "type": "invalid_slot",
                    "day": s["day"], "slot": s["slot"],
                    "class_id": s["class_id"],
                    "message": f"{s['day']} JP{s['slot']} di luar batas konfigurasi kelas ini"
                })
    return conflicts


@api_router.get("/schedule")
async def get_schedule(request: Request):
    await require_user(request)
    docs = await load_all_schedule()
    return docs


@api_router.post("/schedule")
async def upsert_slot(payload: ScheduleSlot, request: Request, force: bool = False):
    """Tempatkan 1 slot manual dengan validasi constraint.

    - Guru double-booked (kelas lain di day+slot sama): SELALU ditolak (409).
    - Guru unavailable / slot invalid: ditolak (409) kecuali force=true.
    """
    await require_user(request)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    classes = await db.classes.find({}, {"_id": 0}).to_list(500)
    teacher_map = {t["id"]: t for t in teachers}
    class_map = {c["id"]: c for c in classes}
    valid_slots_by_day = await get_valid_slots_by_day()
    limits = await load_class_limits()

    teacher = teacher_map.get(payload.teacher_id)
    tname = teacher["name"] if teacher else payload.teacher_id
    valid = valid_slots_for(valid_slots_by_day, limits, payload.class_id, payload.day)
    if payload.day in valid_slots_by_day and payload.slot not in valid:
        raise HTTPException(status_code=409, detail={
            "code": "invalid_slot", "can_force": False,
            "message": f"{payload.day} JP{payload.slot} di luar batas konfigurasi kelas ini",
        })
    clash = await db.schedule.find_one({
        "teacher_id": payload.teacher_id,
        "day": payload.day,
        "slot": payload.slot,
        "class_id": {"$ne": payload.class_id},
    }, {"_id": 0})
    if clash:
        other = class_map.get(clash["class_id"], {}).get("name", clash["class_id"])
        raise HTTPException(status_code=409, detail={
            "code": "teacher_double_booked", "can_force": False,
            "message": f"{tname} sudah mengajar kelas {other} pada {payload.day} JP{payload.slot}",
        })
    if teacher and teacher.get("availability", {}).get(f"{payload.day}-{payload.slot}") == "unavailable" and not force:
        raise HTTPException(status_code=409, detail={
            "code": "availability_violation", "can_force": True,
            "message": f"{tname} tidak tersedia pada {payload.day} JP{payload.slot}",
        })
    # remove any existing slot for that class+day+slot (class-owns-slot)
    await db.schedule.delete_many({
        "class_id": payload.class_id,
        "day": payload.day,
        "slot": payload.slot,
    })
    await db.schedule.insert_one(payload.model_dump())
    return payload


@api_router.delete("/schedule/{schedule_id}")
async def delete_slot(schedule_id: str, request: Request):
    await require_user(request)
    await db.schedule.delete_one({"id": schedule_id})
    return {"ok": True}


@api_router.post("/schedule/clear")
async def clear_schedule(request: Request):
    await require_user(request)
    result = await db.schedule.delete_many({})
    return {"ok": True, "deleted": result.deleted_count}


@api_router.get("/schedule/conflicts")
async def get_conflicts(request: Request):
    await require_user(request)
    schedule = await load_all_schedule()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    valid = await get_valid_slots_by_day()
    limits = await load_class_limits()
    return detect_conflicts(schedule, teachers, valid, limits)


@api_router.post("/schedule/auto")
async def auto_schedule(request: Request):
    """Greedy constraint-satisfaction scheduler."""
    await require_user(request)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    assignments = await db.assignments.find({}, {"_id": 0}).to_list(1000)
    existing = await load_all_schedule()
    valid_slots_by_day = await get_valid_slots_by_day()
    breaks_after = await get_breaks_after_map()
    limits = await load_class_limits()

    new_slots = _greedy_fill(assignments, {t["id"]: t for t in teachers}, existing, valid_slots_by_day,
                             breaks_after, limits)

    if new_slots:
        await db.schedule.insert_many(new_slots)
    total = len(await load_all_schedule())
    return {"ok": True, "added": len(new_slots), "total_slots": total}


def _split_blocks(n: int) -> List[int]:
    """Pecah N JP menjadi blok 2/3: 1->[1], 4->[2,2], 5->[3,2], 6->[3,3], 7->[3,2,2]."""
    blocks = []
    while n > 4:
        blocks.append(3)
        n -= 3
    if n == 4:
        blocks.extend([2, 2])
    elif n > 0:
        blocks.append(n)
    return blocks


def _runs_of(slots_sorted: List[int], k: int, breaks: set) -> List[List[int]]:
    """Semua run k slot bernomor urut tanpa menyeberangi break."""
    out = []
    for i in range(len(slots_sorted) - k + 1):
        window = slots_sorted[i:i + k]
        if any(window[j + 1] - window[j] != 1 for j in range(k - 1)):
            continue
        if any(p in breaks for p in window[:-1]):
            continue
        out.append(window)
    return out


def _greedy_fill(assignments: List[dict], teacher_map: Dict[str, dict],
                 existing: List[dict], valid_slots_by_day: Dict[str, set],
                 breaks_after: Optional[Dict[str, set]] = None,
                 limits: Optional[Dict[str, Dict[str, int]]] = None) -> List[dict]:
    """Isi kekurangan JP secara greedy dengan menghormati occupancy + availability.

    Aturan blok: JP > 1 untuk (guru, mapel, kelas) yang sama WAJIB berurutan
    dalam blok 2/3 JP pada hari yang sama (tidak menyeberangi istirahat).
    Pembagian: 1->[1], 2->[2], 3->[3], 4->[2,2], 5->[3,2], 6->[3,3], 7->[3,2,2], dst.
    Bila blok tak muat di mana pun (ketersediaan terfragmentasi), JP blok itu
    dipasang satuan agar tidak ada jam yang hilang.
    Sisa JP yang bahkan tak muat satuan bersih TETAP dipasang (force) dengan
    pelanggaran minimal — selnya otomatis merah via detect_conflicts.

    Dipakai oleh /schedule/auto dan /schedule/rebuild (logika identik).
    """
    breaks_after = breaks_after or {}
    limits = limits or {}

    def valid_here(class_id: str, day: str) -> List[int]:
        return sorted(valid_slots_for(valid_slots_by_day, limits, class_id, day))

    def split_blocks(n: int) -> List[int]:
        return _split_blocks(n)

    def runs_of(slots_sorted: List[int], k: int, day: str) -> List[List[int]]:
        """Semua run k slot bernomor urut tanpa menyeberangi break."""
        return _runs_of(slots_sorted, k, breaks_after.get(day, set()))

    # occupancy trackers
    class_slots: Dict[tuple, bool] = {}  # (class_id, day, slot) -> occupied
    teacher_slots: Dict[tuple, bool] = {}  # (teacher_id, day, slot)
    for s in existing:
        class_slots[(s["class_id"], s["day"], s["slot"])] = True
        teacher_slots[(s["teacher_id"], s["day"], s["slot"])] = True

    # existing hours placed per assignment
    placed_per_assignment: Dict[tuple, int] = {}  # (teacher, subject, class) -> count
    triple_slots: Dict[tuple, set] = {}  # (teacher, subject, class) -> {(day, slot)}
    for s in existing:
        k = (s["teacher_id"], s["subject_id"], s["class_id"])
        placed_per_assignment[k] = placed_per_assignment.get(k, 0) + 1
        triple_slots.setdefault(k, set()).add((s["day"], s["slot"]))

    # Sort assignments: those with more constrained teachers first
    def teacher_constraint_count(a):
        t = teacher_map.get(a["teacher_id"])
        if not t:
            return 0
        return sum(1 for v in t.get("availability", {}).values() if v == "unavailable")

    assignments_sorted = sorted(assignments, key=teacher_constraint_count, reverse=True)

    def slot_free(a: dict, teacher: dict, day: str, slot: int,
                  class_slots: dict, teacher_slots: dict) -> bool:
        if class_slots.get((a["class_id"], day, slot)):
            return False
        if teacher_slots.get((a["teacher_id"], day, slot)):
            return False
        if teacher.get("availability", {}).get(f"{day}-{slot}", "available") == "unavailable":
            return False
        return True

    def occupy(a: dict, day: str, slot: int, class_slots: dict, teacher_slots: dict,
               new_slots: list, placed_box: List[int]) -> None:
        new_slots.append({
            "id": new_id("sch"),
            "class_id": a["class_id"],
            "day": day,
            "slot": slot,
            "subject_id": a["subject_id"],
            "teacher_id": a["teacher_id"],
        })
        class_slots[(a["class_id"], day, slot)] = True
        teacher_slots[(a["teacher_id"], day, slot)] = True
        placed_box[0] += 1

    def violation_score(a: dict, teacher: dict, day: str, slot: int,
                        class_slots: dict, teacher_slots: dict) -> int:
        """Skor pelanggaran bila dipasang paksa (0 = bersih)."""
        score = 0
        if teacher_slots.get((a["teacher_id"], day, slot)):
            score += 10  # guru bentrok
        if teacher.get("availability", {}).get(f"{day}-{slot}", "available") == "unavailable":
            score += 5  # di luar availability
        if class_slots.get((a["class_id"], day, slot)):
            score += 7  # kelas terisi
        return score

    new_slots = []
    for a in assignments_sorted:
        teacher = teacher_map.get(a["teacher_id"])
        if not teacher:
            continue
        needed = a["hours_per_week"] - placed_per_assignment.get(
            (a["teacher_id"], a["subject_id"], a["class_id"]), 0
        )
        if needed <= 0:
            continue
        placed_box = [0]
        key = (a["teacher_id"], a["subject_id"], a["class_id"])
        taken = set(triple_slots.get(key, set()))  # slot triple ini (ada + baru), anti-dempet blok
        for k in split_blocks(needed):
            done = False
            if k > 1:
                # cari run k slot berurutan di hari yang sama, tak bersentuhan
                # dengan slot triple-sama (agar run maks 3) dan tak menyeberangi break
                for day in DAYS:
                    valid = valid_here(a["class_id"], day)
                    for run in runs_of(valid, k, day):
                        if (day, run[0] - 1) in taken or (day, run[-1] + 1) in taken:
                            continue
                        if all(slot_free(a, teacher, day, s, class_slots, teacher_slots) for s in run):
                            for s in run:
                                occupy(a, day, s, class_slots, teacher_slots, new_slots, placed_box)
                                taken.add((day, s))
                            done = True
                            break
                    if done:
                        break
            if not done:
                # fallback: pasang satuan (first-fit) agar JP tidak hilang
                for _ in range(k):
                    for day in DAYS:
                        valid = valid_here(a["class_id"], day)
                        fitted = False
                        for slot in valid:
                            if slot_free(a, teacher, day, slot, class_slots, teacher_slots):
                                occupy(a, day, slot, class_slots, teacher_slots, new_slots, placed_box)
                                fitted = True
                                break
                        if fitted:
                            break
        short = needed - placed_box[0]
        for _ in range(max(0, short)):
            # FORCE: sisa JP wajib masuk tabel meski melanggar — pilih slot
            # dengan skor pelanggaran terkecil (otomatis merah via detect_conflicts)
            best = None
            best_score = None
            for day in DAYS:
                for slot in valid_here(a["class_id"], day):
                    sc = violation_score(a, teacher, day, slot, class_slots, teacher_slots)
                    if best_score is None or sc < best_score:
                        best_score = sc
                        best = (day, slot)
                        if sc == 0:
                            break
                if best_score == 0:
                    break
            if best is None:
                break
            occupy(a, best[0], best[1], class_slots, teacher_slots, new_slots, placed_box)
    return new_slots


def solve_timetable_cpsat(assignments: List[dict], teacher_map: Dict[str, dict],
                          valid_slots_by_day: Dict[str, set],
                          breaks_after: Dict[str, set],
                          time_limit_s: float = 60.0,
                          limits: Optional[Dict[str, Dict[str, int]]] = None) -> dict:
    """Optimasi jadwal global dengan Google OR-Tools CP-SAT (gratis, eksak).

    - Tiap assignment dipecah jadi blok 2/3 JP (_split_blocks).
    - Tiap blok WAJIB terpasang tepat sekali sebagai 1 run berurutan
      (tak menyeberangi break) -> tidak ada slot tersisa.
    - Bentrok guru, bentrok kelas, dan pelanggaran availability dimodelkan
      sebagai penalti (100/100/10 per slot) yang diminimalkan.
    - Penalti 0 + status OPTIMAL = solusi nol-konflik yang terbukti optimal.
    """
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    # susun blok
    blocks = []  # {teacher_id, subject_id, class_id, k}
    for a in assignments:
        need = int(a.get("hours_per_week") or 0)
        if need <= 0 or a.get("teacher_id") not in teacher_map:
            continue
        for k in _split_blocks(need):
            blocks.append({"teacher_id": a["teacher_id"], "subject_id": a["subject_id"],
                           "class_id": a["class_id"], "k": k})

    day_slots = {d: sorted(valid_slots_by_day.get(d, set())) for d in DAYS}
    limits = limits or {}
    day_slots_for = lambda cid, d: sorted(valid_slots_for(valid_slots_by_day, limits, cid, d))
    y_vars = []  # (block_idx, day, run_tuple, var, unav_count)
    cover_teacher: Dict[tuple, list] = {}  # (t,day,slot) -> [var]
    cover_class: Dict[tuple, list] = {}  # (c,day,slot) -> [var]
    obj_terms = []
    for bi, b in enumerate(blocks):
        teacher = teacher_map[b["teacher_id"]]
        cands = []
        for day in DAYS:
            for run in _runs_of(day_slots_for(b["class_id"], day), b["k"], breaks_after.get(day, set())):
                unav = sum(1 for s in run
                           if teacher.get("availability", {}).get(f"{day}-{s}", "available") == "unavailable")
                v = model.NewBoolVar(f"b{bi}_{day}_{run[0]}")
                cands.append((day, tuple(run), v, unav))
                for s in run:
                    cover_teacher.setdefault((b["teacher_id"], day, s), []).append(v)
                    cover_class.setdefault((b["class_id"], day, s), []).append(v)
        if not cands:  # tak ada run valid untuk blok ini (konfigurasi ekstrem)
            return {"status": "INFEASIBLE_MODEL", "entries": [], "penalty": None, "wall_time": 0.0}
        model.Add(sum(v for _, _, v, _ in cands) == 1)
        for day, run, v, unav in cands:
            y_vars.append((bi, day, run, v, unav))
            if unav:
                obj_terms.append(unav * 10 * v)

    # beban per sel -> penalti bentrok
    for key, vs in cover_teacher.items():
        load = sum(vs)
        if len(vs) > 1:
            over = model.NewIntVar(0, len(vs), f"ot_{key}")
            model.Add(over >= load - 1)
            obj_terms.append(100 * over)
    for key, vs in cover_class.items():
        load = sum(vs)
        if len(vs) > 1:
            over = model.NewIntVar(0, len(vs), f"oc_{key}")
            model.Add(over >= load - 1)
            obj_terms.append(100 * over)

    model.Minimize(sum(obj_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)
    name = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE", cp_model.UNKNOWN: "UNKNOWN"}.get(status, str(status))
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": name, "entries": [], "penalty": None, "wall_time": solver.WallTime()}

    entries = []
    for bi, day, run, v, _ in y_vars:
        if solver.Value(v):
            b = blocks[bi]
            for s in run:
                entries.append({"id": new_id("sch"), "class_id": b["class_id"], "day": day,
                                "slot": s, "subject_id": b["subject_id"],
                                "teacher_id": b["teacher_id"]})
    return {"status": name, "entries": entries, "penalty": int(solver.ObjectiveValue()),
            "wall_time": solver.WallTime()}


@api_router.post("/schedule/optimize")
async def optimize_schedule(request: Request, time_limit: float = 60.0):
    """Regenerasi SELURUH jadwal dengan AI optimizer (OR-Tools CP-SAT).

    Menjamin: semua JP terpasang (tak ada sisa) dengan total pelanggaran
    minimal yang terbukti optimal. Jadwal lama diganti seluruhnya.
    Query: ?time_limit=60 (detik, maks 300).
    """
    await require_user(request)
    time_limit = max(5.0, min(float(time_limit or 60.0), 300.0))
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    assignments = await db.assignments.find({}, {"_id": 0}).to_list(1000)
    valid_slots_by_day = await get_valid_slots_by_day()
    breaks_after = await get_breaks_after_map()
    limits = await load_class_limits()

    result = solve_timetable_cpsat(assignments, {t["id"]: t for t in teachers},
                                   valid_slots_by_day, breaks_after, time_limit, limits)
    if not result["entries"]:
        raise HTTPException(status_code=409, detail={
            "code": "optimize_failed", "can_force": False,
            "message": f"Optimizer gagal menemukan solusi (status {result['status']}). Jadwal tidak diubah.",
        })
    await db.schedule.delete_many({})
    await db.schedule.insert_many(result["entries"])
    schedule = await load_all_schedule()
    conflicts = detect_conflicts(schedule, teachers, valid_slots_by_day, limits)
    return {"ok": True, "placed": len(result["entries"]), "total_slots": len(schedule),
            "solver_status": result["status"], "penalty": result["penalty"],
            "wall_time": round(result["wall_time"], 1),
            "conflicts_remaining": len(conflicts), "conflicts": conflicts}


@api_router.post("/schedule/rebuild")
async def rebuild_schedule(request: Request):
    """Sinkron ulang jadwal terhadap availability & konfigurasi hari terkini.

    1. Hapus slot yang melanggar: guru double-booked (simpan 1, hapus sisanya),
       availability violation, dan invalid_slot.
    2. Isi ulang kekurangan JP secara greedy berblok 2/3; sisa yang tak muat
       bersih TETAP dipasang (pelanggaran minimal, merah) agar tak ada JP hilang.
    """
    await require_user(request)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    assignments = await db.assignments.find({}, {"_id": 0}).to_list(1000)
    existing = await load_all_schedule()
    valid_slots_by_day = await get_valid_slots_by_day()
    limits = await load_class_limits()
    teacher_map = {t["id"]: t for t in teachers}

    to_delete: List[str] = []
    removed_detail: List[dict] = []
    seen_teacher: Dict[tuple, dict] = {}
    for s in existing:
        key_t = (s["teacher_id"], s["day"], s["slot"])
        if key_t in seen_teacher:
            to_delete.append(s["id"])
            removed_detail.append({"id": s["id"], "reason": "teacher_double_booked",
                                   "day": s["day"], "slot": s["slot"],
                                   "teacher_id": s["teacher_id"], "class_id": s["class_id"]})
            continue
        seen_teacher[key_t] = s
        t = teacher_map.get(s["teacher_id"])
        reason = None
        if t and t.get("availability", {}).get(f"{s['day']}-{s['slot']}") == "unavailable":
            reason = "availability_violation"
        elif s["day"] in valid_slots_by_day and s["slot"] not in valid_slots_for(
                valid_slots_by_day, limits, s["class_id"], s["day"]):
            reason = "invalid_slot"
        if reason:
            to_delete.append(s["id"])
            removed_detail.append({"id": s["id"], "reason": reason,
                                   "day": s["day"], "slot": s["slot"],
                                   "teacher_id": s["teacher_id"], "class_id": s["class_id"]})

    if to_delete:
        await db.schedule.delete_many({"id": {"$in": to_delete}})

    remaining = [s for s in existing if s["id"] not in set(to_delete)]
    breaks_after = await get_breaks_after_map()
    new_slots = _greedy_fill(assignments, teacher_map, remaining, valid_slots_by_day, breaks_after, limits)
    if new_slots:
        await db.schedule.insert_many(new_slots)
    total = len(await load_all_schedule())
    schedule = await load_all_schedule()
    conflicts = detect_conflicts(schedule, teachers, valid_slots_by_day, limits)
    return {"ok": True, "removed": len(to_delete), "removed_detail": removed_detail,
            "added": len(new_slots), "total_slots": total,
            "conflicts_remaining": len(conflicts)}


# ---------------- Dashboard ----------------
@api_router.get("/dashboard/stats")
async def dashboard_stats(request: Request):
    await require_user(request)
    total_teachers = await db.teachers.count_documents({})
    total_classes = await db.classes.count_documents({})
    schedule = await load_all_schedule()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    valid = await get_valid_slots_by_day()
    limits = await load_class_limits()
    conflicts = detect_conflicts(schedule, teachers, valid, limits)

    # completion rate: placed_slots / required_slots from assignments
    assignments = await db.assignments.find({}, {"_id": 0}).to_list(1000)
    required = sum(a["hours_per_week"] for a in assignments)
    placed = len(schedule)
    completion = (placed / required * 100) if required > 0 else 0

    return {
        "total_teachers": total_teachers,
        "total_classes": total_classes,
        "total_conflicts": len(conflicts),
        "completion_rate": round(completion, 1),
        "total_scheduled": placed,
        "total_required": required,
    }


# ---------------- Seed ----------------
@api_router.post("/reset-all")
async def reset_all_data(request: Request):
    """Hapus SEMUA data input: guru, mapel, kelas, penugasan, jadwal.

    Koleksi users/sessions & day_configs TIDAK dihapus (data sistem).
    """
    await require_user(request)
    out = {}
    for coll in ("teachers", "subjects", "classes", "assignments", "schedule"):
        r = await db[coll].delete_many({})
        out[coll] = r.deleted_count
    return {"ok": True, "deleted": out}


BACKUP_COLLECTIONS = ("teachers", "subjects", "classes", "assignments", "schedule", "day_configs")


@api_router.get("/backup")
async def download_backup(request: Request):
    """Unduh backup JSON seluruh data + pengaturan (termasuk availability & day_configs).

    Koleksi users/sessions TIDAK ikut (data auth sistem).
    """
    await require_user(request)
    data = {}
    for coll in BACKUP_COLLECTIONS:
        data[coll] = await db[coll].find({}, {"_id": 0}).to_list(10000)
    return {"ok": True, "app": "JadwalPro", "version": 1,
            "exported_at": now_utc().isoformat(), "data": data}


@api_router.post("/restore")
async def restore_backup(request: Request, file: UploadFile = File(...)):
    """Restore dari file backup JSON. Koleksi yang ada di file diganti seluruhnya.

    Validasi ringan: tiap dokumen wajib punya field `id`. Item invalid dilewati
    dan dilaporkan (maks 80).
    """
    await require_user(request)
    fname = (file.filename or "").lower()
    if not fname.endswith(".json"):
        raise HTTPException(status_code=400, detail="File harus berformat .json (hasil Unduh Backup)")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File kosong")
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except Exception:
        raise HTTPException(status_code=400, detail="File JSON tidak valid / rusak")
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Format backup tidak dikenal (kunci 'data' hilang)")
    known = [c for c in BACKUP_COLLECTIONS if c in data]
    if not known:
        raise HTTPException(status_code=400, detail="File backup tidak berisi koleksi yang dikenal")
    result: Dict[str, Any] = {}
    errors: List[dict] = []
    for coll in known:
        docs = data[coll]
        if not isinstance(docs, list):
            errors.append({"sheet": coll, "row": 0, "message": "Bukan list — koleksi dilewati"})
            continue
        clean = []
        for i, d in enumerate(docs, start=1):
            if not isinstance(d, dict) or not d.get("id"):
                if len(errors) < 80:
                    errors.append({"sheet": coll, "row": i, "message": "Dokumen tanpa field 'id' — dilewati"})
                continue
            d = {k: v for k, v in d.items() if k != "_id"}
            clean.append(d)
        await db[coll].delete_many({})
        if clean:
            await db[coll].insert_many(clean)
        result[coll] = len(clean)
    return {"ok": True, "restored": result, "errors": errors, "skipped": len(errors)}


def build_availability(rules: List[dict]) -> Dict[str, str]:
    """Build availability dict from rules list of {days: [], slots: [], status: 'unavailable'}.
    Default is 'available'."""
    availability = {}
    for day in DAYS:
        valid_slots = get_valid_slots(day)
        for slot in valid_slots:
            availability[f"{day}-{slot}"] = "available"
    for rule in rules:
        for day in rule.get("days", DAYS):
            slots = rule.get("slots") or get_valid_slots(day)
            for slot in slots:
                availability[f"{day}-{slot}"] = rule.get("status", "unavailable")
    return availability


@api_router.post("/seed")
async def seed_data(request: Request):
    await require_user(request)

    # Clear only reference data if empty
    if await db.classes.count_documents({}) == 0:
        classes = [
            {"id": new_id("c"), "name": "X-1", "grade": "X"},
            {"id": new_id("c"), "name": "X-2", "grade": "X"},
            {"id": new_id("c"), "name": "XI-1", "grade": "XI"},
            {"id": new_id("c"), "name": "XI-2", "grade": "XI"},
            {"id": new_id("c"), "name": "XII-1", "grade": "XII"},
            {"id": new_id("c"), "name": "XII-2", "grade": "XII"},
        ]
        await db.classes.insert_many(classes)
        # Aturan sekolah: Jumat X-1/X-2 hanya 7 JP
        await ensure_day_configs()
        x_ids = [c["id"] for c in classes if c["name"] in ("X-1", "X-2")]
        if x_ids:
            await db.day_configs.update_one(
                {"day": "Friday"},
                {"$set": {"class_limits": {cid: 7 for cid in x_ids}}},
            )

    if await db.subjects.count_documents({}) == 0:
        subjects = [
            {"id": new_id("s"), "name": "Matematika", "code": "MTK", "color": "#059669"},
            {"id": new_id("s"), "name": "TIK", "code": "TIK", "color": "#0EA5E9"},
            {"id": new_id("s"), "name": "Bahasa Arab", "code": "ARB", "color": "#F59E0B"},
            {"id": new_id("s"), "name": "Fiqih", "code": "FQH", "color": "#8B5CF6"},
            {"id": new_id("s"), "name": "Al-Qur'an", "code": "QUR", "color": "#10B981"},
            {"id": new_id("s"), "name": "Bahasa Indonesia", "code": "BIN", "color": "#EF4444"},
            {"id": new_id("s"), "name": "Akuntansi", "code": "AKN", "color": "#EC4899"},
            {"id": new_id("s"), "name": "Sejarah", "code": "SEJ", "color": "#F97316"},
        ]
        await db.subjects.insert_many(subjects)

    if await db.teachers.count_documents({}) == 0:
        # Dhuhr divider: JP 1-4 = "before Dhuhr", JP 5-10 = "after Dhuhr"
        BEFORE_DHUHR = [1, 2, 3, 4]
        AFTER_DHUHR = [5, 6, 7, 8, 9, 10]
        AFTER_DHUHR_FRIDAY = [5, 6, 7, 8]

        teachers = [
            {
                "id": new_id("t"),
                "nomor": 1,
                "name": "Drs. Dadang Ahmad Tajudin",
                "email": "", "whatsapp": "",
                "notes": "Tidak tersedia Sabtu-Ahad; hanya slot 08:30-10:30 (JP 3-4).",
                "availability": build_availability([
                    {"days": ["Saturday"], "status": "unavailable"},
                    # after Dhuhr all days unavailable
                    {"days": ["Monday", "Tuesday", "Wednesday", "Thursday"], "slots": AFTER_DHUHR, "status": "unavailable"},
                    {"days": ["Friday"], "slots": AFTER_DHUHR_FRIDAY, "status": "unavailable"},
                    # Before 08:30 (JP 1-2) also unavailable — only JP 3-4 (08:30-10:30)
                    {"days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "slots": [1, 2], "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "nomor": 2,
                "name": "Zaenal Mutaqin, S.Ag",
                "email": "", "whatsapp": "",
                "notes": "Sabtu full day; hari lain hanya setelah Dhuhr (JP 5+).",
                "availability": build_availability([
                    # Other days: before Dhuhr unavailable
                    {"days": ["Monday", "Tuesday", "Wednesday", "Thursday"], "slots": BEFORE_DHUHR, "status": "unavailable"},
                    {"days": ["Friday"], "slots": BEFORE_DHUHR, "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "nomor": 3,
                "name": "Hasan Nasrulloh, S.Pd",
                "email": "", "whatsapp": "",
                "notes": "Tidak tersedia Rabu-Kamis, dan JP 1-2 pada hari lain.",
                "availability": build_availability([
                    {"days": ["Wednesday", "Thursday"], "status": "unavailable"},
                    {"days": ["Monday", "Tuesday", "Friday", "Saturday"], "slots": [1, 2], "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "nomor": 4,
                "name": "Dinan Afifah Firdaus, S.Pd",
                "email": "", "whatsapp": "",
                "notes": "Selasa & Rabu dari 10:00 (JP 5+); Jumat setelah Sholat (JP 7+). Preferensi kelas XII.",
                "availability": build_availability([
                    {"days": ["Tuesday", "Wednesday"], "slots": [1, 2, 3, 4], "status": "unavailable"},
                    {"days": ["Friday"], "slots": [1, 2, 3, 4, 5, 6], "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "nomor": 5,
                "name": "Nuzlia Fitriani Hapsari, S.Akun",
                "email": "", "whatsapp": "",
                "notes": "Senin & Kamis available; Jumat & Sabtu full; Selasa-Rabu unavailable setelah Dhuhr.",
                "availability": build_availability([
                    {"days": ["Tuesday", "Wednesday"], "slots": AFTER_DHUHR, "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "nomor": 6,
                "name": "Fahmi Kurnia Hidayatulloh, S.Pd",
                "email": "", "whatsapp": "",
                "notes": "Senin JP 3+, Selasa JP 1, Rabu JP 1-2, Kamis JP 5+; Sabtu unavailable.",
                "availability": build_availability([
                    {"days": ["Monday"], "slots": [1, 2], "status": "unavailable"},
                    {"days": ["Tuesday"], "slots": [2, 3, 4, 5, 6, 7, 8, 9, 10], "status": "unavailable"},
                    {"days": ["Wednesday"], "slots": [3, 4, 5, 6, 7, 8, 9, 10], "status": "unavailable"},
                    {"days": ["Thursday"], "slots": [1, 2, 3, 4], "status": "unavailable"},
                    {"days": ["Saturday"], "status": "unavailable"},
                ]),
            },
        ]
        await db.teachers.insert_many(teachers)

    return {"ok": True, "message": "Seed complete"}


# ---------------- Day Configs ----------------
@api_router.get("/day-configs")
async def list_day_configs(request: Request):
    await require_user(request)
    await ensure_day_configs()
    docs = await db.day_configs.find({}, {"_id": 0}).to_list(20)
    order = {d: i for i, d in enumerate(DAYS)}
    docs.sort(key=lambda x: order.get(x["day"], 99))
    return docs


@api_router.put("/day-configs/{day}")
async def update_day_config(day: str, payload: dict, request: Request):
    await require_user(request)
    if day not in DAYS:
        raise HTTPException(status_code=400, detail="Invalid day")
    existing = await db.day_configs.find_one({"day": day}, {"_id": 0})
    limits = payload.get("class_limits", (existing or {}).get("class_limits", {})) or {}
    # sanitasi: hanya class_id dikenal, 1..jumlah periode hari itu
    period_n = sum(1 for i in payload.get("items", []) if isinstance(i, dict) and i.get("type") == "period")
    clean_limits = {}
    if isinstance(limits, dict):
        for cid, v in limits.items():
            try:
                iv = int(v)
            except (ValueError, TypeError):
                continue
            if 1 <= iv <= max(period_n, 1):
                clean_limits[str(cid)] = iv
    doc = {
        "id": existing["id"] if existing else new_id("dcfg"),
        "day": day,
        "start_time": payload.get("start_time", "07:00"),
        "items": payload.get("items", []),
        "class_limits": clean_limits,
    }
    await db.day_configs.update_one({"day": day}, {"$set": doc}, upsert=True)
    return doc


@api_router.post("/day-configs/{day}/reset")
async def reset_day_config(day: str, request: Request):
    await require_user(request)
    if day not in DAYS:
        raise HTTPException(status_code=400, detail="Invalid day")
    items = list(DEFAULT_ITEMS_FRIDAY) if day == "Friday" else list(DEFAULT_ITEMS_REGULAR)
    doc = {"id": new_id("dcfg"), "day": day, "start_time": "07:00", "items": items}
    await db.day_configs.update_one({"day": day}, {"$set": doc}, upsert=True)
    return doc


# ---------------- Subject/Class update ----------------
@api_router.put("/subjects/{subject_id}", response_model=Subject)
async def update_subject(subject_id: str, payload: Subject, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    doc["id"] = subject_id
    if not doc.get("color"):
        existing = await db.subjects.find_one({"id": subject_id}, {"_id": 0})
        doc["color"] = (existing or {}).get("color") or auto_subject_color(
            await db.subjects.count_documents({}))
    await db.subjects.update_one({"id": subject_id}, {"$set": doc}, upsert=True)
    return Subject(**doc)


@api_router.put("/classes/{class_id}", response_model=SchoolClass)
async def update_class(class_id: str, payload: SchoolClass, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    doc["id"] = class_id
    await db.classes.update_one({"id": class_id}, {"$set": doc}, upsert=True)
    return SchoolClass(**doc)


# ---------------- Health ----------------
@api_router.get("/")
async def root():
    return {"message": "EduSchedule AI API"}


app.include_router(api_router)

# CORS: dynamic origin echo to support credentials with '*'
origins_env = os.environ.get("CORS_ORIGINS", "*")
allow_origin_regex = ".*" if origins_env.strip() == "*" else None
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=allow_origin_regex,
    allow_origins=[] if allow_origin_regex else origins_env.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
