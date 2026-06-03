import cv2
import uuid
import os
import torch
from pathlib import Path
from gps_sim import interpolate_gps

# PyTorch 2.6+ defaults weights_only=True which blocks Ultralytics model classes.
# Patch torch.load to default weights_only=False before any YOLO import.
_orig_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _orig_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

DETECTED_DIR = Path("detected")
DETECTED_DIR.mkdir(exist_ok=True)

TEMPORAL_GAP_SECONDS = 1.5
CONFIDENCE_THRESHOLD = 0.15   # tuned for real dashcam footage
INFERENCE_WIDTH = 640          # resize all frames to this width before inference


def _allowlist_ultralytics_globals():
    """PyTorch 2.6+ requires explicit allowlisting of non-standard classes."""
    try:
        import ultralytics.nn.tasks as tasks
        import ultralytics.nn.modules.head as head
        safe = [
            tasks.SegmentationModel,
            tasks.DetectionModel,
            tasks.ClassificationModel,
            tasks.PoseModel,
        ]
        try:
            safe.append(head.Detect)
            safe.append(head.Segment)
        except AttributeError:
            pass
        torch.serialization.add_safe_globals(safe)
    except Exception:
        pass


def classify_severity(box_w: float, box_h: float, frame_w: int, frame_h: int, confidence: float) -> str:
    area_pct = (box_w * box_h) / (frame_w * frame_h)
    if area_pct > 0.015 or confidence >= 0.80:
        return "HIGH"
    elif area_pct > 0.006 or confidence >= 0.55:
        return "MEDIUM"
    return "LOW"


def load_model():
    from ultralytics import YOLO
    _allowlist_ultralytics_globals()

    weights_path = Path("weights/pothole.pt")

    # Try HuggingFace pothole model first
    if not weights_path.exists():
        try:
            from huggingface_hub import hf_hub_download
            print("Downloading pothole model from HuggingFace...")
            downloaded = hf_hub_download(
                repo_id="keremberke/yolov8m-pothole-segmentation",
                filename="best.pt",
                local_dir="weights",
            )
            # hf_hub_download may return a cache path; copy it
            import shutil
            shutil.copy2(downloaded, weights_path)
            print("Pothole model downloaded.")
        except Exception as e:
            print(f"HuggingFace download failed: {e}")

    if weights_path.exists():
        try:
            model = YOLO(str(weights_path))
            print(f"Loaded pothole model: {weights_path}")
            return model
        except Exception as e:
            print(f"Failed to load pothole.pt ({e}), will try roboflow model")
            weights_path.unlink(missing_ok=True)

    # Fallback: try roboflow pothole model via ultralyticsplus
    try:
        from ultralyticsplus import YOLO as YOLO_PLUS
        print("Loading pothole model via ultralyticsplus...")
        model = YOLO_PLUS("keremberke/yolov8m-pothole-segmentation")
        model.overrides["conf"] = CONFIDENCE_THRESHOLD
        model.overrides["iou"] = 0.45
        model.overrides["max_det"] = 10
        return model
    except Exception as e:
        print(f"ultralyticsplus failed ({e})")

    # Final fallback: download a lightweight pothole-trained detection model
    # from Roboflow public model (no API key required for inference)
    try:
        import urllib.request
        yolov8s_path = Path("weights/yolov8s.pt")
        if not yolov8s_path.exists():
            print("Downloading yolov8s as base...")
        model = YOLO("yolov8s.pt")
        print("WARNING: Using base yolov8s — no pothole-specific weights. Detections will be generic.")
        return model
    except Exception as e:
        print(f"All model loads failed: {e}")
        raise


# Preload model once at module level so each job reuses it
_model = None

def get_model():
    global _model
    if _model is None:
        _model = load_model()
    return _model


def process_video_streaming(
    video_path: str,
    job_id: str,
    on_frame,       # callable(jpeg_bytes: bytes)
    on_progress,    # callable(pct: int)
    on_detection,   # callable(det_dict) — fires immediately when pothole found
):
    """
    Stream-aware variant: pushes every sampled frame to on_frame() in real-time
    and calls on_detection() the instant a pothole is found (not at the end).
    """
    import time
    model = get_model()
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    last_saved_ts = -TEMPORAL_GAP_SECONDS
    frame_num = 0
    SAMPLE_EVERY = 3
    frame_delay = SAMPLE_EVERY / fps

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_num += 1
        current_ts = frame_num / fps

        if frame_num % SAMPLE_EVERY != 0:
            continue

        h, w = frame.shape[:2]
        if w > INFERENCE_WIDTH:
            frame = cv2.resize(frame, (INFERENCE_WIDTH, int(h * INFERENCE_WIDTH / w)))

        results = model(frame, conf=CONFIDENCE_THRESHOLD, verbose=False)[0]

        has_boxes = results.boxes is not None and len(results.boxes) > 0
        if has_boxes and (current_ts - last_saved_ts >= TEMPORAL_GAP_SECONDS):
            boxes = sorted(results.boxes, key=lambda b: float(b.conf[0]), reverse=True)
            box = boxes[0]
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            fh, fw = frame.shape[:2]
            severity = classify_severity(x2 - x1, y2 - y1, fw, fh, conf)

            annotated = results.plot()
            frame_id = str(uuid.uuid4())[:8]
            frame_file = f"{frame_id}.jpg"
            cv2.imwrite(str(DETECTED_DIR / frame_file), annotated)

            lat, lng = interpolate_gps(frame_num, total_frames)
            det = {
                "id": str(uuid.uuid4()),
                "job_id": job_id,
                "lat": lat,
                "lng": lng,
                "severity": severity,
                "confidence": conf,
                "frame_file": frame_file,
                "video_timestamp": current_ts,
                "status": "open",
            }
            last_saved_ts = current_ts

            # Fire SSE + DB save immediately — not at the end
            on_detection(det)

            _, jpeg = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            on_frame(jpeg.tobytes())
        else:
            _, jpeg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            on_frame(jpeg.tobytes())

        on_progress(int((frame_num / total_frames) * 100))
        time.sleep(max(0, frame_delay))

        # Throttle to simulate real driving speed
        time.sleep(max(0, frame_delay))

    cap.release()
    return detections


def process_video(video_path: str, job_id: str, db, update_job_progress):
    model = get_model()

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    last_saved_ts = -TEMPORAL_GAP_SECONDS
    frame_num = 0
    detections = []

    # Sample every 3rd frame to speed up processing
    SAMPLE_EVERY = 3

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_num += 1
        current_ts = frame_num / fps

        if frame_num % SAMPLE_EVERY != 0:
            continue

        # Resize to fixed width for consistent, fast inference
        h, w = frame.shape[:2]
        if w > INFERENCE_WIDTH:
            frame = cv2.resize(frame, (INFERENCE_WIDTH, int(h * INFERENCE_WIDTH / w)))

        results = model(frame, conf=CONFIDENCE_THRESHOLD, verbose=False)[0]

        has_boxes = results.boxes is not None and len(results.boxes) > 0
        if has_boxes and (current_ts - last_saved_ts >= TEMPORAL_GAP_SECONDS):
            # Sort by confidence descending, take best
            boxes = sorted(results.boxes, key=lambda b: float(b.conf[0]), reverse=True)
            box = boxes[0]
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            fh, fw = frame.shape[:2]
            severity = classify_severity(x2 - x1, y2 - y1, fw, fh, conf)

            annotated = results.plot()
            frame_id = str(uuid.uuid4())[:8]
            frame_file = f"{frame_id}.jpg"
            cv2.imwrite(str(DETECTED_DIR / frame_file), annotated)

            lat, lng = interpolate_gps(frame_num, total_frames)
            detections.append({
                "id": str(uuid.uuid4()),
                "job_id": job_id,
                "lat": lat,
                "lng": lng,
                "severity": severity,
                "confidence": conf,
                "frame_file": frame_file,
                "video_timestamp": current_ts,
                "status": "open",
            })
            last_saved_ts = current_ts

        progress = int((frame_num / total_frames) * 100)
        update_job_progress(job_id, progress, db)

    cap.release()
    return detections
