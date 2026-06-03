from sqlalchemy import Column, String, Float, Integer, DateTime
from sqlalchemy.sql import func
from database import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True)
    status = Column(String, default="processing")  # processing | done | error
    progress = Column(Integer, default=0)
    video_path = Column(String)
    created_at = Column(DateTime, server_default=func.now())


class Hazard(Base):
    __tablename__ = "hazards"

    id = Column(String, primary_key=True)
    job_id = Column(String)
    lat = Column(Float)
    lng = Column(Float)
    severity = Column(String)       # LOW | MEDIUM | HIGH
    confidence = Column(Float)
    frame_file = Column(String)     # filename in /detected/
    video_timestamp = Column(Float) # seconds into the video
    status = Column(String, default="open")  # open | assigned | resolved
    created_at = Column(DateTime, server_default=func.now())
