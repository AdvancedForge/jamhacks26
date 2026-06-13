import asyncio
import logging
import os
import random
import string
import time
import traceback
from typing import Any, Dict, List, Optional

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    Header,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware as FastAPICORSMiddleware
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

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
        await client.admin.command("ping")
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
    base_version: Optional[int] = None
    actor_id: Optional[str] = None


def _to_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _default_whiteboard_scene() -> Dict[str, Any]:
    return {"elements": [], "files": {}}


def _normalize_scene(scene: Any) -> Dict[str, Any]:
    if not isinstance(scene, dict):
        return _default_whiteboard_scene()

    raw_elements = scene.get("elements", [])
    raw_files = scene.get("files", {})

    elements: List[Dict[str, Any]] = []
    if isinstance(raw_elements, list):
        for element in raw_elements:
            if isinstance(element, dict):
                elements.append(dict(element))

    files = dict(raw_files) if isinstance(raw_files, dict) else {}
    return {"elements": elements, "files": files}


def _element_id(element: Dict[str, Any]) -> Optional[str]:
    element_id = element.get("id")
    return element_id if isinstance(element_id, str) and element_id else None


def _newer_element(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    left_version = _to_int(left.get("version"))
    right_version = _to_int(right.get("version"))
    if right_version != left_version:
        return right if right_version > left_version else left

    left_updated = _to_int(left.get("updated"))
    right_updated = _to_int(right.get("updated"))
    if right_updated != left_updated:
        return right if right_updated > left_updated else left

    left_nonce = _to_int(left.get("versionNonce"))
    right_nonce = _to_int(right.get("versionNonce"))
    if right_nonce != left_nonce:
        return right if right_nonce > left_nonce else left

    left_deleted = bool(left.get("isDeleted"))
    right_deleted = bool(right.get("isDeleted"))
    if right_deleted != left_deleted:
        return right if right_deleted else left

    return right


def merge_whiteboard_scenes(base_scene: Any, incoming_scene: Any) -> Dict[str, Any]:
    normalized_base = _normalize_scene(base_scene)
    normalized_incoming = _normalize_scene(incoming_scene)

    base_elements = normalized_base["elements"]
    incoming_elements = normalized_incoming["elements"]

    winners: Dict[str, Dict[str, Any]] = {}
    base_by_id: Dict[str, Dict[str, Any]] = {}
    incoming_order: List[str] = []
    base_order: List[str] = []

    for element in base_elements:
        element_id = _element_id(element)
        if not element_id:
            continue
        base_by_id[element_id] = element
        base_order.append(element_id)

    for element in incoming_elements:
        element_id = _element_id(element)
        if not element_id:
            continue
        incoming_order.append(element_id)
        if element_id in base_by_id:
            winners[element_id] = _newer_element(base_by_id[element_id], element)
        else:
            winners[element_id] = element

    for element_id, element in base_by_id.items():
        if element_id not in winners:
            winners[element_id] = element

    ordered_ids: List[str] = []
    seen_ids: set[str] = set()
    for element_id in incoming_order + base_order:
        if element_id in winners and element_id not in seen_ids:
            ordered_ids.append(element_id)
            seen_ids.add(element_id)

    for element_id in winners.keys():
        if element_id not in seen_ids:
            ordered_ids.append(element_id)
            seen_ids.add(element_id)

    merged_elements = [winners[element_id] for element_id in ordered_ids]
    merged_files = {**normalized_base["files"], **normalized_incoming["files"]}
    return {"elements": merged_elements, "files": merged_files}


def _clean_text_snippet(value: Any, max_chars: int = 80) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        return ""
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 1].rstrip() + "…"


def _summarize_whiteboard_scene(scene: Any) -> str:
    normalized = _normalize_scene(scene)
    visible_elements = [
        element
        for element in normalized["elements"]
        if isinstance(element, dict) and not bool(element.get("isDeleted"))
    ]

    if not visible_elements:
        return "Whiteboard is currently empty (0 visible elements)."

    type_counts: Dict[str, int] = {}
    text_samples: List[str] = []

    for element in visible_elements:
        element_type = str(element.get("type") or "unknown")
        type_counts[element_type] = type_counts.get(element_type, 0) + 1

        for candidate in (
            element.get("text"),
            element.get("originalText"),
            element.get("label"),
        ):
            snippet = _clean_text_snippet(candidate)
            if snippet:
                text_samples.append(snippet)
                break

    sorted_types = sorted(type_counts.items(), key=lambda entry: (-entry[1], entry[0]))
    type_summary = (
        ", ".join(f"{element_type}:{count}" for element_type, count in sorted_types[:8])
        or "unknown"
    )

    unique_samples: List[str] = []
    seen_samples: set[str] = set()
    for sample in text_samples:
        lowered = sample.lower()
        if lowered in seen_samples:
            continue
        seen_samples.add(lowered)
        unique_samples.append(sample)
        if len(unique_samples) >= 6:
            break

    text_summary = (
        " | ".join(f'"{sample}"' for sample in unique_samples)
        if unique_samples
        else "none"
    )
    return (
        f"Whiteboard has {len(visible_elements)} visible elements. "
        f"Element types: {type_summary}. "
        f"Detected text snippets: {text_summary}."
    )


async def _get_room_whiteboard_scene(
    room_id: str, db_connected: bool
) -> Dict[str, Any]:
    default_scene = _default_whiteboard_scene()
    if db_connected:
        board = await db.whiteboards.find_one({"room_id": room_id}) or {}
        return _normalize_scene(board.get("scene", default_scene))
    room_scene = mock_whiteboards.get(room_id, {})
    return _normalize_scene(room_scene.get("scene", default_scene))


def _is_clear_chat_command(message: str) -> bool:
    normalized = (message or "").strip().lower()
    if not normalized:
        return False
    command = normalized.split()[0]
    return command in {"/clear", "/clear-chat", "/clearchat"}


async def _clear_room_chat_messages(
    room_id: str, requested_by: str = "You"
) -> Dict[str, Any]:
    db_connected = await is_db_connected()
    deleted_count = 0

    if db_connected:
        result = await db.chat_messages.delete_many({"room_id": room_id})
        deleted_count = result.deleted_count

    await manager.broadcast(
        room_id,
        {
            "type": "CHAT_CLEARED",
            "room_id": room_id,
            "requested_by": requested_by,
            "timestamp": datetime.now().isoformat(),
        },
    )
    return {"ok": True, "saved": db_connected, "deleted_count": deleted_count}


# --- WebSocket ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)
        logger.info(
            f"WebSocket connected: room={room_id}, total={len(self.active_connections[room_id])}"
        )

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
            logger.info(
                f"WebSocket received from room={room_id}: {data[:100] if data else 'empty'}"
            )
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(room_id, websocket)


from datetime import datetime

# ... (Models)


class ChatMessage(BaseModel):
    room_id: str
    sender: str
    message: str
    client_nonce: Optional[str] = None
    model: Optional[str] = None


import base64

import google.generativeai as genai

# Initialize Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
DEFAULT_CHAT_MODEL = os.getenv("DEFAULT_GEMINI_MODEL", "gemma-4-31b-it")
SUPPORTED_CHAT_MODELS = [
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
]
CHAT_SYSTEM_INSTRUCTION = (
    "You are HackBuddy AI, a friendly and helpful project board assistant. "
    "Your task is to reply conversationally to the user message in 1 to 3 short sentences. "
    "If they ask for concrete work, suggest actionable next steps. "
    "CRITICAL: Do NOT output any chain-of-thought, thinking process, planning, "
    "role descriptions, or bullet points. Output ONLY the direct response to the user."
)
model = genai.GenerativeModel(DEFAULT_CHAT_MODEL)
chat_model = genai.GenerativeModel(
    DEFAULT_CHAT_MODEL, system_instruction=(CHAT_SYSTEM_INSTRUCTION)
)


def _resolve_chat_model_name(model_name: Optional[str]) -> str:
    import re

    candidate = (model_name or "").strip()
    if not candidate:
        return DEFAULT_CHAT_MODEL
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,63}", candidate):
        return DEFAULT_CHAT_MODEL
    if candidate not in SUPPORTED_CHAT_MODELS:
        return DEFAULT_CHAT_MODEL
    return candidate


def _create_chat_models(model_name: Optional[str]) -> tuple[str, Any, Any]:
    resolved_model = _resolve_chat_model_name(model_name)
    try:
        return (
            resolved_model,
            genai.GenerativeModel(resolved_model),
            genai.GenerativeModel(
                resolved_model, system_instruction=CHAT_SYSTEM_INSTRUCTION
            ),
        )
    except Exception as error:
        logger.warning(f"Could not initialize Gemini model '{resolved_model}': {error}")
        return DEFAULT_CHAT_MODEL, model, chat_model


def _extract_json_object(raw_text: str) -> Optional[Dict[str, Any]]:
    if not raw_text:
        return None

    import json
    import re

    content = raw_text.replace("```json", "").replace("```", "").strip()
    if not content:
        return None

    if not content.startswith("{"):
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            content = match.group(0)

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def _chunk_chat_reply(text: str, max_chars: int = 28) -> List[str]:
    if not text:
        return []

    import re

    tokens = re.findall(r"\S+\s*", text)
    if not tokens:
        return [text]

    chunks: List[str] = []
    current = ""
    for token in tokens:
        if current and len(current) + len(token) > max_chars:
            chunks.append(current)
            current = token
            continue
        current += token
    if current:
        chunks.append(current)
    return chunks or [text]


def _sanitize_chat_reply(raw_text: str, user_message: str = "") -> str:
    import re

    logger.info(f"Sanitizing reply: {raw_text[:50]}...")

    if not raw_text:
        return ""
    normalized_user_message = (
        re.sub(r"\s+", " ", (user_message or "")).strip().strip('"“”')
    )

    text = raw_text.replace("```", "").strip()
    if not text:
        logger.info("Sanitized to empty after removing ```")
        return ""

    if text.lower().startswith("hackbuddy ai:"):
        text = text.split(":", 1)[1].strip()

    blocked_markers = [
        "user says",
        "role:",
        "my role:",
        "constraints:",
        "friendly response needed",
        "no concrete work requested",
        "the user is",
        "chain-of-thought",
        "thinking process",
        "conversational reply",
        "short sentences",
        "output only the direct response",
        "greeting back",
        "asking how i can help",
        "critical:",
    ]
    meta_detected = any(marker in text.lower() for marker in blocked_markers)

    if meta_detected:
        logger.info(f"Meta-talk detected in: {text[:50]}...")
        quoted_candidates = re.findall(r"[\"“](.+?)[\"”]", text)
        for quoted in reversed(quoted_candidates):
            candidate = re.sub(r"\s+", " ", quoted).strip()
            lowered_candidate = candidate.lower()
            if (
                normalized_user_message
                and lowered_candidate == normalized_user_message.lower()
            ):
                continue
            if len(candidate.split()) <= 1 and len(candidate) < 12:
                continue
            if candidate and not any(
                marker in lowered_candidate for marker in blocked_markers
            ):
                return candidate
        pieces = re.split(r"(?:\n+|\s\*\s|\*)", text)
        cleaned_parts: List[str] = []
        for piece in pieces:
            candidate = piece.strip(" \t\r\n-•")
            if not candidate:
                continue
            lowered = candidate.lower()
            if any(marker in lowered for marker in blocked_markers):
                continue
            if re.match(
                r"^(?:\d+[\).]?\s*)?(?:respond|output|suggest|ask|greet|conversation|conversational)\b",
                lowered,
            ):
                continue
            if lowered.startswith("hackbuddy ai:"):
                candidate = candidate.split(":", 1)[1].strip()
            if candidate:
                cleaned_parts.append(candidate)
        if cleaned_parts:
            text = cleaned_parts[-1].strip()

    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        logger.info("Sanitized to empty")
        return ""

    lowered = text.lower()
    if any(marker in lowered for marker in blocked_markers):
        logger.info(f"Blocked marker detected in: {text[:50]}...")
        return ""
    if normalized_user_message and lowered == normalized_user_message.lower():
        logger.info("Message matches user message")
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", text)
    if len(sentences) > 3:
        text = " ".join(sentences[:3]).strip()

    return text


def _safe_chat_fallback(user_message: str, task_title: Optional[str] = None) -> str:
    import re

    if task_title:
        return f'Got it — I created a task for this: "{task_title}".'

    lowered = (user_message or "").strip().lower()
    if re.search(r"\b(hi|hello|hey|yo|yoo|wagwan|what'?s up|sup)\b", lowered):
        return (
            "Hey! I’m here and ready to help. What do you want to tackle on the board?"
        )

    return "Got your message. I can help break this into clear next tasks."


# --- Chat Endpoints ---
@app.get("/api/chat/models")
async def get_chat_models():
    return {"models": SUPPORTED_CHAT_MODELS, "default_model": DEFAULT_CHAT_MODEL}


@app.get("/api/chat/messages/{room_id}")
async def get_chat_messages(room_id: str):
    if not await is_db_connected():
        return {"messages": [], "saved": False}

    messages = (
        await db.chat_messages.find({"room_id": room_id})
        .sort("timestamp", 1)
        .to_list(length=500)
    )
    cleaned_messages: List[Dict[str, Any]] = []
    for message in messages:
        cleaned_messages.append(
            {
                "id": str(message.get("_id")),
                "room_id": message.get("room_id"),
                "sender": message.get("sender", ""),
                "message": message.get("message", ""),
                "timestamp": message.get("timestamp"),
                "client_nonce": message.get("client_nonce"),
                "model": message.get("model"),
                "is_streaming": False,
            }
        )
    return {"messages": cleaned_messages, "saved": True}


@app.post("/api/chat/clear")
async def clear_chat_messages(room_id: str, sender: str = "You"):
    return await _clear_room_chat_messages(room_id, sender)


@app.post("/api/chat/message")
async def send_chat_message(
    chat: ChatMessage,
    x_gemini_api_key: Optional[str] = Header(None),
    x_gemini_model: Optional[str] = Header(None),
):
    if _is_clear_chat_command(chat.message):
        return await _clear_room_chat_messages(chat.room_id, chat.sender)
    custom_key = x_gemini_api_key or os.getenv("GOOGLE_API_KEY")
    if custom_key:
        genai.configure(api_key=custom_key)
    selected_model, intent_model, reply_model = _create_chat_models(
        chat.model or x_gemini_model
    )
    db_connected = await is_db_connected()
    message_dict = chat.model_dump(exclude_none=True)
    message_dict["model"] = selected_model
    message_dict["timestamp"] = datetime.now().isoformat()

    if db_connected:
        result = await db.chat_messages.insert_one(message_dict)
        message_dict["id"] = str(result.inserted_id)
        message_dict.pop("_id", None)
    else:
        message_dict["id"] = f"temp_{int(time.time() * 1000)}"

    # Broadcast chat message even when DB is unavailable.
    await manager.broadcast(
        chat.room_id, {"type": "CHAT_MESSAGE", "message": message_dict}
    )
    await manager.broadcast(chat.room_id, {"type": "CHAT_THINKING", "status": True})

    task_title: Optional[str] = None

    # Unified AI Intent and Reply
    try:
        # Fetch board data
        board_data = await get_board(chat.room_id)

        whiteboard_scene = await _get_room_whiteboard_scene(chat.room_id, db_connected)
        whiteboard_summary = _summarize_whiteboard_scene(whiteboard_scene)

        # Format board/roadmap context for AI
        tasks_summary = "\n".join(
            [
                f"- ID: {t['id']}, Title: {t['title']}, Status: {t['column']}"
                for t in board_data.get("tasks", [])
            ]
        )
        roadmap_content = board_data.get("roadmap", "No roadmap content.")

        prompt = (
            "You are HackBuddy AI, a project board assistant. "
            "You have access to the project board tasks and the roadmap. "
            "Analyze the message and provide a helpful, conversational, and contextually relevant reply. "
            'Return valid JSON: {"tasks": [...], "reply": "...", "roadmap": "..."}. '
            '"tasks" should be a list of ONLY new tasks to create or existing tasks that need updates (must include "id" to update). If no tasks are needed, return an empty list []. '
            '"roadmap" should contain the updated roadmap markdown content if the user requests changes to it, otherwise omit this field. '
            '"reply" MUST be a direct, relevant answer to the user. '
            "If the user asks a question, answer it based on the provided tasks and roadmap. "
            "If the request is unclear, politely ask for clarification. "
            'Do NOT use generic phrases like "I\'ve processed your request" or "Got your message!". '
            "Do NOT include any other text, chain-of-thought, or prompt echoes."
        )

        full_prompt = (
            f"{prompt}\n\n"
            f"--- Context ---\n"
            f"Whiteboard: {whiteboard_summary}\n"
            f"Tasks:\n{tasks_summary}\n"
            f"Roadmap:\n{roadmap_content}\n"
            f"---------------\n"
            f'User message: "{chat.message}"'
        )

        response = await reply_model.generate_content_async(full_prompt)
        result = _extract_json_object(response.text)

        # 1. Handle Tasks
        if result and "tasks" in result and isinstance(result["tasks"], list):
            for task_data in result["tasks"]:
                # Check if it's an update (has id) or create
                if "id" in task_data:
                    # Logic to update existing task
                    task = Task(
                        title=str(task_data.get("title") or "Untitled Task"),
                        description=str(task_data.get("description") or ""),
                        column=str(task_data.get("column") or "Backlog"),
                        assignee=str(task_data.get("assignee") or ""),
                        updated_at=int(time.time() * 1000),
                    )
                    await update_task(chat.room_id, task_data["id"], task)
                else:
                    # Create new task
                    task = Task(
                        title=str(task_data.get("title") or "Untitled Task"),
                        description=str(task_data.get("description") or ""),
                        column=str(task_data.get("column") or "Backlog"),
                        assignee=str(task_data.get("assignee") or ""),
                        created_at=int(time.time() * 1000),
                    )
                    await create_task(chat.room_id, task)

        # 2. Handle Roadmap Update
        if result and "roadmap" in result and isinstance(result["roadmap"], str):
            await update_roadmap(chat.room_id, {"roadmap": result["roadmap"]})

        # 3. Handle Reply
        ai_reply = result.get("reply") if result and isinstance(result, dict) else None
        if not ai_reply:
            ai_reply = "I'm not sure how to answer that, could you rephrase?"
        ai_reply = _sanitize_chat_reply(ai_reply, chat.message)
    except Exception as e:
        logger.warning(f"AI error: {e}")
        ai_reply = (
            "I'm having trouble answering that right now, could you please rephrase?"
        )

    if not ai_reply:
        ai_reply = _safe_chat_fallback(chat.message, task_title)
    ai_object_id = ObjectId() if db_connected else None
    ai_message_id = (
        str(ai_object_id) if ai_object_id else f"temp_ai_{int(time.time() * 1000)}"
    )
    ai_message_dict: Dict[str, Any] = {
        "id": ai_message_id,
        "room_id": chat.room_id,
        "sender": "HackBuddy AI",
        "message": "",
        "timestamp": datetime.now().isoformat(),
        "model": selected_model,
    }

    await manager.broadcast(chat.room_id, {"type": "CHAT_THINKING", "status": False})

    streamed_message = ""
    for chunk in _chunk_chat_reply(ai_reply):
        streamed_message += chunk
        await manager.broadcast(
            chat.room_id,
            {
                "type": "CHAT_MESSAGE",
                "message": {
                    **ai_message_dict,
                    "message": streamed_message,
                    "is_streaming": True,
                },
            },
        )
        await asyncio.sleep(0.035)

    final_ai_message: Dict[str, Any] = {
        **ai_message_dict,
        "message": ai_reply,
        "is_streaming": False,
    }

    if db_connected and ai_object_id is not None:
        db_ai_message = {
            "_id": ai_object_id,
            "room_id": chat.room_id,
            "sender": "HackBuddy AI",
            "message": ai_reply,
            "timestamp": final_ai_message["timestamp"],
            "model": selected_model,
        }
        await db.chat_messages.insert_one(db_ai_message)

    await manager.broadcast(
        chat.room_id, {"type": "CHAT_MESSAGE", "message": final_ai_message}
    )

    return {"ok": True, "saved": db_connected, "model": selected_model}


# --- Kanban Endpoints ---


@app.post("/api/room/create")
async def create_room():
    # Generate a random 4-char alphanumeric string
    room_id = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))

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
            board = {
                "room_id": room_id,
                "columns": ["Backlog", "In Progress", "Done"],
                "tasks": [],
                "roadmap": "",
            }
            await db.boards.insert_one(board)

        tasks = await db.tasks.find(
            {"room_id": room_id, "deleted": {"$ne": True}}
        ).to_list(length=100)
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
        return {
            "columns": board.get("columns", ["Backlog", "In Progress", "Done"]),
            "tasks": clean_tasks,
            "roadmap": board.get("roadmap", ""),
        }
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
                    "git_linked": None,
                }
            ],
            "roadmap": "# Roadmap\n- [ ] Task 1",
        }


@app.put("/api/roadmap/{room_id}")
async def update_roadmap(room_id: str, data: dict):
    if await is_db_connected():
        roadmap = data.get("roadmap", "")
        await db.boards.update_one({"room_id": room_id}, {"$set": {"roadmap": roadmap}})
        return {"ok": True}
    return {"ok": False}


@app.post("/api/task/create")
async def create_task(room_id: str, task: Task):
    if await is_db_connected():
        task_dict = task.model_dump(exclude={"id"}, exclude_none=True)
        task_dict["room_id"] = room_id
        if "created_at" not in task_dict:
            task_dict["created_at"] = int(__import__("time").time() * 1000)
        result = await db.tasks.insert_one(task_dict)
        task_dict["id"] = str(result.inserted_id)
        task_dict.pop("_id", None)
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
        await db.tasks.update_one(
            {"_id": ObjectId(task_id)}, {"$set": {"deleted": True}}
        )
        # Broadcast
        await manager.broadcast(room_id, {"type": "TASK_DELETED", "task_id": task_id})
    return {"ok": True}


# --- Whiteboard Endpoints ---


@app.get("/api/whiteboard/scene/{room_id}")
async def get_whiteboard_scene(room_id: str):
    default_scene = _default_whiteboard_scene()
    now = int(time.time() * 1000)

    if await is_db_connected():
        await db.whiteboards.update_one(
            {"room_id": room_id},
            {
                "$setOnInsert": {
                    "room_id": room_id,
                    "scene": default_scene,
                    "updated_at": now,
                    "scene_version": 0,
                }
            },
            upsert=True,
        )
        board = await db.whiteboards.find_one({"room_id": room_id}) or {}
        return {
            "scene": board.get("scene", default_scene),
            "updated_at": board.get("updated_at", now),
            "scene_version": _to_int(board.get("scene_version", 0)),
        }

    if room_id not in mock_whiteboards:
        mock_whiteboards[room_id] = {
            "scene": default_scene,
            "updated_at": now,
            "scene_version": 0,
        }
    elif "scene_version" not in mock_whiteboards[room_id]:
        mock_whiteboards[room_id]["scene_version"] = 0
    return mock_whiteboards[room_id]


@app.put("/api/whiteboard/scene/{room_id}")
async def save_whiteboard_scene(room_id: str, payload: WhiteboardScenePayload):
    now = int(time.time() * 1000)
    incoming_scene = _normalize_scene(payload.scene)
    saved_scene = incoming_scene
    saved_version = 0
    conflict_resolved = False

    if await is_db_connected():
        await db.whiteboards.update_one(
            {"room_id": room_id},
            {
                "$setOnInsert": {
                    "room_id": room_id,
                    "scene": _default_whiteboard_scene(),
                    "updated_at": now,
                    "scene_version": 0,
                }
            },
            upsert=True,
        )

        for _ in range(6):
            board = await db.whiteboards.find_one({"room_id": room_id}) or {}
            current_scene = board.get("scene", _default_whiteboard_scene())
            current_version = _to_int(board.get("scene_version", 0))
            merged_scene = merge_whiteboard_scenes(current_scene, incoming_scene)
            next_version = current_version + 1

            update_result = await db.whiteboards.update_one(
                {"room_id": room_id, "scene_version": current_version},
                {
                    "$set": {
                        "scene": merged_scene,
                        "updated_at": now,
                        "scene_version": next_version,
                    }
                },
            )

            if update_result.modified_count == 1:
                saved_scene = merged_scene
                saved_version = next_version
                conflict_resolved = (
                    payload.base_version is not None
                    and payload.base_version < current_version
                )
                break
        else:
            raise HTTPException(
                status_code=409, detail="High whiteboard write contention, retry save"
            )
    else:
        existing = mock_whiteboards.get(
            room_id,
            {
                "scene": _default_whiteboard_scene(),
                "updated_at": now,
                "scene_version": 0,
            },
        )
        current_scene = existing.get("scene", _default_whiteboard_scene())
        current_version = _to_int(existing.get("scene_version", 0))
        saved_scene = merge_whiteboard_scenes(current_scene, incoming_scene)
        saved_version = current_version + 1
        conflict_resolved = (
            payload.base_version is not None and payload.base_version < current_version
        )
        mock_whiteboards[room_id] = {
            "scene": saved_scene,
            "updated_at": now,
            "scene_version": saved_version,
        }

    await manager.broadcast(
        room_id,
        {
            "type": "WHITEBOARD_UPDATED",
            "updated_at": now,
            "scene_version": saved_version,
            "actor_id": payload.actor_id,
        },
    )
    return {
        "ok": True,
        "scene": saved_scene,
        "updated_at": now,
        "scene_version": saved_version,
        "conflict_resolved": conflict_resolved,
    }


@app.post("/api/whiteboard/generate")
async def generate_whiteboard(room_id: str, data: dict):
    job = {"room_id": room_id, "status": "processing", "code": None}
    if await is_db_connected():
        result = await db.whiteboard_jobs.insert_one(job)
        return {"job_id": str(result.inserted_id)}
    return {"job_id": "job_wb_mock_001"}


@app.post("/api/whiteboard/analyze")
async def analyze_whiteboard(room_id: str, data: dict):
    if not await is_db_connected():
        return {"ok": False, "error": "Database unavailable"}

    image_b64 = data.get("image_base64")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Missing image_base64")

    # Prepare image for Gemini
    image_data = base64.b64decode(image_b64.split(",")[1])

    try:
        # Use Gemini Vision
        response = await model.generate_content_async(
            [
                "Analyze this whiteboard sketch. Provide brief, actionable feedback or suggestions for improvement.",
                {"mime_type": "image/png", "data": image_data},
            ]
        )

        feedback = response.text

        # Post feedback to chat using the unified chat mechanism
        chat = ChatMessage(
            room_id=room_id, sender="AI Whiteboard Assistant", message=feedback
        )
        await send_chat_message(chat)

        return {"ok": True}
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        raise HTTPException(status_code=500, detail="AI analysis failed")


@app.get("/api/whiteboard/{job_id}")
async def get_whiteboard_job(job_id: str):
    if await is_db_connected():
        job = await db.whiteboard_jobs.find_one({"_id": ObjectId(job_id)})
        if job:
            return {
                "status": job["status"],
                "code": job.get("code"),
                "framework": job.get("framework"),
            }
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status": "completed",
        "code": "export default function GeneratedLayout() { return <div>Mock Code</div> }",
        "framework": "react",
    }


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
        await db.rooms.update_one(
            {"room_id": room_id}, {"$set": {"git_connected": True}}, upsert=True
        )
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
