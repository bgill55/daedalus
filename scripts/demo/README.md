# Daedalus Demo Recording Setup

Generates a flawless, typo-free animated terminal recording of the Daedalus
Finn Loop for YouTube / promotional use.

---

## Prerequisites

### 1. Install terminalizer globally
```powershell
npm install -g terminalizer
```

### 2. Install node-pty (one-time)
```powershell
npm install --save-dev node-pty
```

> node-pty has prebuilt Windows binaries — no C++ compiler required in most cases.
> If it fails, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) first.

---

## Usage

### Step 1 — Record the demo
```powershell
terminalizer record daedalus-demo --config D:\Daedalus\scripts\demo\terminalizer.yml
```

This opens a themed terminal window and runs `demo.mjs` automatically.
**You do not need to type anything.** Sit back and watch.

### Step 2 — Preview the recording
```powershell
terminalizer play daedalus-demo
```

### Step 3 — Render to GIF
```powershell
terminalizer render daedalus-demo --output docs/media/daedalus-demo.gif
```

### Step 4 — Render to MP4 (for YouTube)
terminalizer does not export MP4 directly. Use one of:

**Option A — OBS** (recommended for YouTube quality):
- Run `terminalizer play daedalus-demo` in a clean window
- Record the window with OBS at 1920x1080 with a clean Daedalus-themed background

**Option B — ffmpeg** (convert the GIF):
```powershell
ffmpeg -i docs/media/daedalus-demo.gif -vf "scale=1920:-1:flags=lanczos" -c:v libx264 -crf 18 docs/media/daedalus-demo.mp4
```

---

## Customizing Timing

Edit `demo.mjs` top constants to adjust pacing:

| Constant         | Default | Effect                              |
|------------------|---------|-------------------------------------|
| `CHAR_DELAY_MS`  | 55      | Base ms between each keypress       |
| `CHAR_JITTER_MS` | 25      | Random jitter added to feel natural |
| `LINE_PAUSE_MS`  | 800     | Default pause after pressing Enter  |

Increase `pause(ms)` calls after each command if Daedalus needs more time to respond.

---

## What the Demo Shows

| Timestamp | Scene                                                    |
|-----------|----------------------------------------------------------|
| 0:00      | PowerShell opens, `npx tsx src/index.ts` typed & launched |
| 0:06      | Daedalus banner + REPL prompt appears                    |
| 0:08      | `/spec` command typed character-by-character             |
| 0:14      | Daedalus asks 3 clarification questions                  |
| 0:17      | Answers typed automatically, Issue #N created on GitHub  |
| 0:28      | `/loop` typed, daemon starts polling                     |
| 0:32      | Multi-agent orchestration output scrolls live            |
| 0:45      | Self-Review Gate fires (magenta output)                  |
| 0:55      | PR pushed, Discord embed fired                           |

---

## Editing for YouTube

Recommended cut points:
- **Cut 1 (0:28 → 0:45)**: Skip the multi-agent middle loop output — insert a title card: *"Daedalus writes the code, runs tests, and reviews itself..."*
- **Cut 2**: Drop in the `finn-loop-architecture-workflow.png` sequence diagram as a visual overlay
- **Cut 3**: End with a screenshot of the GitHub PR #16 review comment
