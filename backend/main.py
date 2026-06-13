from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

# --- Mock Data ---

@app.post("/api/room/create")
async def create_room():
    return {"room_id": "HB-4X9Z"}

@app.get("/api/board/{room_id}")
async def get_board(room_id: str):
    return {
        "columns": ["Backlog", "In Progress", "Done"],
        "tasks": [
            {
                "id": "t_001",
                "title": "Build auth flow",
                "description": "JWT tokens, login page",
                "column": "In Progress",
                "assignee": "Alex",
                "created_at": 1720000000,
                "git_linked": None
            }
        ]
    }

class Task(BaseModel):
    title: str
    description: Optional[str] = None
    column: str = "Backlog"
    assignee: Optional[str] = None

@app.post("/api/task/create")
async def create_task(task: Task):
    return {"task_id": "t_002", **task.dict()}

@app.put("/api/task/{task_id}")
async def update_task(task_id: str, task: Task):
    return {"task_id": task_id, **task.dict()}

@app.delete("/api/task/{task_id}")
async def delete_task(task_id: str):
    return {"ok": True}

# --- Whiteboard ---

@app.post("/api/whiteboard/generate")
async def generate_whiteboard():
    return {"job_id": "job_wb_001"}

@app.get("/api/whiteboard/{job_id}")
async def get_whiteboard_job(job_id: str):
    return {"status": "completed", "code": "export default function GeneratedLayout() { return <div>Generated</div> }", "framework": "react"}

# --- Git ---

@app.get("/api/git/{room_id}")
async def get_git_commits(room_id: str):
    return {"commits": []}

@app.post("/api/git/{room_id}/connect")
async def connect_git(room_id: str):
    return {"ok": True}

# --- Voice ---

@app.post("/api/voice/speak")
async def speak_summary():
    return {"job_id": "job_voice_001"}

@app.get("/api/voice/{job_id}")
async def get_voice_job(job_id: str):
    return {"status": "completed", "audio_url": "/static/voice/job_voice_001.mp3"}
