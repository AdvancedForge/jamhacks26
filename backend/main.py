import os
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

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

# --- Kanban Endpoints ---

@app.post("/api/room/create")
async def create_room():
    return {"room_id": "HB-4X9Z"}

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
        return task_dict
    else:
        return {"task_id": "t_mock_001", **task.dict()}

@app.put("/api/task/{task_id}")
async def update_task(task_id: str, task: Task):
    if await is_db_connected():
        task_dict = task.dict(exclude={"id"})
        await db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": task_dict})
        return {"task_id": task_id, **task_dict}
    else:
        return {"task_id": task_id, **task.dict()}

@app.delete("/api/task/{task_id}")
async def delete_task(task_id: str):
    if await is_db_connected():
        await db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": {"deleted": True}})
    return {"ok": True}
