from pydantic import BaseModel
from typing import Optional


class HazardOut(BaseModel):
    id: str
    job_id: str
    lat: float
    lng: float
    severity: str
    confidence: float
    frame_file: str
    video_timestamp: float
    status: str

    class Config:
        from_attributes = True


class JobOut(BaseModel):
    id: str
    status: str
    progress: int

    class Config:
        from_attributes = True


class StatsOut(BaseModel):
    total: int
    high: int
    medium: int
    low: int
    open: int
    resolved: int


class StatusUpdate(BaseModel):
    status: str
