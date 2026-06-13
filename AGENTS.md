# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repository shape
- Two main apps:
  - `frontend/`: React 19 + TypeScript + Vite single-page app.
  - `backend/`: FastAPI service with MongoDB access via Motor.
- Root `README.md` is minimal; most practical setup detail comes from code and config files.

## Common commands
Run from repository root unless noted.

### Frontend (`frontend/`)
- Install deps: `npm --prefix frontend install`
- Start dev server: `npm --prefix frontend run dev`
- Build: `npm --prefix frontend run build`
- Lint: `npm --prefix frontend run lint`
- Preview production build: `npm --prefix frontend run preview`

### Backend (`backend/`)
- Create virtual env: `python3 -m venv backend/.venv`
- Install deps: `backend/.venv/bin/pip install -r backend/requirements.txt`
- Run API locally: `backend/.venv/bin/uvicorn main:app --app-dir backend --reload --host 0.0.0.0 --port 8000`

### Tests
- There are currently no committed test files and no test script in `frontend/package.json`.
- If backend tests are added using pytest, run all tests with:
  - `backend/.venv/bin/python -m pytest backend`
- Single test pattern (when tests exist):
  - `backend/.venv/bin/python -m pytest backend/tests/test_<name>.py::test_<case>`

## Environment configuration
- Frontend env file: `frontend/.env.example`
  - `VITE_API_BASE_URL`
  - `VITE_WS_BASE_URL`
- Backend env file: `backend/.env.example`
  - `OPENAI_API_KEY`
  - `ELEVENLABS_API_KEY`
  - `MONGODB_URI`

## High-level architecture
### Frontend runtime model
- Entry point is `frontend/src/main.tsx`, which mounts `frontend/src/App.tsx`.
- The active UI implementation is concentrated in `frontend/src/App.tsx`:
  - `EntryScreen`: room create/join flow (`/api/room/create`) and local storage room persistence.
  - `BoardPage`: Kanban board state, polling-based sync, task CRUD, drag/drop column moves, voice summary trigger.
  - `WhiteboardPage`: Excalidraw import/export, whiteboard job creation, polling for generated code, copy/download UX.
  - `IntegrationsPage`: Git repo connect flow and periodic commit polling.
- API calls are centralized in the local `apiFetch()` helper in `App.tsx`; it uses:
  - `VITE_API_BASE` if present
  - otherwise fallback `http://localhost:8000`

### Backend runtime model
- `backend/main.py` defines a single FastAPI app with:
  - Room/board/task endpoints (`/api/room/*`, `/api/board/*`, `/api/task/*`)
  - Whiteboard job endpoints (`/api/whiteboard/*`)
  - Git integration endpoints (`/api/git/*`)
  - Voice job endpoints (`/api/voice/*`)
  - WebSocket endpoint (`/ws/board/{room_id}`) and connection manager for broadcast events.
- MongoDB connection is initialized at module load from `MONGODB_URI`; handlers check connectivity via `is_db_connected()`.
- Many endpoints include mock fallback responses when DB is unavailable, which is important for local/demo behavior.

### Important codebase nuance
- `frontend/src/pages/*`, `frontend/src/components/*`, and `frontend/src/hooks/useBoardWebSocket.ts` appear to be an older modular path and are not wired by `main.tsx` today.
- Most product behavior currently lives in the monolithic `App.tsx`; prioritize editing there unless intentionally refactoring to the modular files.
