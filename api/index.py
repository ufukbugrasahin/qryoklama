import os
import bcrypt
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, DateTime, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, Session

# ── VERİTABANI ───────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./attendance.db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

TRT = timezone(timedelta(hours=3))
def get_now():
    return datetime.now(TRT)

def hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def verify_pw(plain: str, stored: str) -> bool:
    try:
        if stored.startswith("$2"):
            return bcrypt.checkpw(plain.encode(), stored.encode())
        return plain == stored  # plain-text fallback (migration)
    except Exception:
        return False

# ── MODELLER ─────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String)
    email       = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role        = Column(String)
    student_no  = Column(String, nullable=True)
    department  = Column(String, nullable=True)

class Course(Base):
    __tablename__ = "courses"
    id          = Column(Integer, primary_key=True, index=True)
    course_code = Column(String, unique=True, index=True)
    course_name = Column(String)
    teacher_id  = Column(Integer, ForeignKey("users.id"))
    sessions    = relationship("AttendanceSession", back_populates="course")

class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    id        = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"))
    date      = Column(DateTime, default=get_now)
    qr_data   = Column(String, unique=True, index=True)
    pin       = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    course    = relationship("Course", back_populates="sessions")
    records   = relationship("AttendanceRecord", back_populates="session")

class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("attendance_sessions.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    timestamp  = Column(DateTime, default=get_now)
    status     = Column(String, default="Present")
    session    = relationship("AttendanceSession", back_populates="records")
    student    = relationship("User")

class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"
    id          = Column(Integer, primary_key=True, index=True)
    course_id   = Column(Integer, ForeignKey("courses.id"))
    student_id  = Column(Integer, ForeignKey("users.id"))
    enrolled_at = Column(DateTime, default=get_now)

Base.metadata.create_all(bind=engine)

# ── UYGULAMA ─────────────────────────────────────────────────────────────────

app = FastAPI(title="QR Yoklama Sistemi")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── GİRİŞ & KAYIT ────────────────────────────────────────────────────────────

@app.post("/register")
def register(data: dict, db: Session = Depends(get_db)):
    email    = data.get("email", "").strip()
    name     = data.get("name", "").strip()
    stud_no  = data.get("student_no", "").strip()
    password = data.get("password", "")
    if not email or not name or not stud_no or not password:
        return {"error": "Tüm alanlar zorunlu"}
    if len(password) < 6:
        return {"error": "Şifre en az 6 karakter olmalı"}
    if db.query(User).filter(User.email == email).first():
        return {"error": "Bu e-posta zaten kayıtlı"}
    max_id = db.query(func.max(User.id)).scalar() or 0
    db.add(User(
        id=max_id + 1, name=name, email=email,
        password_hash=hash_pw(password),
        role="student", student_no=stud_no,
    ))
    db.commit()
    return {"status": "success"}

@app.post("/login")
def login(data: dict, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.get("email", "")).first()
    if not user or not verify_pw(data.get("password", ""), user.password_hash):
        return {"error": "Hatalı e-posta veya şifre"}
    return {
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role,
        "student_no": user.student_no or "",
        "department": user.department or "",
    }

# ── SYNC GET ─────────────────────────────────────────────────────────────────

@app.get("/sync")
def sync_get(db: Session = Depends(get_db)):
    users = db.query(User).all()
    if not users:
        return {"first_run": True}

    courses = db.query(Course).all()
    active_s = (
        db.query(AttendanceSession)
        .filter(AttendanceSession.is_active == True)
        .order_by(AttendanceSession.date.desc())
        .first()
    )

    active_session = None
    records = []
    if active_s:
        active_session = {
            "course_id": active_s.course_id,
            "qr_data":   active_s.qr_data,
            "pin":       active_s.pin,
            "active":    True,
        }
        records = [
            r.student_id
            for r in db.query(AttendanceRecord)
            .filter(AttendanceRecord.session_id == active_s.id)
            .all()
        ]

    return {
        "users": [
            {"id": u.id, "name": u.name, "email": u.email,
             "role": u.role,
             "student_no": u.student_no, "department": u.department}
            for u in users
        ],
        "courses": [
            {"id": c.id, "code": c.course_code,
             "name": c.course_name, "teacher_id": c.teacher_id}
            for c in courses
        ],
        "active_session": active_session,
        "records": records,
    }

# ── SYNC POST ────────────────────────────────────────────────────────────────

@app.post("/sync")
def sync_post(data: dict, db: Session = Depends(get_db)):
    if data.get("users"):
        for u in data["users"]:
            if not db.query(User).filter(User.id == int(u["id"])).first():
                plain = u.get("password", "123")
                db.add(User(
                    id=int(u["id"]),
                    name=u["name"],
                    email=u["email"],
                    password_hash=hash_pw(plain),
                    role=u["role"],
                    student_no=u.get("student_no"),
                    department=u.get("department"),
                ))
        db.commit()

    if data.get("courses"):
        for c in data["courses"]:
            if not db.query(Course).filter(Course.id == int(c["id"])).first():
                db.add(Course(
                    id=int(c["id"]),
                    course_code=c.get("code", c.get("course_code", "")),
                    course_name=c.get("name", c.get("course_name", "")),
                    teacher_id=int(c["teacher_id"]),
                ))
        db.commit()

    active_session = data.get("active_session")
    records        = data.get("records", [])

    if active_session is None:
        db.query(AttendanceSession).filter(
            AttendanceSession.is_active == True
        ).update({"is_active": False})
        db.commit()
        return {"status": "success"}

    qr_data  = active_session["qr_data"]
    existing = db.query(AttendanceSession).filter(
        AttendanceSession.qr_data == qr_data
    ).first()

    if not existing:
        db.query(AttendanceSession).filter(
            AttendanceSession.is_active == True
        ).update({"is_active": False})
        db.commit()
        s = AttendanceSession(
            course_id=int(active_session["course_id"]),
            qr_data=qr_data,
            pin=active_session.get("pin"),
            is_active=True,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        session_id = s.id
    else:
        session_id = existing.id

    for student_id in records:
        sid = int(student_id)
        if not db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == sid,
        ).first():
            db.add(AttendanceRecord(session_id=session_id, student_id=sid))
    db.commit()

    return {"status": "success"}

# ── ÖĞRETMEN GEÇMİŞ ─────────────────────────────────────────────────────────

@app.get("/teacher/{teacher_id}/history")
def teacher_history(teacher_id: int, db: Session = Depends(get_db)):
    courses   = db.query(Course).filter(Course.teacher_id == teacher_id).all()
    course_map = {c.id: c for c in courses}

    sessions = (
        db.query(AttendanceSession)
        .filter(AttendanceSession.course_id.in_(list(course_map.keys())))
        .order_by(AttendanceSession.date.desc())
        .all()
    )

    result = []
    for s in sessions:
        course  = course_map.get(s.course_id)
        att_recs = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == s.id
        ).all()

        attended_ids = {r.student_id for r in att_recs}

        # Kayıtlı öğrenciler
        enrolled_ids = {
            e.student_id for e in db.query(CourseEnrollment)
            .filter(CourseEnrollment.course_id == s.course_id).all()
        }
        absent_ids = enrolled_ids - attended_ids

        attendees, absent = [], []
        for r in att_recs:
            student = db.query(User).filter(User.id == r.student_id).first()
            if student:
                attendees.append({"id": student.id, "name": student.name, "student_no": student.student_no or ""})
        for sid in absent_ids:
            student = db.query(User).filter(User.id == sid).first()
            if student:
                absent.append({"id": student.id, "name": student.name, "student_no": student.student_no or ""})

        result.append({
            "session_id":     s.id,
            "course_code":    course.course_code if course else "",
            "course_name":    course.course_name if course else "",
            "date":           s.date.strftime("%d.%m.%Y %H:%M") if s.date else "",
            "is_active":      s.is_active,
            "attendee_count": len(attendees),
            "enrolled_count": len(enrolled_ids),
            "attendees":      attendees,
            "absent":         absent,
        })

    return result


# ── ÖĞRETMEN GEÇMİŞ ─────────────────────────────────────────────────────────

@app.get("/student/{student_id}/history")
def student_history(student_id: int, db: Session = Depends(get_db)):
    records = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.student_id == student_id)
        .all()
    )

    result = []
    for r in records:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == r.session_id).first()
        if not session:
            continue
        course = db.query(Course).filter(Course.id == session.course_id).first()
        result.append({
            "session_id":  session.id,
            "course_code": course.course_code if course else "",
            "course_name": course.course_name if course else "",
            "date":        session.date.strftime("%d.%m.%Y %H:%M") if session.date else "",
            "status":      r.status,
        })

    result.sort(key=lambda x: x["date"], reverse=True)
    return result


# ── DERS KAYIT (ENROLLMENT) ──────────────────────────────────────────────────

@app.get("/student/{student_id}/courses")
def student_courses(student_id: int, db: Session = Depends(get_db)):
    enrollments = db.query(CourseEnrollment).filter(
        CourseEnrollment.student_id == student_id
    ).all()
    result = []
    for e in enrollments:
        course = db.query(Course).filter(Course.id == e.course_id).first()
        if not course:
            continue
        total = db.query(AttendanceSession).filter(
            AttendanceSession.course_id == course.id,
            AttendanceSession.is_active == False
        ).count()
        attended = (
            db.query(AttendanceRecord)
            .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
            .filter(AttendanceSession.course_id == course.id,
                    AttendanceRecord.student_id == student_id)
            .count()
        )
        rate = round(attended / total * 100) if total > 0 else None
        result.append({
            "course_id":       course.id,
            "course_code":     course.course_code,
            "course_name":     course.course_name,
            "total_sessions":  total,
            "attended":        attended,
            "attendance_rate": rate,
        })
    return result

@app.post("/student/{student_id}/enroll")
def enroll_course(student_id: int, data: dict, db: Session = Depends(get_db)):
    code   = data.get("course_code", "").strip().upper()
    course = db.query(Course).filter(Course.course_code == code).first()
    if not course:
        return {"error": f"'{code}' kodlu ders bulunamadı"}
    exists = db.query(CourseEnrollment).filter(
        CourseEnrollment.student_id == student_id,
        CourseEnrollment.course_id  == course.id,
    ).first()
    if exists:
        return {"error": "Bu derse zaten kayıtlısınız"}
    db.add(CourseEnrollment(student_id=student_id, course_id=course.id))
    db.commit()
    return {"status": "success", "course_name": course.course_name}

@app.delete("/student/{student_id}/enroll/{course_id}")
def unenroll_course(student_id: int, course_id: int, db: Session = Depends(get_db)):
    e = db.query(CourseEnrollment).filter(
        CourseEnrollment.student_id == student_id,
        CourseEnrollment.course_id  == course_id,
    ).first()
    if e:
        db.delete(e)
        db.commit()
    return {"status": "success"}

# ── ADMİN ────────────────────────────────────────────────────────────────────

@app.get("/admin/users")
def admin_get_users(db: Session = Depends(get_db)):
    return [
        {"id": u.id, "name": u.name, "email": u.email,
         "role": u.role, "student_no": u.student_no or "", "department": u.department or ""}
        for u in db.query(User).order_by(User.role, User.name).all()
    ]

@app.post("/admin/users")
def admin_create_user(data: dict, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data["email"]).first():
        return {"error": "Bu e-posta zaten kayıtlı"}
    max_id = db.query(func.max(User.id)).scalar() or 0
    db.add(User(
        id=max_id + 1,
        name=data["name"],
        email=data["email"],
        password_hash=hash_pw(data.get("password", "123")),
        role=data["role"],
        student_no=data.get("student_no") or None,
        department=data.get("department") or None,
    ))
    db.commit()
    return {"status": "success"}

@app.put("/admin/users/{user_id}")
def admin_update_user(user_id: int, data: dict, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        return {"error": "Kullanıcı bulunamadı"}
    u.name       = data.get("name", u.name)
    u.email      = data.get("email", u.email)
    u.role       = data.get("role", u.role)
    u.student_no = data.get("student_no") or None
    u.department = data.get("department") or None
    if data.get("password"):
        u.password_hash = hash_pw(data["password"])
    db.commit()
    return {"status": "success"}

@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        return {"error": "Kullanıcı bulunamadı"}
    db.delete(u)
    db.commit()
    return {"status": "success"}

@app.get("/admin/courses")
def admin_get_courses(db: Session = Depends(get_db)):
    teachers = {u.id: u.name for u in db.query(User).filter(User.role == "teacher").all()}
    courses  = db.query(Course).order_by(Course.course_code).all()
    result = []
    for c in courses:
        enrolled = db.query(CourseEnrollment).filter(CourseEnrollment.course_id == c.id).count()
        result.append({
            "id": c.id, "code": c.course_code, "name": c.course_name,
            "teacher_id": c.teacher_id, "teacher_name": teachers.get(c.teacher_id, ""),
            "enrollment_count": enrolled,
        })
    return result

@app.post("/admin/courses")
def admin_create_course(data: dict, db: Session = Depends(get_db)):
    if db.query(Course).filter(Course.course_code == data["code"]).first():
        return {"error": "Bu ders kodu zaten mevcut"}
    max_id = db.query(func.max(Course.id)).scalar() or 0
    db.add(Course(
        id=max_id + 1,
        course_code=data["code"],
        course_name=data["name"],
        teacher_id=int(data["teacher_id"]),
    ))
    db.commit()
    return {"status": "success"}

@app.put("/admin/courses/{course_id}")
def admin_update_course(course_id: int, data: dict, db: Session = Depends(get_db)):
    c = db.query(Course).filter(Course.id == course_id).first()
    if not c:
        return {"error": "Ders bulunamadı"}
    c.course_code = data.get("code", c.course_code)
    c.course_name = data.get("name", c.course_name)
    c.teacher_id  = int(data.get("teacher_id", c.teacher_id))
    db.commit()
    return {"status": "success"}

@app.delete("/admin/courses/{course_id}")
def admin_delete_course(course_id: int, db: Session = Depends(get_db)):
    c = db.query(Course).filter(Course.id == course_id).first()
    if not c:
        return {"error": "Ders bulunamadı"}
    db.delete(c)
    db.commit()
    return {"status": "success"}

@app.get("/admin/teachers")
def admin_get_teachers(db: Session = Depends(get_db)):
    return [
        {"id": u.id, "name": u.name}
        for u in db.query(User).filter(User.role == "teacher").all()
    ]


# ── İSTATİSTİK ───────────────────────────────────────────────────────────────

@app.get("/teacher/{teacher_id}/stats")
def teacher_stats(teacher_id: int, db: Session = Depends(get_db)):
    courses    = db.query(Course).filter(Course.teacher_id == teacher_id).all()
    course_map = {c.id: c for c in courses}
    students   = db.query(User).filter(User.role == "student").count()

    stats = []
    for c in courses:
        sessions = db.query(AttendanceSession).filter(
            AttendanceSession.course_id == c.id,
            AttendanceSession.is_active == False
        ).all()
        total_sessions = len(sessions)
        attendance_counts = []
        for s in sessions:
            cnt = db.query(AttendanceRecord).filter(AttendanceRecord.session_id == s.id).count()
            attendance_counts.append(cnt)
        avg = round(sum(attendance_counts) / len(attendance_counts), 1) if attendance_counts else 0
        stats.append({
            "course_code":    c.course_code,
            "course_name":    c.course_name,
            "total_sessions": total_sessions,
            "avg_attendance": avg,
            "counts":         attendance_counts[-10:],  # son 10 oturum
        })

    return {"courses": stats, "total_students": students}


@app.get("/student/{student_id}/stats")
def student_stats(student_id: int, db: Session = Depends(get_db)):
    records = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == student_id).all()
    session_ids = [r.session_id for r in records]

    courses    = db.query(Course).all()
    course_map = {c.id: c for c in courses}

    result = {}
    for r in records:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == r.session_id).first()
        if not session:
            continue
        course = course_map.get(session.course_id)
        if not course:
            continue
        cid = course.id
        if cid not in result:
            total = db.query(AttendanceSession).filter(
                AttendanceSession.course_id == cid,
                AttendanceSession.is_active == False
            ).count()
            result[cid] = {"code": course.course_code, "name": course.course_name,
                           "attended": 0, "total": total}
        result[cid]["attended"] += 1

    return list(result.values())
