from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import models, database

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="QR Yoklama Sistemi")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── SYNC (PHP'nin yaptığı GET/POST'u karşılar) ──────────────────────────────

@app.get("/sync")
def sync_get(db: Session = Depends(get_db)):
    users = db.query(models.User).all()

    if not users:
        return {"first_run": True}

    courses = db.query(models.Course).all()

    active_session_db = (
        db.query(models.AttendanceSession)
        .filter(models.AttendanceSession.is_active == True)
        .order_by(models.AttendanceSession.date.desc())
        .first()
    )

    active_session = None
    records = []
    if active_session_db:
        active_session = {
            "course_id": active_session_db.course_id,
            "qr_data":   active_session_db.qr_data,
            "pin":       active_session_db.pin,
            "active":    True,
        }
        records = [
            r.student_id
            for r in db.query(models.AttendanceRecord)
            .filter(models.AttendanceRecord.session_id == active_session_db.id)
            .all()
        ]

    return {
        "users": [
            {
                "id":         u.id,
                "name":       u.name,
                "email":      u.email,
                "password":   u.password_hash,
                "role":       u.role,
                "student_no": u.student_no,
                "department": u.department,
            }
            for u in users
        ],
        "courses": [
            {
                "id":         c.id,
                "code":       c.course_code,
                "name":       c.course_name,
                "teacher_id": c.teacher_id,
            }
            for c in courses
        ],
        "active_session": active_session,
        "records": records,
    }


@app.post("/sync")
def sync_post(data: dict, db: Session = Depends(get_db)):
    # İlk çalıştırmada kullanıcı/ders yükle
    if "users" in data and data["users"]:
        for u in data["users"]:
            if not db.query(models.User).filter(models.User.id == int(u["id"])).first():
                db.add(models.User(
                    id=int(u["id"]),
                    name=u["name"],
                    email=u["email"],
                    password_hash=u.get("password", ""),
                    role=u["role"],
                    student_no=u.get("student_no"),
                    department=u.get("department"),
                ))
        db.commit()

    if "courses" in data and data["courses"]:
        for c in data["courses"]:
            if not db.query(models.Course).filter(models.Course.id == int(c["id"])).first():
                db.add(models.Course(
                    id=int(c["id"]),
                    course_code=c.get("code", c.get("course_code", "")),
                    course_name=c.get("name", c.get("course_name", "")),
                    teacher_id=int(c["teacher_id"]),
                ))
        db.commit()

    active_session = data.get("active_session")
    records = data.get("records", [])

    if active_session is None:
        db.query(models.AttendanceSession).filter(
            models.AttendanceSession.is_active == True
        ).update({"is_active": False})
        db.commit()
        return {"status": "success", "message": "Oturum kapatıldı"}

    qr_data = active_session["qr_data"]
    existing = (
        db.query(models.AttendanceSession)
        .filter(models.AttendanceSession.qr_data == qr_data)
        .first()
    )

    if not existing:
        db.query(models.AttendanceSession).filter(
            models.AttendanceSession.is_active == True
        ).update({"is_active": False})
        db.commit()

        session_obj = models.AttendanceSession(
            course_id=int(active_session["course_id"]),
            qr_data=qr_data,
            pin=active_session.get("pin"),
            is_active=True,
        )
        db.add(session_obj)
        db.commit()
        db.refresh(session_obj)
        session_id = session_obj.id
    else:
        session_id = existing.id

    for student_id in records:
        sid = int(student_id)
        if not db.query(models.AttendanceRecord).filter(
            models.AttendanceRecord.session_id == session_id,
            models.AttendanceRecord.student_id == sid,
        ).first():
            db.add(models.AttendanceRecord(session_id=session_id, student_id=sid))

    db.commit()
    return {"status": "success", "message": "Senkronize edildi"}


# ── ÖĞRETMEN GEÇMİŞ ─────────────────────────────────────────────────────────

@app.get("/teacher/{teacher_id}/history")
def teacher_history(teacher_id: int, db: Session = Depends(get_db)):
    courses = db.query(models.Course).filter(models.Course.teacher_id == teacher_id).all()
    course_map = {c.id: c for c in courses}

    sessions = (
        db.query(models.AttendanceSession)
        .filter(models.AttendanceSession.course_id.in_(list(course_map.keys())))
        .order_by(models.AttendanceSession.date.desc())
        .all()
    )

    result = []
    for s in sessions:
        course = course_map.get(s.course_id)
        attendance_records = (
            db.query(models.AttendanceRecord)
            .filter(models.AttendanceRecord.session_id == s.id)
            .all()
        )

        attendees = []
        for r in attendance_records:
            student = db.query(models.User).filter(models.User.id == r.student_id).first()
            if student:
                attendees.append({
                    "id":         student.id,
                    "name":       student.name,
                    "student_no": student.student_no or "",
                })

        result.append({
            "session_id":    s.id,
            "course_code":   course.course_code if course else "",
            "course_name":   course.course_name if course else "",
            "date":          s.date.strftime("%d.%m.%Y %H:%M") if s.date else "",
            "is_active":     s.is_active,
            "attendee_count": len(attendees),
            "attendees":     attendees,
        })

    return result


