import uuid
import asyncio
import json
import time
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from database import get_db, init_db, SessionLocal
from models import Hazard, Job
from schemas import HazardOut, JobOut, StatsOut, StatusUpdate

UPLOAD_DIR = Path("uploads")
DETECTED_DIR = Path("detected")
UPLOAD_DIR.mkdir(exist_ok=True)
DETECTED_DIR.mkdir(exist_ok=True)

# SSE event subscribers per job_id
_sse_subscribers: dict[str, list[asyncio.Queue]] = {}
# MJPEG frame queues per job_id (frames are raw JPEG bytes)
_mjpeg_queues: dict[str, asyncio.Queue] = {}
# Main event loop — set at startup, used by background threads
_main_loop: Optional[asyncio.AbstractEventLoop] = None

MJPEG_BOUNDARY = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    init_db()
    yield


app = FastAPI(title="NorthRoad AI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Thread-safe helpers (called from background threads) ─────────────────────

def _ts(job_id: str, event: dict):
    """Thread-safe: push SSE event to all subscribers."""
    if _main_loop is None:
        return
    for q in _sse_subscribers.get(job_id, []):
        _main_loop.call_soon_threadsafe(q.put_nowait, event)


def _push_frame(job_id: str, jpeg_bytes: bytes):
    """Thread-safe: push an annotated JPEG frame to the MJPEG stream."""
    if _main_loop is None:
        return
    q = _mjpeg_queues.get(job_id)
    if q and not q.full():
        _main_loop.call_soon_threadsafe(q.put_nowait, jpeg_bytes)


def _save_hazard(db: Session, data: dict) -> Hazard:
    h = Hazard(**data)
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _update_progress(job_id: str, pct: int, db: Session):
    job = db.query(Job).filter(Job.id == job_id).first()
    if job:
        job.progress = pct
        db.commit()


# ── Background processing task ────────────────────────────────────────────────

def run_detection(video_path: str, job_id: str):
    from detection import process_video_streaming
    db = SessionLocal()
    try:
        # Small delay so the browser MJPEG <img> has time to connect first
        time.sleep(0.8)

        def on_frame(jpeg_bytes: bytes):
            _push_frame(job_id, jpeg_bytes)

        def on_progress(pct: int):
            _update_progress(job_id, pct, db)

        def on_detection(det: dict):
            # Save to DB and push SSE event the instant a pothole is found
            h = _save_hazard(db, det)
            _ts(job_id, {
                "type": "detection",
                "id": h.id,
                "lat": h.lat,
                "lng": h.lng,
                "severity": h.severity,
                "confidence": h.confidence,
                "frame_file": h.frame_file,
                "video_timestamp": h.video_timestamp,
            })

        process_video_streaming(
            video_path, job_id, on_frame, on_progress, on_detection
        )

        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "done"
            job.progress = 100
            db.commit()

        _push_frame(job_id, b"")      # sentinel closes MJPEG stream
        _ts(job_id, {"type": "done"})

    except Exception as e:
        print(f"Detection error: {e}")
        import traceback; traceback.print_exc()
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "error"
            db.commit()
        _push_frame(job_id, b"")
        _ts(job_id, {"type": "error", "message": str(e)})
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    job_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix or ".mp4"
    video_path = str(UPLOAD_DIR / f"{job_id}{ext}")

    content = await file.read()
    with open(video_path, "wb") as f:
        f.write(content)

    db = SessionLocal()
    job = Job(id=job_id, status="processing", progress=0, video_path=video_path)
    db.add(job)
    db.commit()
    db.close()

    # Pre-create the MJPEG queue so frames aren't lost before stream connects
    _mjpeg_queues[job_id] = asyncio.Queue(maxsize=120)
    background_tasks.add_task(run_detection, video_path, job_id)
    return {"job_id": job_id}


@app.get("/api/live/{job_id}")
async def live_stream(job_id: str):
    """MJPEG stream — plug directly into <img src=...> on the frontend."""
    # Reuse existing queue (created at upload time) or create one
    if job_id not in _mjpeg_queues:
        _mjpeg_queues[job_id] = asyncio.Queue(maxsize=120)

    queue = _mjpeg_queues[job_id]

    async def generate():
        try:
            while True:
                try:
                    jpeg = await asyncio.wait_for(queue.get(), timeout=60)
                except asyncio.TimeoutError:
                    break
                if not jpeg:   # sentinel = stream ended
                    break
                yield MJPEG_BOUNDARY + jpeg + b"\r\n"
        finally:
            _mjpeg_queues.pop(job_id, None)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/api/events/{job_id}")
async def event_stream(job_id: str):
    """SSE stream — detection events + done signal for the map/alerts."""
    queue: asyncio.Queue = asyncio.Queue()
    _sse_subscribers.setdefault(job_id, []).append(queue)

    async def generate():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=60)
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
        except asyncio.TimeoutError:
            yield 'data: {"type":"ping"}\n\n'
        finally:
            subs = _sse_subscribers.get(job_id, [])
            if queue in subs:
                subs.remove(queue)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/api/hazards", response_model=list[HazardOut])
def get_hazards(db: Session = Depends(get_db)):
    return db.query(Hazard).order_by(Hazard.created_at.desc()).all()


@app.get("/api/hazards/{hazard_id}", response_model=HazardOut)
def get_hazard(hazard_id: str, db: Session = Depends(get_db)):
    h = db.query(Hazard).filter(Hazard.id == hazard_id).first()
    if not h:
        raise HTTPException(404, "Hazard not found")
    return h


@app.patch("/api/hazards/{hazard_id}")
def update_hazard(hazard_id: str, body: StatusUpdate, db: Session = Depends(get_db)):
    h = db.query(Hazard).filter(Hazard.id == hazard_id).first()
    if not h:
        raise HTTPException(404, "Hazard not found")
    h.status = body.status
    db.commit()
    return {"ok": True}


@app.get("/api/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    hazards = db.query(Hazard).all()
    return StatsOut(
        total=len(hazards),
        high=sum(1 for h in hazards if h.severity == "HIGH"),
        medium=sum(1 for h in hazards if h.severity == "MEDIUM"),
        low=sum(1 for h in hazards if h.severity == "LOW"),
        open=sum(1 for h in hazards if h.status == "open"),
        resolved=sum(1 for h in hazards if h.status == "resolved"),
    )


@app.get("/api/frames/{filename}")
def get_frame(filename: str):
    path = DETECTED_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Frame not found")
    return FileResponse(str(path), media_type="image/jpeg")
