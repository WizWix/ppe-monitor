"""
WebSocket endpoint: ws://host/ws/cameras/{camera_id}/stream
Sends CameraFrame JSON to every connected client.
"""
import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/cameras/{camera_id}/stream")
async def camera_stream(websocket: WebSocket, camera_id: str):
    from backend.monitor_bridge import camera_manager

    await websocket.accept()

    worker = camera_manager.get_worker(camera_id)
    if worker is None:
        await websocket.send_json({"error": f"Camera '{camera_id}' is not running"})
        await websocket.close()
        return

    queue = worker.subscribe()
    logger.info("WS client connected to camera '%s'", camera_id)

    try:
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=5.0)
                await websocket.send_text(frame.model_dump_json())
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        worker.unsubscribe(queue)
        logger.info("WS client disconnected from camera '%s'", camera_id)
