from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Cookie
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
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
    name: str
    email: Optional[str] = ""
    whatsapp: Optional[str] = ""
    max_hours_per_week: int = 24
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


class Assignment(BaseModel):
    id: str = Field(default_factory=lambda: new_id("a"))
    teacher_id: str
    subject_id: str
    class_id: str
    hours_per_week: int


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
@api_router.get("/teachers", response_model=List[Teacher])
async def list_teachers(request: Request):
    await require_user(request)
    docs = await db.teachers.find({}, {"_id": 0}).to_list(500)
    return [Teacher(**d) for d in docs]


@api_router.post("/teachers", response_model=Teacher)
async def create_teacher(payload: Teacher, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    await db.teachers.insert_one(doc)
    return payload


@api_router.put("/teachers/{teacher_id}", response_model=Teacher)
async def update_teacher(teacher_id: str, payload: Teacher, request: Request):
    await require_user(request)
    doc = payload.model_dump()
    doc["id"] = teacher_id
    await db.teachers.update_one({"id": teacher_id}, {"$set": doc}, upsert=True)
    return Teacher(**doc)


@api_router.delete("/teachers/{teacher_id}")
async def delete_teacher(teacher_id: str, request: Request):
    await require_user(request)
    await db.teachers.delete_one({"id": teacher_id})
    await db.assignments.delete_many({"teacher_id": teacher_id})
    await db.schedule.delete_many({"teacher_id": teacher_id})
    return {"ok": True}


# ---------------- Subjects ----------------
@api_router.get("/subjects", response_model=List[Subject])
async def list_subjects(request: Request):
    await require_user(request)
    docs = await db.subjects.find({}, {"_id": 0}).to_list(500)
    return [Subject(**d) for d in docs]


@api_router.post("/subjects", response_model=Subject)
async def create_subject(payload: Subject, request: Request):
    await require_user(request)
    await db.subjects.insert_one(payload.model_dump())
    return payload


@api_router.delete("/subjects/{subject_id}")
async def delete_subject(subject_id: str, request: Request):
    await require_user(request)
    await db.subjects.delete_one({"id": subject_id})
    await db.assignments.delete_many({"subject_id": subject_id})
    await db.schedule.delete_many({"subject_id": subject_id})
    return {"ok": True}


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


# ---------------- Schedule ----------------
async def load_all_schedule() -> List[dict]:
    return await db.schedule.find({}, {"_id": 0}).to_list(5000)


def get_valid_slots(day: str) -> List[int]:
    return FRIDAY_SLOTS if day == "Friday" else REGULAR_SLOTS


def detect_conflicts(schedule: List[dict], teachers: List[dict], valid_slots_by_day: Optional[Dict[str, set]] = None) -> List[dict]:
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
        if valid_slots_by_day is not None:
            valid = valid_slots_by_day.get(s["day"])
            if valid is not None and s["slot"] not in valid:
                conflicts.append({
                    "type": "invalid_slot",
                    "day": s["day"], "slot": s["slot"],
                    "class_id": s["class_id"],
                    "message": f"{s['day']} JP{s['slot']} tidak ada dalam konfigurasi hari ini"
                })
    return conflicts


@api_router.get("/schedule")
async def get_schedule(request: Request):
    await require_user(request)
    docs = await load_all_schedule()
    return docs


@api_router.post("/schedule")
async def upsert_slot(payload: ScheduleSlot, request: Request):
    await require_user(request)
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
    return detect_conflicts(schedule, teachers, valid)


@api_router.post("/schedule/auto")
async def auto_schedule(request: Request):
    """Greedy constraint-satisfaction scheduler."""
    await require_user(request)
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    assignments = await db.assignments.find({}, {"_id": 0}).to_list(1000)
    existing = await load_all_schedule()
    valid_slots_by_day = await get_valid_slots_by_day()

    teacher_map = {t["id"]: t for t in teachers}
    # occupancy trackers
    class_slots: Dict[tuple, bool] = {}  # (class_id, day, slot) -> occupied
    teacher_slots: Dict[tuple, bool] = {}  # (teacher_id, day, slot)
    for s in existing:
        class_slots[(s["class_id"], s["day"], s["slot"])] = True
        teacher_slots[(s["teacher_id"], s["day"], s["slot"])] = True

    # existing hours placed per assignment
    placed_per_assignment: Dict[tuple, int] = {}  # (teacher, subject, class) -> count
    for s in existing:
        k = (s["teacher_id"], s["subject_id"], s["class_id"])
        placed_per_assignment[k] = placed_per_assignment.get(k, 0) + 1

    # Sort assignments: those with more constrained teachers first
    def teacher_constraint_count(a):
        t = teacher_map.get(a["teacher_id"])
        if not t:
            return 0
        return sum(1 for v in t.get("availability", {}).values() if v == "unavailable")

    assignments_sorted = sorted(assignments, key=teacher_constraint_count, reverse=True)

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
        placed = 0
        # iterate day-slot in order
        for day in DAYS:
            valid = sorted(valid_slots_by_day.get(day, set()))
            for slot in valid:
                if placed >= needed:
                    break
                # constraint checks
                if class_slots.get((a["class_id"], day, slot)):
                    continue
                if teacher_slots.get((a["teacher_id"], day, slot)):
                    continue
                avail = teacher.get("availability", {}).get(f"{day}-{slot}", "available")
                if avail == "unavailable":
                    continue
                # OK, assign
                new_slot = {
                    "id": new_id("sch"),
                    "class_id": a["class_id"],
                    "day": day,
                    "slot": slot,
                    "subject_id": a["subject_id"],
                    "teacher_id": a["teacher_id"],
                }
                new_slots.append(new_slot)
                class_slots[(a["class_id"], day, slot)] = True
                teacher_slots[(a["teacher_id"], day, slot)] = True
                placed += 1
            if placed >= needed:
                break

    if new_slots:
        await db.schedule.insert_many(new_slots)
    total = len(await load_all_schedule())
    return {"ok": True, "added": len(new_slots), "total_slots": total}


# ---------------- Dashboard ----------------
@api_router.get("/dashboard/stats")
async def dashboard_stats(request: Request):
    await require_user(request)
    total_teachers = await db.teachers.count_documents({})
    total_classes = await db.classes.count_documents({})
    schedule = await load_all_schedule()
    teachers = await db.teachers.find({}, {"_id": 0}).to_list(500)
    valid = await get_valid_slots_by_day()
    conflicts = detect_conflicts(schedule, teachers, valid)

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
                "name": "Drs. Dadang Ahmad Tajudin",
                "email": "", "whatsapp": "",
                "max_hours_per_week": 24,
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
                "name": "Zaenal Mutaqin, S.Ag",
                "email": "", "whatsapp": "",
                "max_hours_per_week": 24,
                "notes": "Sabtu full day; hari lain hanya setelah Dhuhr (JP 5+).",
                "availability": build_availability([
                    # Other days: before Dhuhr unavailable
                    {"days": ["Monday", "Tuesday", "Wednesday", "Thursday"], "slots": BEFORE_DHUHR, "status": "unavailable"},
                    {"days": ["Friday"], "slots": BEFORE_DHUHR, "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "name": "Hasan Nasrulloh, S.Pd",
                "email": "", "whatsapp": "",
                "max_hours_per_week": 24,
                "notes": "Tidak tersedia Rabu-Kamis, dan JP 1-2 pada hari lain.",
                "availability": build_availability([
                    {"days": ["Wednesday", "Thursday"], "status": "unavailable"},
                    {"days": ["Monday", "Tuesday", "Friday", "Saturday"], "slots": [1, 2], "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "name": "Dinan Afifah Firdaus, S.Pd",
                "email": "", "whatsapp": "",
                "max_hours_per_week": 24,
                "notes": "Selasa & Rabu dari 10:00 (JP 5+); Jumat setelah Sholat (JP 7+). Preferensi kelas XII.",
                "availability": build_availability([
                    {"days": ["Tuesday", "Wednesday"], "slots": [1, 2, 3, 4], "status": "unavailable"},
                    {"days": ["Friday"], "slots": [1, 2, 3, 4, 5, 6], "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "name": "Nuzlia Fitriani Hapsari, S.Akun",
                "email": "", "whatsapp": "",
                "max_hours_per_week": 24,
                "notes": "Senin & Kamis available; Jumat & Sabtu full; Selasa-Rabu unavailable setelah Dhuhr.",
                "availability": build_availability([
                    {"days": ["Tuesday", "Wednesday"], "slots": AFTER_DHUHR, "status": "unavailable"},
                ]),
            },
            {
                "id": new_id("t"),
                "name": "Fahmi Kurnia Hidayatulloh, S.Pd",
                "email": "", "whatsapp": "",
                "max_hours_per_week": 24,
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
    doc = {
        "id": existing["id"] if existing else new_id("dcfg"),
        "day": day,
        "start_time": payload.get("start_time", "07:00"),
        "items": payload.get("items", []),
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
