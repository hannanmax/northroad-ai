# NorthRoad AI 🚗

> AI-powered road hazard detection and municipal intelligence platform — a personal project for the City of Sudbury, Ontario.

Dashcam video → YOLOv8 pothole detection → live streaming feed → municipal dashboard + real-time driver alerts.

---

## What It Does

**Driver View** — Upload a dashcam video and watch it process as if the car is driving live:
- MJPEG stream plays the video frame by frame with bounding boxes drawn over detected potholes
- `⚠️ HIGH POTHOLE — SLOW DOWN` alert fires instantly when a pothole is found
- `🏙️ Reported to City of Sudbury` toast appears bottom-right simultaneously
- Map pin drops on the Sudbury road route in real-time

**Municipal Dashboard** — City operations view:
- Leaflet map (OpenStreetMap, no API key) showing all detected hazards as colored pins
- Severity filter: HIGH / MEDIUM / LOW
- Click any pin → see the extracted frame, GPS coordinates, confidence score
- Mark hazards as repaired → pin turns grey
- Stats panel: total potholes, severity breakdown, open vs resolved

---

## Demo

| Driver View (live stream) | Municipal Dashboard |
|---|---|
| Upload dashcam video → streams like live dashcam | Map of all detected hazards across Sudbury roads |
| Bounding boxes appear over potholes in real-time | Click pin → see extracted frame + GPS coords |
| Alert banner + city notification fires instantly | Filter by severity, mark repairs as resolved |

---

## Tech Stack

### Backend
- **FastAPI** (Python 3.11+) — async REST API + SSE + MJPEG streaming
- **YOLOv8** (Ultralytics) — pothole segmentation model (`keremberke/yolov8m-pothole-segmentation`)
- **OpenCV** — frame extraction, annotation, JPEG encoding
- **SQLite** via SQLAlchemy — zero-setup local database
- **Server-Sent Events** — real-time detection push to frontend
- **MJPEG streaming** — live annotated video feed via `multipart/x-mixed-replace`

### Frontend
- **Next.js 14** (App Router)
- **Tailwind CSS** + **shadcn/ui** — dark UI components
- **Leaflet.js** + **OpenStreetMap** — free maps, no API key needed
- **react-leaflet** — live map with moving car marker

### AI Model
- `keremberke/yolov8m-pothole-segmentation` from HuggingFace
- Trained specifically on pothole datasets
- Classes: `{0: 'pothole'}`
- Runs on CPU — no GPU required

---

## Architecture

```
browser
  ├── /driver       → uploads video → shows <img src="/api/live/{job}"> MJPEG stream
  │                    + EventSource("/api/events/{job}") for detection events
  └── /dashboard    → polls /api/hazards, renders Leaflet map

FastAPI backend
  ├── POST /api/upload          → saves video, creates job, starts background task
  ├── GET  /api/live/{job_id}   → MJPEG stream (multipart/x-mixed-replace)
  ├── GET  /api/events/{job_id} → SSE stream (detection events in real-time)
  ├── GET  /api/hazards         → all hazards as JSON
  ├── GET  /api/jobs/{id}       → job progress (0–100%)
  ├── PATCH /api/hazards/{id}   → update status (open → resolved)
  ├── GET  /api/stats           → summary counts
  └── GET  /api/frames/{file}   → serve extracted detection frame images

Background thread (per upload)
  └── process_video_streaming()
        ├── reads video frame by frame
        ├── runs YOLOv8 inference every 3rd frame
        ├── on detection → saves frame image, calls on_detection() immediately
        │     └── on_detection → saves to SQLite + pushes SSE event (live!)
        └── pushes every frame as JPEG to MJPEG queue
```

---

## GPS Simulation

Since the current version uses pre-recorded video, GPS coordinates are interpolated along a real Sudbury, ON road route (Regent Street → LaSalle Blvd) based on video timestamp:

```python
SUDBURY_ROUTE = [
    (46.4917, -80.9930),  # Regent St South
    (46.4891, -80.9912),
    (46.4865, -80.9895),
    ...
]
```

In production: connect any NMEA GPS feed or browser Geolocation API.

---

## Project Structure

```
northroad-ai/
├── README.md
├── backend/
│   ├── main.py          # FastAPI app — upload, MJPEG, SSE, REST endpoints
│   ├── detection.py     # YOLOv8 inference engine + streaming frame loop
│   ├── gps_sim.py       # GPS interpolation along Sudbury route
│   ├── models.py        # SQLAlchemy models (Job, Hazard)
│   ├── database.py      # SQLite setup
│   ├── schemas.py       # Pydantic schemas
│   └── requirements.txt
└── frontend/
    ├── app/
    │   ├── layout.tsx         # Nav + dark theme shell
    │   ├── page.tsx           # Landing page
    │   ├── driver/page.tsx    # Live dashcam stream view
    │   └── dashboard/page.tsx # Municipal map dashboard
    └── components/
        ├── HazardMap.tsx      # Leaflet map (dashboard)
        ├── LiveMap.tsx        # Live map with moving car marker (driver)
        └── ui/                # shadcn components
```

---

## Running Locally

### Prerequisites
- Python 3.11+
- Node.js 20+
- `pip`, `npm`

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

On first run the YOLOv8 pothole model downloads automatically from HuggingFace (~50MB).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### API docs

FastAPI auto-generates interactive docs at [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| **Self-hosted** | Municipalities own their data — no cloud lock-in, works in areas with poor connectivity |
| **SQLite** | Zero setup, no Postgres instance needed, perfect for edge deployment |
| **OpenStreetMap** | Free forever, works offline, no API key to expire |
| **MJPEG over WebRTC** | Dead simple — just an `<img>` tag, works in every browser without JS libraries |
| **SSE over WebSockets** | One-directional detection events, auto-reconnects, works through proxies |
| **YOLOv8n/m on CPU** | No GPU required — runs on a $35 Raspberry Pi or city server |

---

## Detection Logic

```python
def classify_severity(box_w, box_h, frame_w, frame_h, confidence):
    area_pct = (box_w * box_h) / (frame_w * frame_h)
    if area_pct > 0.015 or confidence >= 0.80:
        return "HIGH"
    elif area_pct > 0.006 or confidence >= 0.55:
        return "MEDIUM"
    return "LOW"

TEMPORAL_GAP_SECONDS = 1.5   # min gap between saved detections
CONFIDENCE_THRESHOLD = 0.15  # tuned for real dashcam footage
```

Detections within 1.5 seconds of each other are deduplicated to the highest-confidence hit.
