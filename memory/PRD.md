# EduSchedule AI — Madrasah Aliyah Persis Katapang

## Original Problem Statement
Web-based School Timetable Generator and Conflict Management System named "EduSchedule AI".
Solves complex school scheduling with heavy teacher availability constraints (external schools, post-Dhuhr restrictions, day/slot locks).

## User Choices
- Auth: **Emergent-managed Google Auth**
- Auto-scheduler: **Greedy constraint-solver (local, deterministic)**
- PDF export: **Client-side (jspdf + autotable)**
- Notifications: **Not required now** (contact fields kept for future)
- Seed: **6 sample teachers + base subjects/classes** — CRUD to add more manually

## Architecture
- React 19 + FastAPI + MongoDB
- Emerald Green / Dark Slate Gray design system
- Days: Monday–Saturday; Slots 1–10 (Friday: 1–8 usable, 9–10 prayer/N/A)
- Availability stored per teacher as `{day-slot: "available"|"unavailable"}`

## Core Modules Implemented (Feb 2026)
- Google OAuth login (Emergent) + owner allowlist (jauhar.jundi@gmail.com)
- Dashboard with 4 summary cards
- Teachers CRUD + Availability Matrix editor
- Subjects & Classes CRUD
- Teaching Assignment Manager (Teacher × Subject × Class × Hours/week)
- Schedule Builder w/ real-time conflict engine (3 alert types)
- Smart Auto-Scheduler (greedy)
- Master / Class / Teacher schedule views with PDF export
- Seed endpoint pre-loads 6 real teachers with exact constraints

## Backlog (P1/P2)
- Drag-and-drop schedule reordering (currently click-to-assign)
- Email/WhatsApp notifications (Resend/Twilio)
- Multi-semester / academic year support
- Import/Export CSV
