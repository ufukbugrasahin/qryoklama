from pydantic import BaseModel
from typing import Optional, List
import datetime

class UserBase(BaseModel):
    name: str
    email: str
    role: str
    student_no: Optional[str] = None
    department: Optional[str] = None

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int

    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    email: str
    password: str

class CourseBase(BaseModel):
    course_code: str
    course_name: str
    teacher_id: int

class CourseCreate(CourseBase):
    pass

class Course(CourseBase):
    id: int

    class Config:
        from_attributes = True

class AttendanceSessionBase(BaseModel):
    course_id: int

class AttendanceSessionCreate(AttendanceSessionBase):
    qr_data: str

class AttendanceSession(AttendanceSessionBase):
    id: int
    date: datetime.datetime
    qr_data: str
    is_active: bool

    class Config:
        from_attributes = True

class AttendanceRecordBase(BaseModel):
    qr_data: str
    student_id: int

class AttendanceRecordCreate(AttendanceRecordBase):
    pass

class AttendanceRecord(BaseModel):
    id: int
    session_id: int
    student_id: int
    timestamp: datetime.datetime
    status: str

    class Config:
        from_attributes = True
