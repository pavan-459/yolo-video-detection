# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

```
navasoft/
├── app/          ← Next.js 16 full-stack app (TypeScript, Tailwind, App Router)
├── ml-server/    ← Flask + YOLOv8 inference server
├── docker-compose.yml
└── README.md
```

Git root is `navasoft/`. There are **two branches**: `main` (Navasoftware assignment, do not break) and `product` (PixelLens product build — all new work goes here).

---

## Commands

### Next.js app (`cd app` first)

```bash
node server.js          # dev — starts Next.js + Socket.IO on :3000
npm run build           # production build
npm run lint            # ESLint
NODE_ENV=production node server.js   # production mode (requires build)
```

There are no tests. Lint is the only automated check.

### Flask ML server (`cd ml-server` first)

```bash
python app.py                        # dev server on :5000
python -m pip install -r requirements.txt   # install deps
```

### Docker (all three services together, from repo root)

```bash
docker-compose up        # starts app (:3000), ml-server (:5000), mongo (:27017)
docker-compose up --build   # rebuild images
```

---

## Architecture

### Why `server.js` exists

Next.js is started via a custom Node HTTP server (`app/server.js`) instead of `next dev`/`next start`. This is the only way to co-host Socket.IO on the same port as Next.js. The server attaches Socket.IO to the HTTP server and exposes it as `global.io` so API routes can emit events without importing a separate socket module.

### How API routes emit real-time events

API routes and background processing call `global.io.to(uploadId).emit(event, data)` directly. This only works because the custom server runs in the same Node process. If you ever split the server (e.g. serverless), this pattern breaks and would need a pub/sub layer (Redis, etc.).

### Auth flow

- NextAuth v4 with Credentials provider + JWT session strategy
- `authOptions` is defined in `app/src/lib/auth.ts` and imported by both the NextAuth route handler and `getServerSession()` calls in API routes
- Middleware (`app/src/middleware.ts`) uses `getToken()` from `next-auth/jwt` (not the default export) — required to stay Edge-runtime compatible. Protects `/dashboard/**` only.
- `session.user.id` is available because the JWT callback copies `user.id` into the token and the session callback copies it back out. Cast as `(session.user as { id: string }).id` in API routes.

### MongoDB connection

`app/src/lib/db.ts` uses a `global.mongoose` cache so the connection survives Next.js hot reloads in dev (a new module instance would otherwise open a new connection on every request). Always call `await connectDB()` at the top of every API route before any Mongoose query.

### Video processing pipeline

`POST /api/videos` saves the file to `uploads/<uuid>.<ext>`, creates a Video document with `status: 'pending'`, then calls `processVideo(uploadId, filePath)` as fire-and-forget. `processVideo` (in `app/src/lib/videoProcessor.ts`) runs FFmpeg → Flask → MongoDB sequentially, emitting Socket.IO events at each stage. The upload file is **kept on disk** after processing so the `/stream` route can serve it.

### Image processing pipeline

`POST /api/images` is synchronous end-to-end: save file → base64 encode → POST to Flask `/detect` → save result to MongoDB → return response. No Socket.IO or background processing needed.

### Flask ML server

Single endpoint `POST /detect` accepts `{ image: "<base64 PNG/JPEG>" }` and returns `{ objects: [{ label, confidence, bbox: [x, y, w, h] }] }`. The model (`yolov8n.pt`) downloads automatically on first run (~6 MB). `ML_SERVER_URL` env var controls which Flask instance the Next.js app talks to.

### FFmpeg path

`fluent-ffmpeg` auto-detects `ffmpeg` from `PATH`. Only set `process.env.FFMPEG_PATH` if ffmpeg is not in PATH — the code checks for this in `videoProcessor.ts` and calls `ffmpeg.setFfmpegPath()` conditionally.

---

## Key files

| File | Purpose |
|---|---|
| `app/server.js` | Custom HTTP server — Next.js + Socket.IO bootstrap |
| `app/src/lib/auth.ts` | NextAuth config (import `authOptions` from here) |
| `app/src/lib/db.ts` | Mongoose singleton — call `connectDB()` before queries |
| `app/src/lib/videoProcessor.ts` | FFmpeg extraction + Flask detection orchestration |
| `app/src/lib/models/Video.ts` | Video schema (`uploadId`, `status`, `results[]`) |
| `app/src/lib/models/Image.ts` | Image schema (`imageId`, `objects[]`) — model name is `PixelImage` to avoid conflict with JS built-in `Image` |
| `app/src/middleware.ts` | Edge-compatible auth guard for `/dashboard` |
| `ml-server/app.py` | Flask detection server |

---

## Environment variables

Required in `app/.env.local` (copy from `.env.local.example`):

```
MONGODB_URI=mongodb://localhost:27017/pixellens
NEXTAUTH_SECRET=<32+ char random string>
NEXTAUTH_URL=http://localhost:3000
ML_SERVER_URL=http://localhost:5000
# FFMPEG_PATH=      ← only needed if ffmpeg not in PATH
```

---

## Gotchas

- The Mongoose model for images is registered as `PixelImage` (not `Image`) to avoid collision with the global `Image` constructor.
- `framesData` on the Video schema is a legacy dead field — never written to, safe to ignore.
- Deleting a video/image via the API removes the DB record **and** the file from `uploads/`. If you add new file-producing routes, follow the same cleanup pattern.
- The `product` branch README documents the product (PixelLens). The `main` branch README documents the original assignment setup. Don't merge them.
