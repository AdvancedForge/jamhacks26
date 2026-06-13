import os
import logging
import random
import string
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://jamhacks26.vercel.app", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database ---
MONGODB_URI = os.getenv("MONGODB_URI")
# Use a short timeout for the initial connection check
client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
db = client.hackbuddy

# Helper to check if DB is connected
async def is_db_connected():
    try:
        await client.admin.command('ping')
        return True
    except Exception:
        return False

# --- Models ---
class Task(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)
    title: str
    description: Optional[str] = None
    column: str = "Backlog"
    assignee: Optional[str] = None
    created_at: int
    git_linked: Optional[str] = None

# --- WebSocket ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)

    def disconnect(self, room_id: str, websocket: WebSocket):
        self.active_connections[room_id].remove(websocket)

    async def broadcast(self, room_id: str, message: dict):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                await connection.send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/board/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    # Manually check origin during handshake to resolve potential WebSocket CORS issues
    origin = websocket.headers.get("origin")
    allowed_origins = ["https://jamhacks26.vercel.app", "http://localhost:5173"]
    if origin not in allowed_origins:
        await websocket.close(code=1008) # Policy Violation
        return

    await manager.connect(room_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
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
        
        tasks = await db.tasks.find({"room_id": room_id}).to_list(length=100)
        for task in tasks:
            task["id"] = str(task.pop("_id"))
        return {"columns": board.get("columns", ["Backlog", "In Progress", "Done"]), "tasks": tasks}
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
        task_dict = task.dict(exclude={"id"})
        task_dict["room_id"] = room_id
        result = await db.tasks.insert_one(task_dict)
        task_dict["id"] = str(result.inserted_id)
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_CREATED", "task": task_dict})
        return task_dict
    else:
        return {"task_id": "t_mock_001", **task.dict()}

@app.put("/api/task/{task_id}")
async def update_task(room_id: str, task_id: str, task: Task):
    if await is_db_connected():
        task_dict = task.dict(exclude={"id"})
        await db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": task_dict})
        task_dict["id"] = task_id
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_UPDATED", "task": task_dict})
        return {"task_id": task_id, **task_dict}
    else:
        return {"task_id": task_id, **task.dict()}

@app.delete("/api/task/{task_id}")
async def delete_task(room_id: str, task_id: str):
    if await is_db_connected():
        await db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": {"deleted": True}})
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_DELETED", "task_id": task_id})
    return {"ok": True}

# --- Whiteboard Endpoints ---

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
