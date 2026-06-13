# HackBuddy — Project Plan v2
### *The Hackathon Co-Pilot*
**2-person team · 36-hour roadmap**

---

## Feature Overview

HackBuddy is a web app that lives in a browser tab for the entire hackathon. It has four features, two of which are the real product and two of which are integrations that add polish.

| Priority | Feature | What it does |
|---|---|---|
| **Core** | 📋 Kanban Board | Shared task board for the team — create cards, assign them, move them through columns |
| **Core** | ✏️ In-App Whiteboard → Code | Draw a UI sketch directly in HackBuddy, click generate, get working React/HTML boilerplate |
| **Minor** | 🔗 Git Tracker | Connect a GitHub repo — commits auto-appear as a log and can optionally close Kanban cards |
| **Minor** | 🔊 ElevenLabs Voice | A voice that reads out summaries and updates — "3 tasks completed, 2 in progress, here's what changed" |

The Kanban and Whiteboard are the product. The Git Tracker and Voice are the integrations that make it feel like a complete tool and target extra prize categories. Build the first two to a high standard, then add the last two if time allows.

---

## What You Are Not Building

- ❌ Terminal / TUI companion — gone
- ❌ Rubber Duck debugger — gone
- ❌ Audio podcast — gone
- ❌ CLI optimizer — gone

---

## Architecture

```
[ React SPA — one browser tab ]
  /board        → Kanban
  /whiteboard   → Canvas + Code generation
  /integrations → Git log view + Voice panel

        |  REST API (polling, no websockets needed)
        v

[ FastAPI Backend on Vultr ]
    |                   |
    v                   v
[ MongoDB Atlas ]   [ AI / Integration APIs ]
  - tasks             - GPT-4o (whiteboard → code)
  - boards            - GPT-4o (project summary text)
  - git_events        - ElevenLabs (speak summary)
  - voice_jobs        - GitHub REST API (commit log)
```

**Keep it flat.** No websockets — both users poll `/api/board` every 3 seconds for updates. That's fast enough to feel live and requires zero infrastructure beyond a basic FastAPI app. No auth system either — give the team a shared 6-character room code (like `HB-4X9Z`) that they both type in on load. All data for that room is scoped to that code in MongoDB.

---

## Team Split

Agree on this in the first hour. Do not drift from it.

| Person A — Backend & AI | Person B — Frontend & UX |
|---|---|
| FastAPI skeleton + Vultr deploy | React scaffold + routing |
| MongoDB Atlas setup + schemas | Room code entry screen |
| Kanban CRUD endpoints | Kanban board UI (columns, cards, drag) |
| Whiteboard image → GPT-4o pipeline | In-app canvas component |
| Code output formatting | Code display + copy/download buttons |
| GitHub API commit fetcher | Git log UI panel |
| GPT-4o summary text generation | ElevenLabs trigger button + audio playback |
| ElevenLabs API call | Loading states + error handling |
| Mock data for all endpoints (hour 1-3) | Full UI built against mock data |

**Person A's first job is mock responses.** By hour 3, every endpoint should return realistic hardcoded JSON so Person B is never blocked on a real API being ready.

---

## Detailed 36-Hour Roadmap

---

### Phase 1 — Foundation (Hours 0–5)

**Hours 0–1: Together**

Do this as a pair before splitting:
- Initialize the monorepo: `/frontend` (React + Vite + Tailwind), `/backend` (FastAPI)
- Spin up MongoDB Atlas free cluster. Create collections: `boards`, `tasks`, `git_events`, `voice_jobs`
- Launch a Vultr Ubuntu 22 instance. SSH in, install Python 3.11, pip, ffmpeg (needed later for ElevenLabs audio)
- Create `.env` files listing every key as a placeholder: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `MONGODB_URI`
- Decide on your room code format — keep it simple, a random 4-char alphanumeric string generated once on first load and stored in localStorage

**Hours 1–3: Backend Skeleton (Person A)**

Stand up FastAPI with these endpoints, all returning mock JSON:

```
POST /api/room/create              → {room_id: "HB-4X9Z"}
GET  /api/board/{room_id}          → {columns, tasks}
POST /api/task/create              → {task_id, ...}
PUT  /api/task/{task_id}           → updated task
DELETE /api/task/{task_id}         → {ok: true}

POST /api/whiteboard/generate      → {job_id}
GET  /api/whiteboard/{job_id}      → {status, code, framework}

GET  /api/git/{room_id}            → {commits: [...]}
POST /api/git/{room_id}/connect    → {ok: true}

POST /api/voice/speak              → {job_id}
GET  /api/voice/{job_id}           → {status, audio_url}
```

Deploy this immediately to Vultr. Person B gets a live base URL by hour 3.

**Hours 3–5: Frontend Scaffold (Person B)**

- React app with three routes: `/board`, `/whiteboard`, `/integrations`
- A simple entry screen on `/` — text input for room code + "Create room" and "Join room" buttons. Room code stored in React context, passed to every API call
- Placeholder content on each route so navigation works
- Deploy to Vercel (free, 2-minute setup for React apps)

---

### Phase 2 — Kanban Board (Hours 5–14)

This is the backbone of the product. It needs to work reliably and feel good to use.

**Data model:**

```json
{
  "room_id": "HB-4X9Z",
  "columns": ["Backlog", "In Progress", "Done"],
  "tasks": [
    {
      "id": "t_001",
      "title": "Build auth flow",
      "description": "JWT tokens, login page",
      "column": "In Progress",
      "assignee": "Alex",
      "created_at": 1720000000,
      "git_linked": null
    }
  ]
}
```

Keep the schema flat. No nested subtasks, no labels, no due dates — you don't need them and they add complexity at 3am.

**Backend (Person A, hours 5–9):**

- `GET /api/board/{room_id}` — returns the full board state every time it's polled
- `POST /api/task/create` — validates the payload with pydantic, inserts to MongoDB
- `PUT /api/task/{task_id}` — handles both field edits and column changes with the same endpoint; client sends the full updated task object, backend does a replace
- `DELETE /api/task/{task_id}` — soft delete preferred (set `deleted: true`) so git-linked tasks don't break the log

**Frontend (Person B, hours 5–14):**

Build the Kanban as three fixed columns side by side. Each column is a vertical flex container. Cards are draggable between columns.

*Drag and drop:* Use the `@dnd-kit/core` library — it's the best modern React drag-and-drop, has good touch support, and is not overly complex. Do not use `react-beautiful-dnd` (it's deprecated). When a card is dropped into a new column, fire `PUT /api/task/{task_id}` immediately with the updated column value. Optimistically update the UI before the response comes back — don't wait for the server round-trip or it'll feel laggy.

*Card creation:* Clicking a "+ Add task" button at the bottom of any column opens an inline form within that column — a text input for the title and a smaller textarea for description. Do not open a modal. Inline creation is faster and feels more like a native tool. On submit, POST to the backend and add the card to local state immediately.

*Card editing:* Clicking a card opens a slide-in drawer from the right side of the screen (not a modal). The drawer shows the full card: title (editable), description (editable), assignee dropdown (just a text input is fine), and a delete button at the bottom. Autosave on blur — no explicit "Save" button needed.

*Polling:* Every 3 seconds, GET the full board. On receipt, diff the incoming task list against local state. Only re-render cards that actually changed — otherwise the board will flash and feel broken when someone else is also editing. A simple comparison by `task_id + updated_at` timestamp is enough.

*Polish details worth spending time on:*
- Show a small colored dot next to each card indicating assignee (generate a deterministic color from the name string — `hsl(hash(name) % 360, 60%, 60%)`)
- Show a task count badge on each column header
- When a column is empty, show a subtle "Drop cards here" placeholder so the drop target is clear
- Animate card movement between columns with a 150ms CSS transition — feels much more polished than instant jumps
- Show "Last updated X seconds ago" in the header, updated from the poll response

---

### Phase 3 — In-App Whiteboard → Code (Hours 14–24)

This is the most technically interesting feature. The key difference from the original plan: users **draw directly in the app**, they don't upload a photo. This means the canvas is built into HackBuddy and the sketch lives in the same tab as the Kanban.

**Canvas implementation:**

Use **Excalidraw** as an embedded React component. It's open source, has an npm package (`@excalidraw/excalidraw`), and gives you a full sketching tool — shapes, freehand drawing, text labels — in about 10 lines of React:

```jsx
import { Excalidraw } from "@excalidraw/excalidraw";

function WhiteboardPage() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);

  const handleGenerate = async () => {
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({ elements: excalidrawAPI.getSceneElements(), ... });
    // convert blob to base64, POST to backend
  };

  return (
    <div style={{ height: "60vh" }}>
      <Excalidraw ref={(api) => setExcalidrawAPI(api)} />
      <button onClick={handleGenerate}>Generate Code →</button>
    </div>
  );
}
```

Excalidraw exports the canvas as a PNG blob. Convert that to base64 and POST it to `/api/whiteboard/generate`.

**Why Excalidraw over a custom canvas:**
- Saves 8–10 hours of canvas development time
- Gives users shapes, arrows, text labels — all genuinely useful for UI sketching
- Looks good in a demo without any styling effort
- Has clean export functionality built in

**Layout of the whiteboard page:**

Split the page 50/50: canvas on the left, generated code on the right. On mobile or narrow screens, stack them vertically. The "Generate Code →" button sits in a toolbar above the canvas.

Offer a framework selector before generating: **React component** or **plain HTML + Tailwind**. Store the choice in component state, include it in the API payload as `{image_base64: "...", framework: "react"}`.

**Backend pipeline (Person A):**

1. Receive the base64 image and framework preference
2. Create a job in MongoDB: `{status: "processing", created_at: now}`
3. In a background thread (FastAPI's `BackgroundTasks`), call GPT-4o vision API
4. Update the job in MongoDB with the result
5. Frontend polls the job status endpoint

**GPT-4o prompt engineering — spend real time on this:**

The system prompt matters enormously. A loose prompt returns generic boilerplate that doesn't match the sketch. Here's a production-quality starting structure:

```
System:
You are a frontend developer reading a hand-drawn UI wireframe sketch.
Your task is to produce complete, working [FRAMEWORK] code that faithfully
reproduces the layout shown in the sketch.

Rules:
- Identify every distinct region: headers, sidebars, cards, buttons, inputs,
  lists, modals, navigation bars
- Preserve the relative spatial arrangement — if something is top-left in the
  sketch, it should be top-left in the code
- Use Tailwind CSS utility classes for all styling
- If you see text in the sketch, use it as labels, headings, or placeholder text
- Produce a SINGLE complete file with no explanation text, no markdown fences,
  no comments — only valid code
- For React: export a default function component named "GeneratedLayout"
- For HTML: produce a complete self-contained HTML file with Tailwind CDN included

If the sketch is unclear or ambiguous, make a reasonable interpretation
and produce the best code you can. Never refuse or ask for clarification.
```

Test this prompt against at least 5 different sketch styles during development — a box-heavy layout, a text-heavy layout, a sketch with arrows, a very rough sketch, and a clean one. Adjust the prompt based on what breaks.

**Code display (Person B):**

- Show the code in a dark-themed code block with syntax highlighting (use Prism.js via CDN — no install needed)
- Three action buttons above the code: **Copy**, **Download as .jsx / .html**, **Regenerate**
- Below the code, add a small "Paste this into your project and start building" note — reinforces the tool's purpose
- Show a skeleton loading state in the code panel while the job is processing — three animated gray bars of different widths look like code lines

**Edge cases:**

- Empty canvas (no elements drawn): detect client-side with `excalidrawAPI.getSceneElements().length === 0` and show an inline error before even making the API call
- Canvas with only text and no shapes: GPT-4o handles this fine, but warn the user that structural shapes (rectangles, boxes) produce better results
- Generation takes over 30 seconds: show "This is taking longer than usual..." after 15 seconds, then an error with a retry button at 45 seconds

---

### Phase 4 — Minor Features (Hours 24–30)

Build these only after both core features are working end-to-end. If you hit hour 24 and the Kanban or Whiteboard are still broken, skip Phase 4 entirely and fix the core.

**4A — Git Tracker (Hours 24–27)**

This is a read-only log of commits from the team's GitHub repo. It does not need to update the Kanban automatically — that's a nice-to-have, not a requirement.

*Setup flow:*
On the `/integrations` page, a user pastes their GitHub repo URL (public repos only) and clicks "Connect." The backend extracts `owner/repo` from the URL and starts polling the GitHub REST API every 5 minutes:

```
GET https://api.github.com/repos/{owner}/{repo}/commits?per_page=20
```

Store new commits in MongoDB under `git_events` for the room. The frontend polls `/api/git/{room_id}` every 30 seconds and shows new commits as they appear.

*Display:*
A vertical timeline of commits — author avatar initial (colored circle), commit message, timestamp, and a `+N / -N` lines changed indicator if available. Keep it visually simple: this is a log, not a dashboard.

*Optional Kanban integration:*
If a commit message contains a task ID (e.g., `[t_001] Fix login redirect`), auto-move that task to "Done." Parse commit messages on the backend when storing them. This is a great demo moment — make a commit with a task ID in the message and show the card move on its own.

**4B — ElevenLabs Voice (Hours 27–30)**

This is not a podcast. It's a single button that speaks a brief update about the current board state.

*What it says:*
Generate a 2–3 sentence summary with GPT-4o from the current board state, then synthesize it with ElevenLabs:

> "You've got 8 tasks total — 3 done, 2 in progress, and 3 still in the backlog. Alex has 2 tasks in progress. Your last commit was 14 minutes ago from Jordan."

That's it. Short, useful, voice-activated. Like a standup summary you can trigger at any time.

*Implementation:*
- One "🔊 Read Update" button, visible on the `/board` page in the top-right corner
- On click, POST to `/api/voice/speak` with the current board state as JSON
- Backend calls GPT-4o to write the summary text, then calls ElevenLabs to synthesize it
- Return an audio URL, play it with a hidden `<audio>` element's `.play()` call
- Choose one clear, neutral ElevenLabs voice — don't use two voices here, there's no dialogue

*Keep the backend clean:*
ElevenLabs can be called with a simple POST:

```python
import requests

response = requests.post(
    f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
    headers={"xi-api-key": ELEVENLABS_API_KEY},
    json={"text": summary_text, "model_id": "eleven_multilingual_v2"}
)
audio_bytes = response.content
# save to file, serve as static asset, return URL
```

Save the audio file to `/static/voice/{job_id}.mp3` and serve it directly from FastAPI with `StaticFiles`. No object storage needed for a demo.

---

### Phase 5 — Resilience & Polish (Hours 30–34)

**Mock fallback system:**

Add `?demo=true` to the URL. When active, every API call goes to `/api/demo/{feature}` instead of the real endpoints, returning pre-baked responses:
- Demo board with 3 columns, 6 sample tasks
- Pre-generated code output for a sample "dashboard" sketch
- Pre-fetched commit log for a fictional repo
- Pre-generated voice audio file (record it once, commit it to the repo)

Practice the demo in this mode. If WiFi dies on stage, `?demo=true` and keep going.

**Resilience checklist:**
- [ ] All polling has a max retry count (stop after 15 failed polls, show an error)
- [ ] All API calls have a 30-second client-side timeout
- [ ] Every button has a disabled + loading state while a request is in-flight
- [ ] The board works if one team member goes offline — stale data is shown, not a broken screen
- [ ] Whiteboard canvas state is saved to localStorage every 30 seconds (so a refresh doesn't lose the sketch)

**Visual polish:**

Dark developer-tool aesthetic:
- Background: `#0D1117` — GitHub's dark background, immediately readable to developer judges
- Accent: `#58A6FF` — readable blue, consistent with tools developers already use
- Font: `JetBrains Mono` for code blocks only; `Inter` (or system-ui) for UI text
- No gradients, no illustrations, no icons beyond simple SVGs — clean, functional, fast

Specific touches:
- The room code should be displayed persistently in the top-right corner so both users can always see it
- Navigation is a simple top bar: three links (Board, Whiteboard, Integrations) + the room code
- Skeleton loading states everywhere — not spinners
- Toast notifications (not alerts) for events like task creation, code generation complete, voice ready

---

### Phase 6 — Pitch (Hours 34–36)

**Demo script (2 minutes, practice this out loud at least twice):**

1. *"HackBuddy is a co-pilot that lives in one browser tab for your entire hackathon. We built it during this hackathon, using itself."* (8 sec)

2. Open `/whiteboard`. The Excalidraw canvas is already there. Draw three boxes — a header, a sidebar, a card grid — and label them. Takes 20 seconds live. Hit **Generate Code**. While it processes: *"We sketched this at the start of the hackathon. Within 15 seconds we had working React boilerplate for our initial layout."* Show the generated code. (60 sec)

3. Navigate to `/board`. The team's actual task board from this hackathon is live. Point to a completed column. *"This is our actual board from the last 36 hours. Cards move between Backlog, In Progress, and Done — shared live between both of us."* Click the **Read Update** button. Let the voice play: it reads the real board state. (35 sec)

4. Open `/integrations`. Show the git log populated with your actual commits. *"Every commit from our repo shows up here. If you include a task ID in your commit message, HackBuddy moves the card to Done automatically."* (20 sec)

5. *"We're targeting developer tooling, generative AI, and ElevenLabs audio tracks."* (8 sec)

**Total: ~2 min 10 sec.**

**Backup:** Screen-record the entire demo at hour 33 while everything is still working. Store the video locally, not on Google Drive.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + Vite + Tailwind | Fast builds, no config fights |
| Canvas | Excalidraw (npm) | Saves ~10 hours vs custom canvas |
| Drag-and-drop | @dnd-kit/core | Modern, not deprecated |
| Syntax highlight | Prism.js (CDN) | Zero install, just a script tag |
| Backend | FastAPI (Python 3.11) | Async, fast to write |
| Database | MongoDB Atlas (free tier) | Flexible schema for tasks + job payloads |
| Server | Vultr $6/mo | Long-running audio synthesis needs a real server |
| Vision + Text AI | GPT-4o | Sketch parsing + summary generation |
| Voice | ElevenLabs Multilingual v2 | Single voice for board summaries |
| Git data | GitHub REST API | No auth for public repos |
| Frontend deploy | Vercel (free) | 2-minute deploy |
| Backend deploy | Vultr Ubuntu instance | `uvicorn main:app --host 0.0.0.0` |

---

## Hour-36 Checklist

Core:
- [ ] Two people can join the same board with a room code
- [ ] Tasks can be created, moved between columns, and edited
- [ ] Both users see each other's changes within ~3 seconds
- [ ] Canvas can be drawn on and code can be generated from it
- [ ] Generated code displays with syntax highlighting and can be copied

Minor:
- [ ] GitHub repo can be connected and commits appear in the log
- [ ] Voice button reads the current board state aloud

Demo:
- [ ] `?demo=true` works and shows a full pre-baked experience
- [ ] App is live at a public URL
- [ ] Screen recording of the full demo exists
- [ ] Demo script rehearsed out loud at least twice
