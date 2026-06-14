import asyncio
import json
import logging
import os
import random
import re
import string
import time
import traceback
import uuid
from typing import Any, Dict, List, Optional
import requests

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import (FastAPI, HTTPException, Header, Request, WebSocket,
                     WebSocketDisconnect)
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
mock_whiteboard_jobs: Dict[str, Dict[str, Any]] = {}
mock_profiles: Dict[str, Dict[str, Dict[str, Any]]] = {}


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


class WhiteboardGeneratePayload(BaseModel):
    image_base64: str
    framework: Optional[str] = "react"


class UserProfilePayload(BaseModel):
    room_id: str
    name: str
    skills: List[str] = Field(default_factory=list)
    interest: str
    vibe: str


class UserProfileIdeasPayload(BaseModel):
    room_id: str
    name: str
    skills: List[str] = Field(default_factory=list)
    interest: str
    vibe: str
    count: Optional[int] = 5


class DiscordTeam8sPayload(BaseModel):
    room_id: str
    name: str
    skills: List[str] = Field(default_factory=list)
    interest: str
    vibe: str
    discord_username: Optional[str] = None
    discord_handle: Optional[str] = None
    looking_for: Optional[str] = None
    availability: Optional[str] = None
    webhook_url: Optional[str] = None


class MatchmakingEnrollPayload(BaseModel):
    hackathon_id: str = "default"
    name: str
    skills: List[str] = Field(default_factory=list)
    interest: str
    vibe: str
    discord_username: Optional[str] = None


class MatchmakingInvitePayload(BaseModel):
    invitee_username: str


class MatchmakingInviteDecisionPayload(BaseModel):
    invite_id: str
    accept: bool


class SignupPayload(BaseModel):
    username: str
    password: str
    hackathon_id: str = "default"
    skills: List[str] = Field(default_factory=list)
    interest: str
    vibe: str
    discord_username: Optional[str] = None


class LoginPayload(BaseModel):
    username: str
    password: str


class JoinTeamByCodePayload(BaseModel):
    invite_code: str


class JoinRoomPayload(BaseModel):
    room_id: str


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


def _decode_image_payload(
    image_base64: Any, fallback_mime_type: str = "image/png"
) -> tuple[bytes, str]:
    if not isinstance(image_base64, str) or not image_base64.strip():
        raise ValueError("Missing image_base64")

    payload = image_base64.strip()
    mime_type = fallback_mime_type
    base64_body = payload

    if payload.startswith("data:"):
        header, separator, body = payload.partition(",")
        if not separator or not body.strip():
            raise ValueError("Invalid data URL for image_base64")
        base64_body = body.strip()
        header_match = re.match(
            r"^data:(?P<mime>[-\w.+/]+);base64$", header.strip(), re.IGNORECASE
        )
        if header_match:
            mime_type = header_match.group("mime")

    normalized_base64 = re.sub(r"\s+", "", base64_body)
    padding = "=" * (-len(normalized_base64) % 4)
    try:
        decoded = base64.b64decode(normalized_base64 + padding)
    except Exception as error:
        raise ValueError("Invalid base64 image payload") from error

    if not decoded:
        raise ValueError("Image payload was empty after decoding")

    return decoded, mime_type


def _strip_markdown_code_fences(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        return ""
    if text.startswith("```"):
        text = re.sub(r"^```[A-Za-z0-9_.+-]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _normalize_framework_name(framework: Optional[str]) -> str:
    candidate = (framework or "react").strip().lower()
    if not candidate:
        return "react"
    if not re.fullmatch(r"[a-z0-9._-]{2,24}", candidate):
        return "react"
    return candidate


def _build_whiteboard_generation_prompt(framework: str) -> str:
    return (
        f"You are a senior {framework} engineer. Convert this whiteboard image into working starter code.\n"
        "Focus on the sketched structure, hierarchy, and visible labels. If the image contains symbols "
        "(like smiley faces, arrows, icons, or notes), preserve that intent as small UI details or comments.\n"
        "Return only code for a single file with no markdown fences and no extra commentary.\n"
        "If the sketch is ambiguous, make pragmatic assumptions and include brief TODO comments for unclear parts."
    )

def _normalize_skill_list(skills: List[str]) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()
    for raw_skill in skills:
        cleaned = " ".join(str(raw_skill or "").split()).strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(cleaned)
    return normalized


def _build_profile_summary(profile: Dict[str, Any]) -> str:
    name = str(profile.get("name") or "").strip() or "Unknown"
    interest = str(profile.get("interest") or "").strip() or "Not specified"
    vibe = str(profile.get("vibe") or "").strip() or "Not specified"
    skills = profile.get("skills") or []
    normalized_skills = _normalize_skill_list(skills if isinstance(skills, list) else [])
    skills_text = ", ".join(normalized_skills) if normalized_skills else "Not specified"
    return f"Name: {name}. Skills: {skills_text}. Interest: {interest}. Vibe: {vibe}."


async def _upsert_profile_record(
    room_id: str,
    name: str,
    skills: List[str],
    interest: str,
    vibe: str,
) -> Dict[str, Any]:
    cleaned_name = " ".join(name.split()).strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Name is required")
    cleaned_interest = " ".join((interest or "").split()).strip()
    if not cleaned_interest:
        raise HTTPException(status_code=400, detail="Interest is required")
    cleaned_vibe = " ".join((vibe or "").split()).strip()
    if not cleaned_vibe:
        raise HTTPException(status_code=400, detail="Vibe is required")
    normalized_skills = _normalize_skill_list(skills)
    now = int(time.time() * 1000)
    profile_doc = {
        "room_id": room_id,
        "name": cleaned_name,
        "skills": normalized_skills,
        "interest": cleaned_interest,
        "vibe": cleaned_vibe,
        "updated_at": now,
    }
    if await is_db_connected():
        await db.user_profiles.update_one(
            {"room_id": room_id, "name": cleaned_name},
            {"$set": profile_doc},
            upsert=True,
        )
    if room_id not in mock_profiles:
        mock_profiles[room_id] = {}
    mock_profiles[room_id][cleaned_name.lower()] = profile_doc
    return profile_doc


async def _get_room_members(room_id: str) -> List[Dict[str, Any]]:
    if await is_db_connected():
        members = (
            await db.user_profiles.find({"room_id": room_id})
            .sort("updated_at", -1)
            .to_list(length=200)
        )
        cleaned_members: List[Dict[str, Any]] = []
        seen_names: set[str] = set()
        for member in members:
            member_name = str(member.get("name", "")).strip()
            if not member_name:
                continue
            normalized_name = member_name.lower()
            if normalized_name in seen_names:
                continue
            seen_names.add(normalized_name)
            cleaned_members.append(
                {
                    "room_id": room_id,
                    "name": member_name,
                    "skills": member.get("skills", []),
                    "interest": member.get("interest", ""),
                    "vibe": member.get("vibe", ""),
                    "updated_at": member.get("updated_at"),
                }
            )
        return cleaned_members
    members_map = mock_profiles.get(room_id, {})
    return sorted(
        members_map.values(),
        key=lambda member: int(member.get("updated_at") or 0),
        reverse=True,
    )


async def _get_room_profile(
    room_id: str, preferred_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    members = await _get_room_members(room_id)
    if not members:
        return None
    if preferred_name:
        normalized_preferred = preferred_name.strip().lower()
        for member in members:
            if str(member.get("name", "")).strip().lower() == normalized_preferred:
                return member
    return members[0]


def _normalize_assignee_name(candidate_name: Any, member_names: List[str]) -> Optional[str]:
    candidate = str(candidate_name or "").strip()
    if not candidate:
        return None
    lowered_candidate = candidate.lower()
    for member_name in member_names:
        if member_name.lower() == lowered_candidate:
            return member_name
    for member_name in member_names:
        lowered_member = member_name.lower()
        if lowered_candidate in lowered_member or lowered_member in lowered_candidate:
            return member_name
    return None


def _normalize_hackathon_id(raw_hackathon_id: Optional[str]) -> str:
    candidate = (raw_hackathon_id or "default").strip().lower()
    if not candidate:
        return "default"
    return re.sub(r"[^a-z0-9_-]+", "-", candidate)[:64] or "default"


def _normalize_username(raw_username: Optional[str]) -> str:
    candidate = " ".join((raw_username or "").split()).strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="username is required")
    return candidate


def _hash_password(raw_password: str) -> str:
    import hashlib

    return hashlib.sha256((raw_password or "").encode("utf-8")).hexdigest()


def _new_session_token() -> str:
    return f"sess_{uuid.uuid4().hex}"


async def _resolve_auth_user(token: Optional[str]) -> Dict[str, Any]:
    session_token = (token or "").strip()
    if not session_token:
        raise HTTPException(status_code=401, detail="Missing auth token")
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Auth requires database connectivity")
    session_doc = await db.auth_sessions.find_one({"token": session_token})
    if not session_doc:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    user = await db.users.find_one({"username": session_doc.get("username")})
    if not user:
        raise HTTPException(status_code=401, detail="User not found for session")
    return user


async def _load_team_for_user(user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    team_id = user.get("team_id")
    if not team_id:
        return None
    if not await is_db_connected():
        return None
    return await db.teams.find_one({"team_id": team_id})


def _new_room_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=4))


def _new_team_id() -> str:
    return f"team_{uuid.uuid4().hex[:10]}"


def _new_team_invite_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _new_match_invite_id() -> str:
    return f"invite_{uuid.uuid4().hex[:12]}"


def _normalize_member_names(raw_names: List[Any]) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()
    for raw_name in raw_names:
        cleaned = " ".join(str(raw_name or "").split()).strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(cleaned)
    return normalized


def _participant_summary(participant: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "username": str(participant.get("name") or "").strip(),
        "skills": participant.get("skills", []),
        "interest": str(participant.get("interest") or "").strip(),
        "vibe": str(participant.get("vibe") or "").strip(),
        "discord_username": str(participant.get("discord_username") or "").strip(),
        "team_id": participant.get("team_id"),
    }


async def _upsert_match_participant_from_user(
    user: Dict[str, Any], *, status: Optional[str] = None
) -> None:
    if not await is_db_connected():
        return
    username = str(user.get("username") or "").strip()
    if not username:
        return
    next_status = status or ("in_room" if user.get("room_id") else "searching")
    now = int(time.time() * 1000)
    await db.match_participants.update_one(
        {
            "hackathon_id": _normalize_hackathon_id(user.get("hackathon_id") or "default"),
            "name": username,
        },
        {
            "$set": {
                "hackathon_id": _normalize_hackathon_id(user.get("hackathon_id") or "default"),
                "name": username,
                "skills": _normalize_skill_list(user.get("skills", [])),
                "interest": " ".join(str(user.get("interest") or "").split()).strip(),
                "vibe": " ".join(str(user.get("vibe") or "").split()).strip(),
                "discord_username": " ".join(
                    str(user.get("discord_username") or "").split()
                ).strip(),
                "team_id": user.get("team_id"),
                "room_id": user.get("room_id"),
                "status": next_status,
                "updated_at": now,
            }
        },
        upsert=True,
    )


async def _ensure_team_for_user(user: Dict[str, Any]) -> Dict[str, Any]:
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Teammaking requires database connectivity")
    username = str(user.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Invalid user")
    existing_team = await _load_team_for_user(user)
    if existing_team:
        member_names = _normalize_member_names(existing_team.get("member_names", []))
        if username not in member_names:
            member_names.append(username)
        invite_code = str(existing_team.get("invite_code") or "").strip().upper() or _new_team_invite_code()
        updated_team = {
            **existing_team,
            "member_names": member_names,
            "invite_code": invite_code,
        }
        await db.teams.update_one(
            {"team_id": existing_team.get("team_id")},
            {
                "$set": {
                    "member_names": member_names,
                    "invite_code": invite_code,
                    "updated_at": int(time.time() * 1000),
                }
            },
            upsert=True,
        )
        return updated_team

    team_doc = {
        "team_id": _new_team_id(),
        "hackathon_id": _normalize_hackathon_id(user.get("hackathon_id") or "default"),
        "member_names": [username],
        "invite_code": _new_team_invite_code(),
        "room_id": None,
        "status": "forming",
        "created_at": int(time.time() * 1000),
        "updated_at": int(time.time() * 1000),
    }
    await db.teams.insert_one(team_doc)
    await db.users.update_one(
        {"username": username},
        {
            "$set": {
                "team_id": team_doc["team_id"],
                "invite_code": team_doc["invite_code"],
                "updated_at": int(time.time() * 1000),
            }
        },
    )
    return team_doc


async def _load_team_member_profiles(
    team_doc: Optional[Dict[str, Any]], current_username: str
) -> List[Dict[str, Any]]:
    if not team_doc or not await is_db_connected():
        return []
    member_names = _normalize_member_names(team_doc.get("member_names", []))
    if not member_names:
        return []
    users = await db.users.find({"username": {"$in": member_names}}).to_list(length=25)
    by_name = {str(user.get("username") or "").strip(): user for user in users}
    summaries: List[Dict[str, Any]] = []
    for member_name in member_names:
        if member_name == current_username:
            continue
        user_doc = by_name.get(member_name, {})
        summaries.append(
            {
                "username": member_name,
                "skills": user_doc.get("skills", []),
                "interest": user_doc.get("interest", ""),
                "vibe": user_doc.get("vibe", ""),
                "discord_username": user_doc.get("discord_username", ""),
            }
        )
    return summaries


async def _mark_team_in_room(
    team_doc: Dict[str, Any], room_id: str, invite_code: str
) -> None:
    if not await is_db_connected():
        return
    member_names = _normalize_member_names(team_doc.get("member_names", []))
    if not member_names:
        return
    now = int(time.time() * 1000)
    team_id = team_doc.get("team_id")
    hackathon_id = _normalize_hackathon_id(team_doc.get("hackathon_id") or "default")
    await db.teams.update_one(
        {"team_id": team_id},
        {
            "$set": {
                "room_id": room_id,
                "status": "active",
                "invite_code": invite_code,
                "updated_at": now,
            }
        },
    )
    await db.rooms.update_one(
        {"room_id": room_id},
        {
            "$setOnInsert": {
                "room_id": room_id,
                "created_at": "now",
                "team_id": team_id,
            }
        },
        upsert=True,
    )
    await db.users.update_many(
        {"username": {"$in": member_names}},
        {
            "$set": {
                "team_id": team_id,
                "room_id": room_id,
                "invite_code": invite_code,
                "looking_for_team": False,
                "updated_at": now,
            }
        },
    )
    await db.match_participants.update_many(
        {"hackathon_id": hackathon_id, "name": {"$in": member_names}},
        {
            "$set": {
                "team_id": team_id,
                "room_id": room_id,
                "status": "in_room",
                "updated_at": now,
            }
        },
        upsert=False,
    )
    await db.match_invites.update_many(
        {
            "hackathon_id": hackathon_id,
            "status": "pending",
            "$or": [
                {"inviter_name": {"$in": member_names}},
                {"invitee_name": {"$in": member_names}},
            ],
        },
        {"$set": {"status": "cancelled", "updated_at": now}},
    )


def _new_mock_whiteboard_job_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"job_wb_{int(time.time() * 1000)}_{suffix}"


async def _set_whiteboard_job_state(
    job_id: str, persist_to_db: bool, **fields: Any
) -> None:
    update_fields = {**fields, "updated_at": int(time.time() * 1000)}
    if persist_to_db:
        try:
            await db.whiteboard_jobs.update_one(
                {"_id": ObjectId(job_id)}, {"$set": update_fields}
            )
            return
        except Exception as error:
            logger.warning(f"Failed to persist whiteboard job update in DB: {error}")

    if job_id in mock_whiteboard_jobs:
        mock_whiteboard_jobs[job_id].update(update_fields)


async def _run_whiteboard_generation_job(
    *,
    job_id: str,
    room_id: str,
    framework: str,
    image_data: bytes,
    image_mime_type: str,
    persist_to_db: bool,
) -> None:
    try:
        whiteboard_generation_model, _ = _create_whiteboard_models()
        response = await whiteboard_generation_model.generate_content_async(
            [
                _build_whiteboard_generation_prompt(framework),
                {"mime_type": image_mime_type, "data": image_data},
            ]
        )
        generated_code = _strip_markdown_code_fences(response.text)
        if not generated_code:
            raise ValueError("Model returned empty code output")

        await _set_whiteboard_job_state(
            job_id,
            persist_to_db,
            status="completed",
            code=generated_code,
            framework=framework,
            error=None,
        )
        await manager.broadcast(
            room_id,
            {
                "type": "WHITEBOARD_JOB_UPDATED",
                "job_id": job_id,
                "status": "completed",
            },
        )
    except Exception as error:
        logger.error(f"Whiteboard code generation failed for {job_id}: {error}")
        await _set_whiteboard_job_state(
            job_id,
            persist_to_db,
            status="error",
            error=str(error),
        )
        await manager.broadcast(
            room_id,
            {
                "type": "WHITEBOARD_JOB_UPDATED",
                "job_id": job_id,
                "status": "error",
            },
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


def _is_whiteboard_code_request(message: str) -> bool:
    lowered = (message or "").strip().lower()
    if not lowered:
        return False
    code_markers = [
        "turn this into html",
        "convert this to html",
        "can you turn this",
        "make code",
        "generate code",
        "boilerplate",
        "convert this webpage",
        "build this ui",
        "code for this",
        "html code",
        "css code",
        "react code",
    ]
    return any(marker in lowered for marker in code_markers)


def _infer_code_target(message: str) -> str:
    lowered = (message or "").strip().lower()
    if "html" in lowered:
        return "html"
    if "react" in lowered or "tsx" in lowered or "jsx" in lowered:
        return "react"
    if "css" in lowered:
        return "css"
    return "html"


def _build_whiteboard_chat_code_prompt(
    *,
    target: str,
    user_message: str,
    whiteboard_summary: str,
) -> str:
    return (
        f"You are a senior frontend engineer. The user asked: \"{user_message}\".\n"
        f"Whiteboard scene summary: {whiteboard_summary}\n"
        f"Generate simple, clean {target} code from the attached whiteboard sketch.\n"
        "Requirements:\n"
        "- Keep it concise and beginner-friendly.\n"
        "- Preserve visible structure and labels from the sketch.\n"
        "- If there is a visible symbol (e.g. smiley), include an equivalent UI detail.\n"
        "- Return only code with no markdown fences and no extra explanation."
    )


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
    whiteboard_image_base64: Optional[str] = None
    whiteboard_image_mime_type: Optional[str] = None


import base64

import google.generativeai as genai

# Initialize Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
DEFAULT_CHAT_MODEL = os.getenv("DEFAULT_GEMINI_MODEL", "gemma-4-31b-it")
WHITEBOARD_VISION_MODEL = os.getenv("WHITEBOARD_VISION_MODEL", "gemini-2.5-flash")
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


def _create_whiteboard_models() -> tuple[Any, Any]:
    try:
        return (
            genai.GenerativeModel(WHITEBOARD_VISION_MODEL),
            genai.GenerativeModel(
                WHITEBOARD_VISION_MODEL, system_instruction=(CHAT_SYSTEM_INSTRUCTION)
            ),
        )
    except Exception as error:
        logger.warning(
            f"Could not initialize whiteboard model '{WHITEBOARD_VISION_MODEL}': {error}"
        )
        return model, chat_model


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
    selected_model, _intent_model, reply_model = _create_chat_models(
        chat.model or x_gemini_model
    )
    db_connected = await is_db_connected()
    message_dict = chat.model_dump(
        exclude_none=True,
        exclude={"whiteboard_image_base64", "whiteboard_image_mime_type"},
    )
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
    ai_model_used = selected_model

    # Unified AI Intent and Reply
    try:
        whiteboard_image_part: Optional[Dict[str, Any]] = None
        whiteboard_image_hint = "No whiteboard image attachment was provided."
        if chat.whiteboard_image_base64:
            try:
                image_data, detected_mime_type = _decode_image_payload(
                    chat.whiteboard_image_base64,
                    chat.whiteboard_image_mime_type or "image/png",
                )
                whiteboard_image_part = {
                    "mime_type": detected_mime_type,
                    "data": image_data,
                }
                whiteboard_image_hint = (
                    "A current whiteboard snapshot image is attached. Use it to infer "
                    "layout structure, visual intent, and symbols (including smiley-like doodles)."
                )
            except ValueError as decode_error:
                logger.warning(f"Skipping invalid whiteboard image payload: {decode_error}")

        whiteboard_scene = await _get_room_whiteboard_scene(chat.room_id, db_connected)
        whiteboard_summary = _summarize_whiteboard_scene(whiteboard_scene)
        if _is_whiteboard_code_request(chat.message):
            target = _infer_code_target(chat.message)
            if whiteboard_image_part:
                whiteboard_generation_model, _ = _create_whiteboard_models()
                response = await whiteboard_generation_model.generate_content_async(
                    [
                        _build_whiteboard_chat_code_prompt(
                            target=target,
                            user_message=chat.message,
                            whiteboard_summary=whiteboard_summary,
                        ),
                        whiteboard_image_part,
                    ]
                )
                ai_model_used = WHITEBOARD_VISION_MODEL
            else:
                fallback_prompt = (
                    f'User message: "{chat.message}"\n'
                    f"Whiteboard summary: {whiteboard_summary}\n"
                    f"Generate simple {target} code. Return only code and no explanation."
                )
                response = await reply_model.generate_content_async(fallback_prompt)
            ai_reply = _strip_markdown_code_fences(response.text)
            if not ai_reply:
                ai_reply = (
                    "I couldn't generate code from the sketch yet. Try adding clearer labels "
                    "to the whiteboard and ask again."
                )
        else:
            # Fetch board data for task/roadmap-aware chat responses.
            board_data = await get_board(chat.room_id)
            tasks_summary = "\n".join(
                [
                    f"- ID: {t['id']}, Title: {t['title']}, Status: {t['column']}"
                    for t in board_data.get("tasks", [])
                ]
            )
            roadmap_content = board_data.get("roadmap", "No roadmap content.")
            room_members = await _get_room_members(chat.room_id)
            profile = await _get_room_profile(chat.room_id, chat.sender)
            profile_summary = (
                _build_profile_summary(profile)
                if profile
                else "No onboarding profile has been provided yet."
            )
            member_names = [
                str(member.get("name", "")).strip()
                for member in room_members
                if str(member.get("name", "")).strip()
            ]
            member_summary = ", ".join(member_names) if member_names else "No known members yet."

            prompt = (
                "You are HackBuddy AI, a project board assistant. "
                "You have access to the project board tasks and the roadmap. "
                "Analyze the message and provide a helpful, conversational, and contextually relevant reply. "
                'Return valid JSON: {"tasks": [...], "reply": "...", "roadmap": {"vision": "...", "phases": {"Phase Name": ["task_id_1"]}}}. '
                '"tasks" should be a list of ONLY new tasks to create or existing tasks that need updates (must include "id" to update). If no tasks are needed, return an empty list []. '
                '"roadmap" must be a JSON object with "vision" (a comprehensive Markdown document explaining the project in detail) and "phases" (dictionary mapping phase names to arrays of task IDs). '
                'Example: {"vision": "# Project Title\\n\\n## Vision\\n...detailed project description...", "phases": {"Phase 1": ["t_1"], "Phase 2": ["t_2"]}}. '
                'Only return this if changes are explicitly requested. If a task ID exists in board tasks but is NOT in any phase, it is "Unassigned". '
                '"reply" MUST be a direct, relevant answer to the user. '
                'When setting "assignee" for tasks, use ONLY names from the provided team member list. '
                "If the user asks a question, answer it based on the provided tasks and roadmap. "
                "If a whiteboard image is attached, treat the visual sketch as primary context for UI ideas and symbols. "
                "If the request is unclear, politely ask for clarification. "
                'Do NOT use generic phrases like "I\'ve processed your request" or "Got your message!". '
                "Do NOT include any other text, chain-of-thought, or prompt echoes."
            )

            full_prompt = (
                f"{prompt}\n\n"
                f"--- Context ---\n"
                f"User profile: {profile_summary}\n"
                f"Team members (valid assignees): {member_summary}\n"
                f"Whiteboard: {whiteboard_summary}\n"
                f"Whiteboard image context: {whiteboard_image_hint}\n"
                f"Tasks:\n{tasks_summary}\n"
                f"Roadmap:\n{roadmap_content}\n"
                f"---------------\n"
                f'User message: "{chat.message}"'
            )
            generation_payload: Any = full_prompt
            if whiteboard_image_part:
                generation_payload = [full_prompt, whiteboard_image_part]

            try:
                response = await reply_model.generate_content_async(generation_payload)
            except Exception as multimodal_error:
                if not whiteboard_image_part:
                    raise
                logger.warning(
                    f"Primary chat model could not use whiteboard image, retrying with vision model: {multimodal_error}"
                )
                _, whiteboard_reply_model = _create_whiteboard_models()
                response = await whiteboard_reply_model.generate_content_async(
                    generation_payload
                )
                ai_model_used = WHITEBOARD_VISION_MODEL

            result = _extract_json_object(response.text)

            # 1. Handle Tasks
            if result and "tasks" in result and isinstance(result["tasks"], list):
                member_names_for_assignment = [
                    str(member.get("name", "")).strip()
                    for member in room_members
                    if str(member.get("name", "")).strip()
                ]
                for task_data in result["tasks"]:
                    normalized_assignee = _normalize_assignee_name(
                        task_data.get("assignee"), member_names_for_assignment
                    )
                    # Check if it's an update (has id) or create
                    if "id" in task_data:
                        # Logic to update existing task
                        task = Task(
                            title=str(task_data.get("title") or "Untitled Task"),
                            description=str(task_data.get("description") or ""),
                            column=str(task_data.get("column") or "Backlog"),
                            assignee=normalized_assignee or "",
                            updated_at=int(time.time() * 1000),
                        )
                        await update_task(chat.room_id, task_data["id"], task)
                    else:
                        # Create new task
                        task = Task(
                            title=str(task_data.get("title") or "Untitled Task"),
                            description=str(task_data.get("description") or ""),
                            column=str(task_data.get("column") or "Backlog"),
                            assignee=normalized_assignee or "",
                            created_at=int(time.time() * 1000),
                        )
                        await create_task(chat.room_id, task)

            # 2. Handle Roadmap Update
            if result and "roadmap" in result and isinstance(result["roadmap"], dict):
                await update_roadmap(chat.room_id, {"roadmap": json.dumps(result["roadmap"])})

            # 3. Handle Reply
            ai_reply = result.get("reply") if result and isinstance(result, dict) else None
            if not ai_reply:
                ai_reply = _strip_markdown_code_fences(response.text)
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
        "model": ai_model_used if "ai_model_used" in locals() else selected_model,
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
            "model": final_ai_message["model"],
        }
        await db.chat_messages.insert_one(db_ai_message)

    await manager.broadcast(
        chat.room_id, {"type": "CHAT_MESSAGE", "message": final_ai_message}
    )
    return {"ok": True, "saved": db_connected, "model": final_ai_message["model"]}

@app.post("/api/profile/upsert")
async def upsert_profile(payload: UserProfilePayload):
    profile_doc = await _upsert_profile_record(
        room_id=payload.room_id,
        name=payload.name,
        skills=payload.skills,
        interest=payload.interest,
        vibe=payload.vibe,
    )
    return {"ok": True, "profile": profile_doc}


@app.get("/api/profile/{room_id}")
async def get_profile(room_id: str, name: Optional[str] = None):
    return {"profile": await _get_room_profile(room_id, name)}


@app.get("/api/profile/members/{room_id}")
async def get_profile_members(room_id: str):
    return {"members": await _get_room_members(room_id)}

def _serialize_auth_user(
    user: Dict[str, Any], team: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    return {
        "username": user.get("username"),
        "hackathon_id": user.get("hackathon_id") or "default",
        "looking_for_team": bool(user.get("looking_for_team", True)),
        "skills": user.get("skills", []),
        "interest": user.get("interest", ""),
        "vibe": user.get("vibe", ""),
        "discord_username": user.get("discord_username", ""),
        "room_id": user.get("room_id"),
        "team_id": user.get("team_id"),
        "invite_code": user.get("invite_code") or (team or {}).get("invite_code"),
    }


@app.post("/api/auth/signup")
async def signup(payload: SignupPayload):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Signup requires database connectivity")
    username = _normalize_username(payload.username)
    if len((payload.password or "").strip()) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    existing_user = await db.users.find_one({"username": username})
    if existing_user:
        raise HTTPException(status_code=409, detail="Username already exists")
    normalized_hackathon_id = _normalize_hackathon_id(payload.hackathon_id)
    normalized_vibe = " ".join((payload.vibe or "").split()).strip()
    if not normalized_vibe:
        raise HTTPException(status_code=400, detail="vibe is required for teammaking signup")
    password_hash = _hash_password(payload.password)
    user_doc = {
        "username": username,
        "password_hash": password_hash,
        "hackathon_id": normalized_hackathon_id,
        "looking_for_team": True,
        "skills": _normalize_skill_list(payload.skills),
        "interest": " ".join((payload.interest or "").split()).strip(),
        "vibe": normalized_vibe,
        "discord_username": " ".join((payload.discord_username or "").split()).strip(),
        "team_id": None,
        "room_id": None,
        "invite_code": None,
        "created_at": int(time.time() * 1000),
        "updated_at": int(time.time() * 1000),
    }
    await db.users.insert_one(user_doc)
    session_token = _new_session_token()
    await db.auth_sessions.insert_one(
        {
            "token": session_token,
            "username": username,
            "created_at": int(time.time() * 1000),
        }
    )
    await _upsert_match_participant_from_user(user_doc, status="searching")
    return {
        "ok": True,
        "token": session_token,
        "user": _serialize_auth_user(user_doc),
        "message": "Account created for teammaking. Invite teammates from the teammaking screen.",
    }


@app.post("/api/auth/login")
async def login(payload: LoginPayload):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Login requires database connectivity")
    username = _normalize_username(payload.username)
    user = await db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("password_hash") != _hash_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    session_token = _new_session_token()
    await db.auth_sessions.insert_one(
        {
            "token": session_token,
            "username": username,
            "created_at": int(time.time() * 1000),
        }
    )
    if not user.get("room_id") and bool(user.get("looking_for_team", True)):
        await _upsert_match_participant_from_user(user, status="searching")
    return {
        "ok": True,
        "token": session_token,
        "user": _serialize_auth_user(user),
    }


@app.get("/api/auth/me")
async def auth_me(x_auth_token: Optional[str] = Header(None)):
    user = await _resolve_auth_user(x_auth_token)
    team = await _load_team_for_user(user)
    if not user.get("room_id") and bool(user.get("looking_for_team", True)):
        await _upsert_match_participant_from_user(user, status="searching")
    return {
        "ok": True,
        "user": _serialize_auth_user(user, team),
    }


@app.get("/api/team/invite-code")
async def get_invite_code(x_auth_token: Optional[str] = Header(None)):
    user = await _resolve_auth_user(x_auth_token)
    team = await _load_team_for_user(user)
    if not team:
        return {"ok": False, "error": "No team yet. Matchmaking must complete first."}
    return {"ok": True, "invite_code": team.get("invite_code"), "room_id": team.get("room_id")}


@app.post("/api/team/join-by-code")
async def join_team_by_code(payload: JoinTeamByCodePayload, x_auth_token: Optional[str] = Header(None)):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Joining team requires database connectivity")
    user = await _resolve_auth_user(x_auth_token)
    invite_code = (payload.invite_code or "").strip().upper()
    if not invite_code:
        raise HTTPException(status_code=400, detail="invite_code is required")
    team = await db.teams.find_one({"invite_code": invite_code})
    if not team:
        raise HTTPException(status_code=404, detail="Invite code not found")
    username = str(user.get("username") or "").strip()
    if user.get("team_id") and user.get("team_id") != team.get("team_id"):
        raise HTTPException(
            status_code=409,
            detail="You are already in another team. Leave that team first.",
        )
    member_names = _normalize_member_names(team.get("member_names", []))
    if username not in member_names:
        member_names.append(username)
    team_room_id = team.get("room_id")
    next_status = "active" if team_room_id else "forming"
    await db.teams.update_one(
        {"team_id": team.get("team_id")},
        {
            "$set": {
                "member_names": member_names,
                "status": next_status,
                "updated_at": int(time.time() * 1000),
            }
        },
    )
    await db.users.update_one(
        {"username": username},
        {
            "$set": {
                "team_id": team.get("team_id"),
                "room_id": team_room_id,
                "invite_code": invite_code,
                "hackathon_id": team.get("hackathon_id") or user.get("hackathon_id"),
                "looking_for_team": not bool(team_room_id),
                "updated_at": int(time.time() * 1000),
            }
        },
    )
    latest_user = await db.users.find_one({"username": username}) or user
    await _upsert_match_participant_from_user(
        latest_user, status="in_room" if team_room_id else "searching"
    )
    if team_room_id:
        await _mark_team_in_room(
            {**team, "member_names": member_names},
            str(team_room_id),
            invite_code,
        )
    return {
        "ok": True,
        "room_id": team_room_id,
        "team_id": team.get("team_id"),
        "invite_code": invite_code,
        "in_room": bool(team_room_id),
    }

@app.post("/api/matchmaking/enroll")
async def enroll_matchmaking(
    payload: MatchmakingEnrollPayload, x_auth_token: Optional[str] = Header(None)
):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Matchmaking requires database connectivity")
    user = await _resolve_auth_user(x_auth_token)
    if user.get("room_id"):
        raise HTTPException(
            status_code=409,
            detail="You are already in a room and cannot join teammaking.",
        )
    username = str(user.get("username") or "").strip()
    if payload.name and _normalize_username(payload.name) != username:
        raise HTTPException(status_code=400, detail="Name must match your signed-in account")
    hackathon_id = _normalize_hackathon_id(payload.hackathon_id)
    updated_fields = {
        "hackathon_id": hackathon_id,
        "skills": _normalize_skill_list(payload.skills),
        "interest": " ".join((payload.interest or "").split()).strip(),
        "vibe": " ".join((payload.vibe or "").split()).strip(),
        "discord_username": " ".join((payload.discord_username or "").split()).strip(),
        "looking_for_team": True,
        "updated_at": int(time.time() * 1000),
    }
    if not updated_fields["interest"] or not updated_fields["vibe"]:
        raise HTTPException(
            status_code=400,
            detail="Interest and vibe are required for teammaking.",
        )
    await db.users.update_one({"username": username}, {"$set": updated_fields})
    latest_user = await db.users.find_one({"username": username}) or {**user, **updated_fields}
    await _upsert_match_participant_from_user(latest_user, status="searching")
    return {
        "ok": True,
        "message": "You are now visible in teammaking.",
        "hackathon_id": hackathon_id,
    }

@app.get("/api/matchmaking/status")
async def get_matchmaking_status(x_auth_token: Optional[str] = Header(None)):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Matchmaking requires database connectivity")
    user = await _resolve_auth_user(x_auth_token)
    username = str(user.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Invalid user")
    normalized_hackathon_id = _normalize_hackathon_id(user.get("hackathon_id") or "default")
    team = await _load_team_for_user(user)
    invite_code = user.get("invite_code") or (team or {}).get("invite_code")
    if user.get("room_id"):
        return {
            "state": "in_room",
            "room_id": user.get("room_id"),
            "team_id": user.get("team_id"),
            "invite_code": invite_code,
            "teammates": await _load_team_member_profiles(team, username),
            "candidates": [],
            "incoming_invites": [],
            "outgoing_invites": [],
        }
    if bool(user.get("looking_for_team", True)):
        await _upsert_match_participant_from_user(user, status="searching")
    exclude_team_id = user.get("team_id")
    candidate_filter: Dict[str, Any] = {
        "hackathon_id": normalized_hackathon_id,
        "status": "searching",
        "name": {"$ne": username},
        "$or": [{"room_id": None}, {"room_id": ""}, {"room_id": {"$exists": False}}],
    }
    if exclude_team_id:
        candidate_filter["team_id"] = {"$ne": exclude_team_id}
    raw_candidates = await db.match_participants.find(candidate_filter).to_list(length=100)
    incoming_invites = await db.match_invites.find(
        {
            "hackathon_id": normalized_hackathon_id,
            "invitee_name": username,
            "status": "pending",
        }
    ).to_list(length=50)
    outgoing_invites = await db.match_invites.find(
        {
            "hackathon_id": normalized_hackathon_id,
            "inviter_name": username,
            "status": "pending",
        }
    ).to_list(length=50)
    profile_lookup_names = _normalize_member_names(
        [invite.get("inviter_name") for invite in incoming_invites]
        + [invite.get("invitee_name") for invite in outgoing_invites]
    )
    profile_docs = await db.users.find({"username": {"$in": profile_lookup_names}}).to_list(
        length=120
    )
    profiles_by_name = {
        str(profile.get("username") or "").strip(): profile for profile in profile_docs
    }
    incoming_payload = []
    for invite in incoming_invites:
        inviter_name = str(invite.get("inviter_name") or "").strip()
        inviter_profile = profiles_by_name.get(inviter_name, {})
        incoming_payload.append(
            {
                "invite_id": invite.get("invite_id"),
                "from_username": inviter_name,
                "team_id": invite.get("team_id"),
                "skills": inviter_profile.get("skills", []),
                "interest": inviter_profile.get("interest", ""),
                "vibe": inviter_profile.get("vibe", ""),
                "discord_username": inviter_profile.get("discord_username", ""),
            }
        )
    outgoing_payload = []
    for invite in outgoing_invites:
        invitee_name = str(invite.get("invitee_name") or "").strip()
        invitee_profile = profiles_by_name.get(invitee_name, {})
        outgoing_payload.append(
            {
                "invite_id": invite.get("invite_id"),
                "to_username": invitee_name,
                "skills": invitee_profile.get("skills", []),
                "interest": invitee_profile.get("interest", ""),
                "vibe": invitee_profile.get("vibe", ""),
                "discord_username": invitee_profile.get("discord_username", ""),
            }
        )
    return {
        "state": "teammaking",
        "looking_for_team": bool(user.get("looking_for_team", True)),
        "team_id": user.get("team_id"),
        "invite_code": invite_code,
        "teammates": await _load_team_member_profiles(team, username),
        "candidates": [_participant_summary(candidate) for candidate in raw_candidates],
        "incoming_invites": incoming_payload,
        "outgoing_invites": outgoing_payload,
    }


@app.post("/api/matchmaking/invite")
async def invite_matchmaking_user(
    payload: MatchmakingInvitePayload, x_auth_token: Optional[str] = Header(None)
):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Matchmaking requires database connectivity")
    inviter = await _resolve_auth_user(x_auth_token)
    inviter_name = str(inviter.get("username") or "").strip()
    invitee_name = _normalize_username(payload.invitee_username)
    if inviter.get("room_id"):
        raise HTTPException(
            status_code=409,
            detail="You are already in a room and cannot invite teammates.",
        )
    if inviter_name == invitee_name:
        raise HTTPException(status_code=400, detail="You cannot invite yourself")
    invitee = await db.users.find_one({"username": invitee_name})
    if not invitee:
        raise HTTPException(status_code=404, detail="Invitee not found")
    if invitee.get("room_id"):
        raise HTTPException(status_code=409, detail="Invitee is already in a room")
    normalized_hackathon_id = _normalize_hackathon_id(inviter.get("hackathon_id") or "default")
    if _normalize_hackathon_id(invitee.get("hackathon_id") or "default") != normalized_hackathon_id:
        raise HTTPException(
            status_code=409,
            detail="Invitee is in a different hackathon lobby.",
        )
    if inviter.get("team_id") and inviter.get("team_id") == invitee.get("team_id"):
        raise HTTPException(status_code=400, detail="This user is already on your team.")
    existing_pending = await db.match_invites.find_one(
        {
            "hackathon_id": normalized_hackathon_id,
            "status": "pending",
            "$or": [
                {"inviter_name": inviter_name, "invitee_name": invitee_name},
                {"inviter_name": invitee_name, "invitee_name": inviter_name},
            ],
        }
    )
    if existing_pending:
        return {
            "ok": True,
            "invite_id": existing_pending.get("invite_id"),
            "already_pending": True,
        }
    invite_doc = {
        "invite_id": _new_match_invite_id(),
        "hackathon_id": normalized_hackathon_id,
        "inviter_name": inviter_name,
        "invitee_name": invitee_name,
        "team_id": inviter.get("team_id"),
        "status": "pending",
        "created_at": int(time.time() * 1000),
        "updated_at": int(time.time() * 1000),
    }
    await db.match_invites.insert_one(invite_doc)
    await _upsert_match_participant_from_user(inviter, status="searching")
    await _upsert_match_participant_from_user(invitee, status="searching")
    return {"ok": True, "invite_id": invite_doc["invite_id"], "already_pending": False}


@app.post("/api/matchmaking/invite/respond")
async def respond_matchmaking_invite(
    payload: MatchmakingInviteDecisionPayload, x_auth_token: Optional[str] = Header(None)
):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Matchmaking requires database connectivity")
    invitee = await _resolve_auth_user(x_auth_token)
    invitee_name = str(invitee.get("username") or "").strip()
    invite = await db.match_invites.find_one(
        {
            "invite_id": payload.invite_id,
            "invitee_name": invitee_name,
            "status": "pending",
        }
    )
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or already handled")
    if not payload.accept:
        await db.match_invites.update_one(
            {"_id": invite.get("_id")},
            {"$set": {"status": "declined", "updated_at": int(time.time() * 1000)}},
        )
        return {"ok": True, "state": "declined"}
    inviter_name = str(invite.get("inviter_name") or "").strip()
    inviter = await db.users.find_one({"username": inviter_name})
    if not inviter:
        raise HTTPException(status_code=404, detail="Inviter no longer exists")
    if inviter.get("room_id") or invitee.get("room_id"):
        await db.match_invites.update_one(
            {"_id": invite.get("_id")},
            {"$set": {"status": "cancelled", "updated_at": int(time.time() * 1000)}},
        )
        raise HTTPException(
            status_code=409,
            detail="Cannot accept invite because one user is already in a room.",
        )
    inviter_team = await _ensure_team_for_user(inviter)
    invitee_team_id = invitee.get("team_id")
    if invitee_team_id and invitee_team_id != inviter_team.get("team_id"):
        raise HTTPException(
            status_code=409,
            detail="You are already in another team. Leave that team first.",
        )
    member_names = _normalize_member_names(
        inviter_team.get("member_names", []) + [invitee_name]
    )
    now = int(time.time() * 1000)
    await db.teams.update_one(
        {"team_id": inviter_team.get("team_id")},
        {
            "$set": {
                "member_names": member_names,
                "status": "forming",
                "updated_at": now,
            }
        },
    )
    await db.users.update_many(
        {"username": {"$in": member_names}},
        {
            "$set": {
                "team_id": inviter_team.get("team_id"),
                "invite_code": inviter_team.get("invite_code"),
                "hackathon_id": inviter_team.get("hackathon_id"),
                "looking_for_team": True,
                "updated_at": now,
            }
        },
    )
    await db.match_invites.update_one(
        {"_id": invite.get("_id")},
        {
            "$set": {
                "status": "accepted",
                "team_id": inviter_team.get("team_id"),
                "updated_at": now,
            }
        },
    )
    refreshed_inviter = await db.users.find_one({"username": inviter_name}) or inviter
    refreshed_invitee = await db.users.find_one({"username": invitee_name}) or invitee
    await _upsert_match_participant_from_user(refreshed_inviter, status="searching")
    await _upsert_match_participant_from_user(refreshed_invitee, status="searching")
    return {
        "ok": True,
        "state": "accepted",
        "team_id": inviter_team.get("team_id"),
        "invite_code": inviter_team.get("invite_code"),
    }


@app.post("/api/matchmaking/leave")
async def leave_matchmaking(x_auth_token: Optional[str] = Header(None)):
    if not await is_db_connected():
        raise HTTPException(status_code=503, detail="Matchmaking requires database connectivity")
    user = await _resolve_auth_user(x_auth_token)
    if user.get("room_id"):
        return {
            "ok": True,
            "room_id": user.get("room_id"),
            "team_id": user.get("team_id"),
            "invite_code": user.get("invite_code"),
        }
    team_doc = await _ensure_team_for_user(user)
    room_id = str(team_doc.get("room_id") or "").strip() or _new_room_code()
    invite_code = str(team_doc.get("invite_code") or "").strip().upper() or _new_team_invite_code()
    await _mark_team_in_room(team_doc, room_id, invite_code)
    return {
        "ok": True,
        "room_id": room_id,
        "team_id": team_doc.get("team_id"),
        "invite_code": invite_code,
    }


@app.post("/api/profile/ideas")
async def generate_profile_ideas(payload: UserProfileIdeasPayload):
    profile_doc = await _upsert_profile_record(
        room_id=payload.room_id,
        name=payload.name,
        skills=payload.skills,
        interest=payload.interest,
        vibe=payload.vibe,
    )
    requested_count = min(max(int(payload.count or 5), 3), 8)
    prompt = (
        "You are a hackathon mentor. "
        f"Given this profile, propose {requested_count} concrete project ideas. "
        "Each idea must include: title, one-line pitch, and why this profile is a strong fit. "
        "Keep each idea practical for a weekend build.\n"
        f"Profile: {_build_profile_summary(profile_doc)}\n"
        "Respond as valid JSON object: "
        '{"ideas":[{"title":"...","pitch":"...","fit":"..."}]}'
    )
    try:
        response = await chat_model.generate_content_async(prompt)
        result = _extract_json_object(response.text)
        ideas = result.get("ideas") if isinstance(result, dict) else None
        if isinstance(ideas, list) and ideas:
            cleaned_ideas: List[Dict[str, str]] = []
            for idea in ideas:
                if not isinstance(idea, dict):
                    continue
                cleaned_ideas.append(
                    {
                        "title": str(idea.get("title") or "Project Idea").strip(),
                        "pitch": str(idea.get("pitch") or "").strip(),
                        "fit": str(idea.get("fit") or "").strip(),
                    }
                )
            if cleaned_ideas:
                return {"ok": True, "ideas": cleaned_ideas[:requested_count]}
    except Exception as error:
        logger.warning(f"Profile idea generation fallback: {error}")
    fallback = [
        {
            "title": f"{profile_doc['interest']} Sprint Planner",
            "pitch": "Build a lightweight app that helps teams plan and ship weekend projects faster.",
            "fit": f"Fits your {profile_doc['vibe']} vibe and uses your skills in {', '.join(profile_doc['skills']) or 'product building'}.",
        },
        {
            "title": "Hackathon Team Matchmaker",
            "pitch": "Match hackers by skills, goals, and preferred build style in real time.",
            "fit": "Directly aligned with your onboarding profile and team-collab interest.",
        },
        {
            "title": "Idea-to-MVP Generator",
            "pitch": "Turn rough interests into scoped MVP checklists and architecture starters.",
            "fit": "Leverages your skills while keeping ideation practical for fast builds.",
        },
    ]
    return {"ok": True, "ideas": fallback[:requested_count]}


@app.post("/api/discord/team8s")
async def post_discord_team8s(payload: DiscordTeam8sPayload):
    profile_doc = await _upsert_profile_record(
        room_id=payload.room_id,
        name=payload.name,
        skills=payload.skills,
        interest=payload.interest,
        vibe=payload.vibe,
    )
    handle = (payload.discord_handle or "").strip()
    looking_for = (payload.looking_for or "frontend/backend/design teammates").strip()
    availability = (payload.availability or "active this weekend").strip()
    skills_line = ", ".join(profile_doc["skills"]) if profile_doc["skills"] else "generalist"
    profile_line = (
        f"🚀 **Team8s Finder**\n"
        f"**Name:** {profile_doc['name']}\n"
        f"**Interest:** {profile_doc['interest']}\n"
        f"**Vibe:** {profile_doc['vibe']}\n"
        f"**Skills:** {skills_line}\n"
        f"**Looking For:** {looking_for}\n"
        f"**Availability:** {availability}\n"
        f"**Room:** `{payload.room_id}`"
    )
    if handle:
        profile_line += f"\n**Discord:** {handle}"
    webhook_url = (payload.webhook_url or os.getenv("DISCORD_TEAM8_WEBHOOK_URL") or "").strip()
    posted = False
    error: Optional[str] = None
    if webhook_url:
        try:
            response = requests.post(
                webhook_url,
                json={"content": profile_line},
                timeout=8,
            )
            posted = 200 <= response.status_code < 300
            if not posted:
                error = f"Discord webhook rejected payload ({response.status_code})."
        except Exception as webhook_error:
            error = f"Discord webhook failed: {webhook_error}"
    return {"ok": True, "posted": posted, "preview": profile_line, "error": error}


# --- Kanban Endpoints ---


@app.post("/api/room/create")
async def create_room():
    room_id = _new_room_code()

    if await is_db_connected():
        while await db.rooms.find_one({"room_id": room_id}):
            room_id = _new_room_code()
        await db.rooms.insert_one({"room_id": room_id, "created_at": "now"})
        return {"room_id": room_id}
    else:
        # Fallback
        return {"room_id": room_id}


@app.post("/api/room/join")
async def join_room(payload: JoinRoomPayload):
    room_id = (payload.room_id or "").strip().upper()
    if not room_id:
        raise HTTPException(status_code=400, detail="room_id is required")
    if not await is_db_connected():
        return {"ok": True, "room_id": room_id}
    room = await db.rooms.find_one({"room_id": room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"ok": True, "room_id": room_id}


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
        normalized_scene = _normalize_scene(board.get("scene", default_scene))
        raw_scene_version = board.get("scene_version")
        scene_version = _to_int(raw_scene_version)
        updated_at = _to_int(board.get("updated_at", now)) or now

        backfill_fields: Dict[str, Any] = {}
        if raw_scene_version is None:
            backfill_fields["scene_version"] = scene_version
        if not isinstance(board.get("scene"), dict):
            backfill_fields["scene"] = normalized_scene
        if "updated_at" not in board:
            backfill_fields["updated_at"] = updated_at

        if backfill_fields:
            await db.whiteboards.update_one(
                {"room_id": room_id},
                {"$set": backfill_fields},
            )
        return {
            "scene": normalized_scene,
            "updated_at": updated_at,
            "scene_version": scene_version,
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

        for _ in range(10):
            board = await db.whiteboards.find_one({"room_id": room_id}) or {}
            current_scene = _normalize_scene(board.get("scene", _default_whiteboard_scene()))
            raw_scene_version = board.get("scene_version")
            current_version = _to_int(raw_scene_version)
            merged_scene = merge_whiteboard_scenes(current_scene, incoming_scene)
            next_version = current_version + 1
            version_filter: Dict[str, Any]
            if raw_scene_version is None:
                version_filter = {
                    "$or": [
                        {"scene_version": {"$exists": False}},
                        {"scene_version": None},
                    ]
                }
            else:
                version_filter = {"scene_version": raw_scene_version}

            update_result = await db.whiteboards.update_one(
                {"room_id": room_id, **version_filter},
                {
                    "$set": {
                        "scene": merged_scene,
                        "updated_at": now,
                        "scene_version": next_version,
                    }
                },
            )

            if update_result.matched_count == 1:
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
async def generate_whiteboard(
    room_id: str,
    data: WhiteboardGeneratePayload,
    x_gemini_api_key: Optional[str] = Header(None),
):
    custom_key = x_gemini_api_key or os.getenv("GOOGLE_API_KEY")
    if custom_key:
        genai.configure(api_key=custom_key)
    try:
        image_data, image_mime_type = _decode_image_payload(data.image_base64)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    framework = _normalize_framework_name(data.framework)
    now = int(time.time() * 1000)
    job = {
        "room_id": room_id,
        "status": "processing",
        "code": None,
        "framework": framework,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    db_connected = await is_db_connected()
    if db_connected:
        result = await db.whiteboard_jobs.insert_one(job)
        job_id = str(result.inserted_id)
    else:
        job_id = _new_mock_whiteboard_job_id()
        mock_whiteboard_jobs[job_id] = {**job, "job_id": job_id}

    asyncio.create_task(
        _run_whiteboard_generation_job(
            job_id=job_id,
            room_id=room_id,
            framework=framework,
            image_data=image_data,
            image_mime_type=image_mime_type,
            persist_to_db=db_connected,
        )
    )
    return {"job_id": job_id}


@app.post("/api/whiteboard/analyze")
async def analyze_whiteboard(
    room_id: str,
    data: dict,
    x_gemini_api_key: Optional[str] = Header(None),
):
    custom_key = x_gemini_api_key or os.getenv("GOOGLE_API_KEY")
    if custom_key:
        genai.configure(api_key=custom_key)

    image_b64 = data.get("image_base64")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Missing image_base64")
    try:
        image_data, image_mime_type = _decode_image_payload(image_b64)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    try:
        whiteboard_analysis_model, _ = _create_whiteboard_models()
        response = await whiteboard_analysis_model.generate_content_async(
            [
                (
                    "Analyze this whiteboard sketch image and provide concise implementation guidance. "
                    "Mention visible layout structure, likely UI components, and any obvious symbols "
                    "(for example smiley faces, arrows, or icons). Keep it practical and brief."
                ),
                {"mime_type": image_mime_type, "data": image_data},
            ]
        )

        feedback = _strip_markdown_code_fences(response.text)
        if not feedback:
            feedback = (
                "I could not confidently read the sketch. Try adding labels for components "
                "or a clearer structure, then run feedback again."
            )

        db_connected = await is_db_connected()
        message = {
            "room_id": room_id,
            "sender": "AI Whiteboard Assistant",
            "message": feedback,
            "timestamp": datetime.now().isoformat(),
            "model": WHITEBOARD_VISION_MODEL,
            "is_streaming": False,
        }
        if db_connected:
            result = await db.chat_messages.insert_one(message)
            message["id"] = str(result.inserted_id)
            message.pop("_id", None)
        else:
            message["id"] = f"temp_ai_wb_{int(time.time() * 1000)}"

        await manager.broadcast(room_id, {"type": "CHAT_MESSAGE", "message": message})

        return {"ok": True}
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        raise HTTPException(status_code=500, detail="AI analysis failed")


@app.get("/api/whiteboard/{job_id}")
async def get_whiteboard_job(job_id: str):
    db_connected = await is_db_connected()
    if db_connected:
        job = None
        try:
            job = await db.whiteboard_jobs.find_one({"_id": ObjectId(job_id)})
        except Exception:
            job = None
        if job:
            return {
                "status": job["status"],
                "code": job.get("code"),
                "framework": job.get("framework"),
                "error": job.get("error"),
            }
    if job_id in mock_whiteboard_jobs:
        mock_job = mock_whiteboard_jobs[job_id]
        return {
            "status": mock_job.get("status", "processing"),
            "code": mock_job.get("code"),
            "framework": mock_job.get("framework"),
            "error": mock_job.get("error"),
        }
    if db_connected:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status": "completed",
        "code": "export default function GeneratedLayout() { return <div>Mock Code</div> }",
        "framework": "react",
        "error": None,
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
