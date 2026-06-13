import os
import logging
import random
import string
import traceback
import time
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware as FastAPICORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    FastAPICORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database ---
MONGODB_URI = os.getenv("MONGODB_URI")
# Use a short timeout for the initial connection check
client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
db = client.hackbuddy
mock_whiteboards: Dict[str, Dict[str, Any]] = {}

# Helper to check if DB is connected
async def is_db_connected():
    try:
        await client.admin.command('ping')
        return True
    except Exception:
        return False

# --- Models ---
class Task(BaseModel):
    model_config = {"populate_by_name": True}
    
    id: Optional[str] = Field(alias="_id", default=None)
    title: str
    description: Optional[str] = None
    column: str = "Backlog"
    assignee: Optional[str] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    git_linked: Optional[str] = None

class WhiteboardScenePayload(BaseModel):
    scene: Dict[str, Any] = Field(default_factory=dict)

# --- WebSocket ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)
        logger.info(f"WebSocket connected: room={room_id}, total={len(self.active_connections[room_id])}")

    def disconnect(self, room_id: str, websocket: WebSocket):
        try:
            if room_id in self.active_connections:
                if websocket in self.active_connections[room_id]:
                    self.active_connections[room_id].remove(websocket)
                    logger.info(f"WebSocket disconnected: room={room_id}")
        except Exception as e:
            logger.error(f"Error during disconnect: {e}")

    async def broadcast(self, room_id: str, message: dict):
        if room_id not in self.active_connections:
            return
        
        dead_connections = []
        for connection in self.active_connections[room_id]:
            try:
                await connection.send_json(message)
                logger.info(f"Broadcast sent to room={room_id}: {message.get('type')}")
            except Exception as e:
                logger.error(f"Failed to send to WebSocket: {e}")
                dead_connections.append(connection)
        
        # Clean up dead connections
        for dead in dead_connections:
            try:
                self.active_connections[room_id].remove(dead)
            except:
                pass

manager = ConnectionManager()

@app.websocket("/ws/board/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(room_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"WebSocket received from room={room_id}: {data[:100] if data else 'empty'}")
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(room_id, websocket)

# --- Kanban Endpoints ---

@app.post("/api/room/create")
async def create_room():
    # Generate a random 4-char alphanumeric string
    room_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    
    if await is_db_connected():
        await db.rooms.insert_one({"room_id": room_id, "created_at": "now"})
        return {"room_id": room_id}
    else:
        # Fallback
        return {"room_id": room_id}

@app.get("/api/board/{room_id}")
async def get_board(room_id: str):
    if await is_db_connected():
        board = await db.boards.find_one({"room_id": room_id})
        if not board:
            board = {"room_id": room_id, "columns": ["Backlog", "In Progress", "Done"], "tasks": []}
            await db.boards.insert_one(board)
        
        tasks = await db.tasks.find({"room_id": room_id, "deleted": {"$ne": True}}).to_list(length=100)
        clean_tasks = []
        for task in tasks:
            clean_task = {
                "id": str(task.pop("_id")),
                "title": task.get("title", ""),
                "description": task.get("description"),
                "column": task.get("column", "Backlog"),
                "assignee": task.get("assignee"),
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
                "git_linked": task.get("git_linked"),
            }
            clean_tasks.append(clean_task)
        return {"columns": board.get("columns", ["Backlog", "In Progress", "Done"]), "tasks": clean_tasks}
    else:
        # MOCK FALLBACK
        return {
            "columns": ["Backlog", "In Progress", "Done"],
            "tasks": [
                {
                    "id": "t_001",
                    "title": "Build auth flow (MOCK)",
                    "description": "JWT tokens, login page",
                    "column": "In Progress",
                    "assignee": "Alex",
                    "created_at": 1720000000,
                    "git_linked": None
                }
            ]
        }

@app.post("/api/task/create")
async def create_task(room_id: str, task: Task):
    if await is_db_connected():
        task_dict = task.model_dump(exclude={"id"}, exclude_none=True)
        task_dict["room_id"] = room_id
        if "created_at" not in task_dict:
            task_dict["created_at"] = int(__import__("time").time() * 1000)
        result = await db.tasks.insert_one(task_dict)
        task_dict["id"] = str(result.inserted_id)
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_CREATED", "task": task_dict})
        return task_dict
    else:
        return {"task_id": "t_mock_001", **task.model_dump()}

@app.put("/api/task/{task_id}")
async def update_task(room_id: str, task_id: str, task: Task):
    if await is_db_connected():
        task_dict = task.model_dump(exclude={"id"}, exclude_none=True)
        await db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": task_dict})
        task_dict["id"] = task_id
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_UPDATED", "task": task_dict})
        return {"task_id": task_id, **task_dict}
    else:
        return {"task_id": task_id, **task.model_dump()}

@app.delete("/api/task/{task_id}")
async def delete_task(room_id: str, task_id: str):
    if await is_db_connected():
        await db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": {"deleted": True}})
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_DELETED", "task_id": task_id})
    return {"ok": True}

# --- Whiteboard Endpoints ---

@app.get("/api/whiteboard/scene/{room_id}")
async def get_whiteboard_scene(room_id: str):
    default_scene = {"elements": [], "files": {}}
    now = int(time.time() * 1000)

    if await is_db_connected():
        board = await db.whiteboards.find_one({"room_id": room_id})
        if not board:
            board = {"room_id": room_id, "scene": default_scene, "updated_at": now}
            await db.whiteboards.insert_one(board)
        return {
            "scene": board.get("scene", default_scene),
            "updated_at": board.get("updated_at", now),
        }

    if room_id not in mock_whiteboards:
        mock_whiteboards[room_id] = {"scene": default_scene, "updated_at": now}
    return mock_whiteboards[room_id]

@app.put("/api/whiteboard/scene/{room_id}")
async def save_whiteboard_scene(room_id: str, payload: WhiteboardScenePayload):
    now = int(time.time() * 1000)
    scene = payload.scene or {}

    if not isinstance(scene.get("elements"), list):
        scene["elements"] = []
    if not isinstance(scene.get("files"), dict):
        scene["files"] = {}

    saved = {"scene": scene, "updated_at": now}

    if await is_db_connected():
        await db.whiteboards.update_one(
            {"room_id": room_id},
            {"$set": {"scene": scene, "updated_at": now}},
            upsert=True,
        )
    else:
        mock_whiteboards[room_id] = saved

    await manager.broadcast(room_id, {"type": "WHITEBOARD_UPDATED", "updated_at": now})
    return {"ok": True, **saved}

@app.post("/api/whiteboard/generate")
async def generate_whiteboard(room_id: str, data: dict):
    job = {"room_id": room_id, "status": "processing", "code": None}
    if await is_db_connected():
        result = await db.whiteboard_jobs.insert_one(job)
        return {"job_id": str(result.inserted_id)}
    return {"job_id": "job_wb_mock_001"}

@app.get("/api/whiteboard/{job_id}")
async def get_whiteboard_job(job_id: str):
    if await is_db_connected():
        job = await db.whiteboard_jobs.find_one({"_id": ObjectId(job_id)})
        if job:
            return {"status": job["status"], "code": job.get("code"), "framework": job.get("framework")}
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "completed", "code": "export default function GeneratedLayout() { return <div>Mock Code</div> }", "framework": "react"}

# --- Git Endpoints ---

@app.get("/api/git/{room_id}")
async def get_git_commits(room_id: str):
    if await is_db_connected():
        commits = await db.git_events.find({"room_id": room_id}).to_list(length=50)
        for commit in commits:
            commit["id"] = str(commit.pop("_id"))
        return {"commits": commits}
    return {"commits": []}

@app.post("/api/git/{room_id}/connect")
async def connect_git(room_id: str):
    if await is_db_connected():
        await db.rooms.update_one({"room_id": room_id}, {"$set": {"git_connected": True}}, upsert=True)
    return {"ok": True}

# --- Voice Endpoints ---

@app.post("/api/voice/speak")
async def speak_summary(room_id: str):
    job = {"room_id": room_id, "status": "processing"}
    if await is_db_connected():
        result = await db.voice_jobs.insert_one(job)
        return {"job_id": str(result.inserted_id)}
    return {"job_id": "job_voice_mock_001"}

@app.get("/api/voice/{job_id}")
async def get_voice_job(job_id: str):
    if await is_db_connected():
        job = await db.voice_jobs.find_one({"_id": ObjectId(job_id)})
        if job:
            return {"status": job["status"], "audio_url": job.get("audio_url")}
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "completed", "audio_url": "/static/voice/mock.mp3"}
