"""
CameraWorker: runs YOLO inference in a thread pool and broadcasts results
to all WebSocket subscribers.

Each worker:
  - opens a VideoCapture for the camera source
  - calls the existing Monitor.process_frame() in an executor (CPU-bound)
  - serialises results to JSON + base64 JPEG
  - puts them in an asyncio.Queue per subscriber

Demo mode is activated when the source cannot be opened (e.g., no camera
connected during development).
"""

import asyncio
import base64
import logging
import math
import queue
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from backend.schemas import CameraFrame, ComplianceSummary, DetectionItem

logger = logging.getLogger(__name__)

# Shared thread-pool — one thread per camera so none wait for a slot
_executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="camera_worker")

# Base directory of the project (one level up from backend/)
BASE_DIR = Path(__file__).parent.parent

# ── Shared YOLO model ─────────────────────────────────────────────────────────
_shared_monitor = None
_shared_monitor_lock = threading.Lock()

# ── Batch inference dispatcher ────────────────────────────────────────────────
# Camera workers submit frames to _infer_queue.
# A single dispatcher thread collects up to BATCH_SIZE frames, runs one
# batched YOLO call, then signals each waiting worker with its results.
BATCH_SIZE       = 8    # max frames per GPU call (sweet spot on RTX 3050)
BATCH_COLLECT_MS = 15   # ms to wait for more frames before firing the batch

@dataclass
class _InferRequest:
    frame: np.ndarray
    event: threading.Event = field(default_factory=threading.Event)
    persons: Optional[list] = None   # List[Box] — filled by dispatcher
    ppe:     Optional[list] = None   # List[Box] — filled by dispatcher
    error:   Optional[Exception] = None

_infer_queue: queue.Queue = queue.Queue(maxsize=64)
_dispatcher_thread: Optional[threading.Thread] = None
_dispatcher_running = False

# ── Dynamic skip ──────────────────────────────────────────────────────────────
_gpu_infer_ms_per_frame = 8.0    # EMA: ms per frame — start low for TensorRT
_active_cameras: set[str] = set()
_active_cameras_lock = threading.Lock()
_infer_every_n_override: Optional[int] = None  # None = auto, int = manual

def set_infer_every_n(value: Optional[int]) -> None:
    """Set manual inference frequency override (None restores auto mode)."""
    global _infer_every_n_override
    _infer_every_n_override = value

def get_infer_every_n_override() -> Optional[int]:
    return _infer_every_n_override

# ── Stream FPS override ────────────────────────────────────────────────────────
_stream_fps_override: Optional[int] = None  # None = use STREAM_FPS_MAX default

def set_stream_fps(value: Optional[int]) -> None:
    """Set the max FPS streamed to frontend. None restores the default."""
    global _stream_fps_override
    _stream_fps_override = value

def get_stream_fps_override() -> Optional[int]:
    return _stream_fps_override

def _effective_stream_fps(src_fps: float) -> float:
    cap = _stream_fps_override if _stream_fps_override is not None else STREAM_FPS_MAX
    return min(src_fps, max(1, cap))

def _update_active(camera_id: str, has_subscribers: bool) -> None:
    with _active_cameras_lock:
        if has_subscribers:
            _active_cameras.add(camera_id)
        else:
            _active_cameras.discard(camera_id)

def _dynamic_infer_every_n() -> int:
    """Compute frame-skip so GPU stays at most fully loaded."""
    if _infer_every_n_override is not None:
        return max(1, _infer_every_n_override)
    with _active_cameras_lock:
        n = max(1, len(_active_cameras))
    # Sustainable throughput: frames/sec the dispatcher can sustain
    batch_fps = 1000.0 / max(_gpu_infer_ms_per_frame, 1.0)
    needed    = n * STREAM_FPS_MAX          # frames/sec demanded by all cameras
    skip      = math.ceil(needed / batch_fps)
    return max(1, skip)


def _build_monitor(cam_source: str, conf_helmet: float, conf_vest: float):
    """Build a Monitor instance from the existing workplace_safety_monitor module."""
    sys.path.insert(0, str(BASE_DIR))
    logger.info("Building YOLO monitor for source='%s' (BASE_DIR=%s)", cam_source, BASE_DIR)
    try:
        import argparse
        import torch
        import workplace_safety_monitor as wsm  # noqa: F401

        # Prefer TensorRT engine if available (significantly faster)
        def _find_model(stem: str) -> str:
            engine = BASE_DIR / f"{stem}.engine"
            return str(engine) if engine.exists() else str(BASE_DIR / f"{stem}.pt")

        person_model = _find_model("yolo12n")
        ppe_model    = _find_model("best")
        logger.info("Models: person=%s  ppe=%s", Path(person_model).suffix, Path(ppe_model).suffix)

        args = argparse.Namespace(
            source=cam_source,
            person_weights=person_model,
            person_conf=0.45,
            ppe_weights=ppe_model,
            ppe_onnx="",
            class_names=["helmet", "vest"],
            input_size=640,
            conf_helmet=conf_helmet,
            conf_vest=conf_vest,
            nms_iou=0.50,
            min_box_area=900,
            max_aspect_ratio=3.5,
            track_iou=0.35,
            track_max_age=5,
            head_iou_gate=0.10,
            torso_iou_gate=0.15,
            ppe_inside_person_frac=0.35,
            temporal_window=7,
            save_vis="",
            eval_root="",
        )
        monitor = wsm.Monitor(args)

        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("YOLO monitor built successfully (device=%s)", device)
        return monitor
    except Exception as exc:
        logger.warning("Could not build Monitor — raw frames only", exc_info=True)
        return None


def _get_shared_monitor():
    """Return the singleton Monitor, building it on first call."""
    global _shared_monitor
    if _shared_monitor is not None:
        return _shared_monitor
    with _shared_monitor_lock:
        if _shared_monitor is None:
            _shared_monitor = _build_monitor("shared", 0.65, 0.70)
            if _shared_monitor:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                if torch.cuda.is_available():
                    used = torch.cuda.memory_allocated(0) / 1024**2
                    total = torch.cuda.get_device_properties(0).total_memory / 1024**2
                    logger.info("Shared YOLO monitor ready on %s | VRAM %.0f/%.0f MB", device, used, total)
                else:
                    logger.info("Shared YOLO monitor ready on cpu")
            _ensure_dispatcher()
    return _shared_monitor


# ── Batch result parsers ──────────────────────────────────────────────────────

def _parse_person_boxes(result) -> list:
    """Ultralytics Results → List[Box] (person class only, area ≥ 900px²)."""
    sys.path.insert(0, str(BASE_DIR))
    from workplace_safety_monitor import Box  # noqa: PLC0415
    boxes = []
    for b in result.boxes:
        if int(b.cls) != 0:
            continue
        x1, y1, x2, y2 = (int(v) for v in b.xyxy[0].tolist())
        if (x2 - x1) * (y2 - y1) < 900:
            continue
        boxes.append(Box(x1, y1, x2, y2, float(b.conf), 0, "person"))
    return boxes


def _parse_ppe_boxes(result) -> list:
    """Ultralytics Results → List[Box] using model's own class names as labels.
    _split_classes() matches on label string ('helmet', 'vest', …) not cls int.
    """
    sys.path.insert(0, str(BASE_DIR))
    from workplace_safety_monitor import Box  # noqa: PLC0415
    # Use the model's names dict so labels match what _split_classes expects
    names = result.names  # e.g. {4: 'Helmet', 7: 'Vest', …}
    boxes = []
    for b in result.boxes:
        x1, y1, x2, y2 = (int(v) for v in b.xyxy[0].tolist())
        cls = int(b.cls)
        label = names.get(cls, str(cls))   # 'Helmet', 'Vest', 'Person', …
        boxes.append(Box(x1, y1, x2, y2, float(b.conf), cls, label))
    return boxes


# ── Dispatcher (runs in its own daemon thread) ────────────────────────────────

def _run_dispatcher():
    global _gpu_infer_ms_per_frame, _dispatcher_running
    logger.info("Batch inference dispatcher started (batch_size=%d)", BATCH_SIZE)

    while _dispatcher_running:
        # Block until at least one request arrives
        try:
            first = _infer_queue.get(timeout=0.1)
        except queue.Empty:
            continue

        batch: list[_InferRequest] = [first]
        deadline = time.perf_counter() + BATCH_COLLECT_MS / 1000.0

        # Collect more frames within the time window
        while len(batch) < BATCH_SIZE:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                break
            try:
                batch.append(_infer_queue.get(timeout=remaining))
            except queue.Empty:
                break

        m = _shared_monitor
        if m is None:
            for req in batch:
                req.persons, req.ppe = [], []
                req.event.set()
            continue

        try:
            frames = [req.frame for req in batch]
            n_real = len(frames)

            # TensorRT batch=8 engines require exactly BATCH_SIZE frames — pad if needed
            if n_real < BATCH_SIZE:
                pad = [frames[-1]] * (BATCH_SIZE - n_real)
                frames = frames + pad

            t0 = time.perf_counter()

            person_res = m.person_det.model(frames, conf=m.person_det.conf, verbose=False)
            ppe_res    = m.ppe_backend.model(frames, conf=m.ppe_backend.conf_th,
                                              iou=m.ppe_backend.nms_iou, verbose=False)

            elapsed = (time.perf_counter() - t0) * 1000
            per_frame = elapsed / BATCH_SIZE
            _gpu_infer_ms_per_frame = _gpu_infer_ms_per_frame * 0.9 + per_frame * 0.1

            logger.debug("Batch %d/%d frames | %.0fms total | %.0fms/frame",
                         n_real, BATCH_SIZE, elapsed, per_frame)

            for i, req in enumerate(batch):   # only n_real results
                req.persons = _parse_person_boxes(person_res[i])
                req.ppe     = _parse_ppe_boxes(ppe_res[i])
                req.event.set()

        except Exception as exc:
            logger.warning("Dispatcher inference error: %s", exc, exc_info=True)
            for req in batch:
                req.persons, req.ppe = [], []
                req.error = exc
                req.event.set()


def _ensure_dispatcher():
    global _dispatcher_thread, _dispatcher_running
    if _dispatcher_thread and _dispatcher_thread.is_alive():
        return
    _dispatcher_running = True
    _dispatcher_thread = threading.Thread(
        target=_run_dispatcher, daemon=True, name="infer-dispatcher"
    )
    _dispatcher_thread.start()


# ── Demo frame generation ────────────────────────────────────────────────────

def _make_demo_frame(frame_id: int, camera_id: str) -> CameraFrame:
    """Generate a synthetic frame for demo/development purposes."""
    h, w = 480, 640
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = (30, 30, 30)

    # Grid lines
    for x in range(0, w, 80):
        cv2.line(img, (x, 0), (x, h), (50, 50, 50), 1)
    for y in range(0, h, 80):
        cv2.line(img, (0, y), (w, y), (50, 50, 50), 1)

    cv2.putText(img, f"DEMO  {camera_id}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100, 200, 100), 2)
    cv2.putText(img, datetime.now().strftime("%H:%M:%S"), (20, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)

    # Simulate 2–3 moving persons
    detections: list[DetectionItem] = []
    rng = random.Random(frame_id // 30)  # slow movement
    n_persons = rng.randint(2, 3)

    statuses = ["compliant", "compliant", "partial", "non_compliant"]
    compliant = 0
    partial = 0
    non_compliant = 0

    for i in range(n_persons):
        cx = int(w * (0.2 + 0.6 * ((i + rng.random() * 0.1) / n_persons)))
        cy = int(h * (0.35 + 0.1 * math.sin(frame_id / 30 + i)))
        bw, bh = 80, 160
        x1, y1 = max(0, cx - bw // 2), max(0, cy - bh // 2)
        x2, y2 = min(w, cx + bw // 2), min(h, cy + bh // 2)

        status = statuses[rng.randint(0, 3)]
        helmet = status in ("compliant",)
        vest = status in ("compliant", "partial")
        confidence = round(rng.uniform(0.65, 0.95), 2)

        color = (0, 220, 0) if status == "compliant" else (0, 140, 255) if status == "partial" else (0, 0, 220)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        label = f"#{i+1} H:{'Y' if helmet else 'N'} V:{'Y' if vest else 'N'}"
        cv2.putText(img, label, (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

        if status == "compliant":
            compliant += 1
        elif status == "partial":
            partial += 1
        else:
            non_compliant += 1

        detections.append(DetectionItem(
            track_id=i + 1,
            status=status,
            helmet=helmet,
            vest=vest,
            bbox=[x1, y1, x2, y2],
            confidence=confidence,
        ))

    total = compliant + partial + non_compliant
    compliance_rate = round(compliant / total, 2) if total else 1.0
    summary = ComplianceSummary(
        total_persons=total,
        compliant=compliant,
        partial=partial,
        non_compliant=non_compliant,
        compliance_rate=compliance_rate,
    )

    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
    jpeg_b64 = base64.b64encode(buf).decode()

    return CameraFrame(
        frame_id=frame_id,
        camera_id=camera_id,
        timestamp=datetime.utcnow().isoformat(),
        jpeg_b64=jpeg_b64,
        detections=detections,
        summary=summary,
    )


# ── CameraWorker ─────────────────────────────────────────────────────────────

STREAM_FPS_MAX   = 10  # cap backend streaming — reduces encoding/WS/render load 3x
INFER_EVERY_N    = 999999  # DIAG: skip inference — raw video only
MAX_CACHE_FRAMES = 4   # clear stale boxes after this many frames (~0.4s at 10fps)
JPEG_QUALITY     = 50  # lower = smaller payload, faster transmission

# ── False-positive suppression ────────────────────────────────────────────────
# Persons whose bounding box is less than this fraction inside the frame are
# treated as compliant (benefit of the doubt) — they are likely entering or
# leaving the scene and their PPE zone may be cut off by the frame edge.
MIN_VISIBLE_FRAC = 0.75

def _visible_frac(box, W: int, H: int) -> float:
    """Fraction of the bounding box area that lies within the frame."""
    x1, y1, x2, y2 = int(box.x1), int(box.y1), int(box.x2), int(box.y2)
    box_area = max(1, (x2 - x1) * (y2 - y1))
    cx1, cy1 = max(0, x1), max(0, y1)
    cx2, cy2 = min(W, x2), min(H, y2)
    clipped = max(0, cx2 - cx1) * max(0, cy2 - cy1)
    return clipped / box_area


class CameraWorker:
    def __init__(self, camera_id: str, source: str, conf_helmet: float, conf_vest: float):
        self.camera_id = camera_id
        self.source = source
        self.conf_helmet = conf_helmet
        self.conf_vest = conf_vest
        self.current_summary = ComplianceSummary()
        self._subscribers: list[asyncio.Queue] = []
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._frame_id = 0
        self._monitor = None
        self._tracker = None      # per-camera IoUTracker
        self._smoother = None     # per-camera PPESmoother
        self._frame_skip: int = 1 # source frames to skip per stream frame
        self._src_fps: float = 25.0
        self._demo_mode = False
        self._last_violation: dict[int, datetime] = {}  # track_id → last logged time
        self._cached_detections: list[DetectionItem] = []
        self._cached_summary = ComplianceSummary()
        self._cache_frame_id: int = 0  # frame when cache was last updated from inference

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=5)
        self._subscribers.append(q)
        _update_active(self.camera_id, True)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass
        _update_active(self.camera_id, bool(self._subscribers))

    def _broadcast(self, frame: CameraFrame):
        self.current_summary = frame.summary
        for q in list(self._subscribers):
            try:
                q.put_nowait(frame)
            except asyncio.QueueFull:
                pass  # drop oldest if consumer is slow

    async def _log_violations(self, frame: CameraFrame):
        """Persist non-compliant detections to the database (30-second cooldown per track)."""
        from backend.database import AsyncSessionLocal
        from backend.models import Violation

        now = datetime.utcnow()
        to_log = []
        for det in frame.detections:
            if det.status == "compliant":
                continue
            last = self._last_violation.get(det.track_id)
            if last and (now - last).total_seconds() < 30:
                continue
            self._last_violation[det.track_id] = now
            if not det.helmet and not det.vest:
                vtype = "no_helmet_no_vest"
            elif not det.helmet:
                vtype = "no_helmet"
            else:
                vtype = "no_vest"

            # Save snapshot JPEG for this violation
            snapshot_path = ""
            try:
                snap_dir = BASE_DIR / "snapshots"
                snap_dir.mkdir(exist_ok=True)
                ts = now.strftime("%Y%m%d_%H%M%S")
                snap_file = snap_dir / f"{self.camera_id}_{ts}_{det.track_id}.jpg"
                snap_file.write_bytes(base64.b64decode(frame.jpeg_b64))
                snapshot_path = str(snap_file)
            except Exception as e:
                logger.warning("Snapshot save failed: %s", e)

            to_log.append(Violation(
                camera_id=self.camera_id,
                track_id=det.track_id,
                type=vtype,
                started_at=now,
                duration_seconds=0.0,
                snapshot_path=snapshot_path,
            ))

        if not to_log:
            return
        try:
            async with AsyncSessionLocal() as db:
                db.add_all(to_log)
                await db.commit()
        except Exception as exc:
            logger.warning("Failed to log violations: %s", exc)

    def _process_one_frame(self, cap: cv2.VideoCapture):
        """Called in thread-pool. Returns CameraFrame or None."""
        # Skip source frames to match target stream FPS
        skip = getattr(self, "_frame_skip", 1)
        for _ in range(skip - 1):
            cap.grab()  # discard without decoding
        ret, frame = cap.read()
        if not ret:
            return None

        self._frame_id += 1
        run_inference = (self._frame_id % _dynamic_infer_every_n() == 0)

        # No monitor available — stream raw frame without inference
        if self._monitor is None:
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            jpeg_b64 = base64.b64encode(buf).decode()
            return CameraFrame(
                frame_id=self._frame_id,
                camera_id=self.camera_id,
                timestamp=datetime.utcnow().isoformat(),
                jpeg_b64=jpeg_b64,
                detections=[],
                summary=ComplianceSummary(),
            )

        try:
            persons_raw = None
            ppe_all     = None

            if run_inference:
                # Submit frame to the batch dispatcher and wait for result
                req = _InferRequest(frame=frame)
                try:
                    _infer_queue.put_nowait(req)
                    if req.event.wait(timeout=2.0) and req.persons is not None:
                        persons_raw = req.persons
                        ppe_all     = req.ppe
                except queue.Full:
                    pass   # queue saturated — fall through to cache

            if persons_raw is not None:
                # ── Full inference path ──────────────────────────────────────
                m   = self._monitor
                h, w = frame.shape[:2]

                ppe_all   = m._filter_boxes(ppe_all)
                helmets, vests = m._split_classes(ppe_all)
                tracks    = self._tracker.update(persons_raw, w, h)

                track_items = sorted(tracks.items())
                track_ids   = [tid for tid, _ in track_items]
                persons     = [box for _, box in track_items]

                matched_h, matched_v = m._assign_ppe_to_persons(persons, helmets, vests)
                have_h   = [mh is not None for mh in matched_h]
                have_v   = [mv is not None for mv in matched_v]
                smoothed = self._smoother.update(track_ids, have_h, have_v)

                # Benefit-of-the-doubt for edge-clipped persons:
                # if < MIN_VISIBLE_FRAC of their bbox is inside the frame,
                # their PPE zone may be cut off — don't report as violation.
                smoothed = [
                    (True, True) if _visible_frac(box, w, h) < MIN_VISIBLE_FRAC else result
                    for box, result in zip(persons, smoothed)
                ]

                vis = frame.copy()
                from workplace_safety_monitor import draw_person_ppe  # noqa: PLC0415
                for i, p in enumerate(persons):
                    sh, sv = smoothed[i]
                    draw_person_ppe(vis, p, sh, sv, matched_h[i], matched_v[i], track_ids[i])

                detections: list[DetectionItem] = []
                compliant = partial = non_compliant = 0
                for i, (tid, box) in enumerate(track_items):
                    has_helmet, has_vest = smoothed[i]
                    if has_helmet and has_vest:
                        status = "compliant";     compliant     += 1
                    elif has_helmet or has_vest:
                        status = "partial";       partial       += 1
                    else:
                        status = "non_compliant"; non_compliant += 1
                    detections.append(DetectionItem(
                        track_id=tid, status=status, helmet=has_helmet, vest=has_vest,
                        bbox=[int(box.x1), int(box.y1), int(box.x2), int(box.y2)],
                        confidence=round(float(box.conf), 2),
                    ))

                total = compliant + partial + non_compliant
                summary = ComplianceSummary(
                    total_persons=total, compliant=compliant, partial=partial,
                    non_compliant=non_compliant,
                    compliance_rate=round(compliant / total, 2) if total else 1.0,
                )
                self._cached_detections = detections
                self._cached_summary    = summary
                self._cache_frame_id    = self._frame_id

                if self._frame_id % 30 == 0:
                    n = _dynamic_infer_every_n()
                    logger.info("Batch %.0fms/frame | active=%d | skip=%d | eff=%.1f FPS/cam",
                                _gpu_infer_ms_per_frame, len(_active_cameras), n, STREAM_FPS_MAX / n)
            else:
                # ── Cache path (skipped or queue full) ───────────────────────
                vis = frame.copy()
                # Cache must last at least until the next inference cycle
                cache_ttl = max(MAX_CACHE_FRAMES, _dynamic_infer_every_n() + 2)
                stale = (self._frame_id - self._cache_frame_id) > cache_ttl
                detections = [] if stale else self._cached_detections
                summary    = ComplianceSummary() if stale else self._cached_summary

            _, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            return CameraFrame(
                frame_id=self._frame_id,
                camera_id=self.camera_id,
                timestamp=datetime.utcnow().isoformat(),
                jpeg_b64=base64.b64encode(buf).decode(),
                detections=detections,
                summary=summary,
            )
        except Exception as exc:
            logger.warning("Frame processing error: %s", exc, exc_info=True)
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            return CameraFrame(
                frame_id=self._frame_id,
                camera_id=self.camera_id,
                timestamp=datetime.utcnow().isoformat(),
                jpeg_b64=base64.b64encode(buf).decode(),
                detections=self._cached_detections,
                summary=self._cached_summary,
            )

    def _resolve_source(self) -> str:
        """Return the actual VideoCapture source string.
        'demo' → loop the bundled test video (or first video found in test_videos/).
        A digit string → camera index.
        Anything else → path / RTSP URL as-is.
        """
        if self.source == "demo":
            candidates = sorted(BASE_DIR.glob("test_videos/*.*"))
            if candidates:
                logger.info("Demo mode: using video file '%s'", candidates[0])
                return str(candidates[0])
            logger.warning("Demo mode: no video found in test_videos/, falling back to synthetic frames")
            return ""          # empty → synthetic fallback
        return self.source

    async def _run_loop(self):
        loop = asyncio.get_event_loop()

        actual_src = self._resolve_source()

        if actual_src == "":
            # No demo video available — use synthetic frames
            self._demo_mode = True
            cap = None
            frame_interval = 0.1
        else:
            cap = await loop.run_in_executor(
                _executor,
                lambda: cv2.VideoCapture(int(actual_src) if actual_src.isdigit() else actual_src),
            )
            if not cap.isOpened():
                logger.warning("Cannot open source '%s' for camera '%s' — synthetic demo", actual_src, self.camera_id)
                self._demo_mode = True
                cap = None
                frame_interval = 0.1
            else:
                src_fps = cap.get(cv2.CAP_PROP_FPS) or 25
                self._src_fps = src_fps
                stream_fps = _effective_stream_fps(src_fps)
                frame_interval = 1.0 / stream_fps
                self._frame_skip = max(1, round(src_fps / stream_fps))
                logger.info("Camera '%s' src=%.0ffps stream=%.0ffps skip=%d",
                            self.camera_id, src_fps, stream_fps, self._frame_skip)
                # Use shared YOLO models (built once, reused by all cameras)
                self._monitor = await loop.run_in_executor(_executor, _get_shared_monitor)
                # Per-camera tracking state
                sys.path.insert(0, str(BASE_DIR))
                from workplace_safety_monitor import IoUTracker, PPESmoother  # noqa: PLC0415
                self._tracker = IoUTracker(iou_th=0.35, max_age=2, min_hits=3)
                self._smoother = PPESmoother(window=10)

        try:
            while self._running:
                if self._demo_mode:
                    # Synthetic frame fallback (no video file available)
                    self._frame_id += 1
                    frame_data = _make_demo_frame(self._frame_id, self.camera_id)
                    self._broadcast(frame_data)
                    await asyncio.sleep(0.1)
                else:
                    # Recompute frame_interval and frame_skip dynamically each iteration
                    # so that changes to _stream_fps_override take effect without restart.
                    stream_fps = _effective_stream_fps(self._src_fps)
                    frame_interval = 1.0 / stream_fps
                    self._frame_skip = max(1, round(self._src_fps / stream_fps))

                    if not self._subscribers:
                        # No one watching — advance video position but skip inference
                        await loop.run_in_executor(_executor, cap.grab)
                        await asyncio.sleep(frame_interval)
                        continue

                    t0 = loop.time()
                    frame_data = await loop.run_in_executor(_executor, lambda: self._process_one_frame(cap))
                    if frame_data is None:
                        # End of video — loop back to start
                        await loop.run_in_executor(_executor, lambda: cap.set(cv2.CAP_PROP_POS_FRAMES, 0))
                        continue
                    self._broadcast(frame_data)
                    await self._log_violations(frame_data)

                    # Keep video in sync with wall clock: if processing took longer
                    # than one frame interval, skip ahead proportionally instead of
                    # falling further behind on each iteration.
                    elapsed = loop.time() - t0
                    sleep_time = max(0.0, frame_interval - elapsed)
                    if elapsed > frame_interval:
                        frames_behind = int(elapsed / frame_interval) - 1
                        if frames_behind > 0:
                            n_grab = frames_behind * self._frame_skip
                            await loop.run_in_executor(
                                _executor,
                                lambda n=n_grab: [cap.grab() for _ in range(n)],
                            )
                    await asyncio.sleep(sleep_time)
        finally:
            if cap is not None:
                cap.release()

    def start(self):
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.ensure_future(self._run_loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


# ── CameraManager ─────────────────────────────────────────────────────────────

class CameraManager:
    def __init__(self):
        self._workers: dict[str, CameraWorker] = {}

    def get_worker(self, camera_id: str) -> Optional[CameraWorker]:
        return self._workers.get(camera_id)

    def get_all_workers(self) -> list[CameraWorker]:
        return list(self._workers.values())

    async def start_camera(self, cam) -> CameraWorker:
        if cam.id in self._workers:
            await self.stop_camera(cam.id)
        worker = CameraWorker(cam.id, cam.source, cam.conf_helmet, cam.conf_vest)
        worker.start()
        self._workers[cam.id] = worker
        return worker

    async def stop_camera(self, camera_id: str):
        worker = self._workers.pop(camera_id, None)
        if worker:
            await worker.stop()

    async def stop_all(self):
        for cid in list(self._workers.keys()):
            await self.stop_camera(cid)


camera_manager = CameraManager()
