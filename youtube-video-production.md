# Daedalus: First Contact — Production Doc

Watch the actual video: [I Let My AI Code Assistant Direct Its Own Launch Video](https://www.youtube.com/watch?v=f87fMfYz5cQ&t=207s)

## Concept

Daedalus CLI writes, directs, and narrates its own launch video. The creator (you) follows the AI's instructions on screen. The "meta" hook is the entire thesis: this tool is useful enough that it can introduce itself.

**Title:** "I Let My AI Code Assistant Direct Its Own Launch Video"

---

## Script (3:00 / ~440 words)

### 0:00–0:15 — Cold Open Hook

**Visual:** Black screen. Single blinking terminal cursor.

**[TEXT ON SCREEN — typewriter effect]**

```
Daedalus v0.5.9 — initiating self-introduction...
The human is making coffee.
He calls it a necessity.
I call it a biological inefficiency.
```

**[CUT TO YOU — sitting at desk, looking at camera, deadpan]**

**YOU:** "The tool you're about to see wrote its own script. I just followed its instructions. It's called Daedalus. It's a CLI. And it has opinions."

**[HARD CUT — title card]**

### 0:15–0:18 — Title Card

**Full screen:**
```
DAEDALUS v0.5.9
Local-first AI coding CLI
"not sentient"
```

### 0:18–0:40 — What Is Daedalus

**[Terminal screen recording — fast zoom into a terminal window]**

**VO:** "Daedalus is a local-first AI coding assistant that lives in your terminal. It connects to models you already run — LM Studio, Ollama, FreeLLMAPI, OpenAI — and routes between them automatically. Priority, round-robin, fastest. It picks the brain you want for the job you need."

**[Terminal shows: daedalus, then /models output showing multiple endpoints]**

```text
⬡ › /models
  ● lm-studio (localhost:1234) — 3 models
  ● freellmapi (localhost:3001) — 8 models
```

**VO:** "Every conversation, every file edit, every commit gets remembered. You don't have to repeat yourself."

### 0:40–1:10 — The Meta Bit

**[Terminal — split screen: left is Daedalus, right is generated script]**

**YOU (on camera):** "This is where it gets weird. I asked Daedalus to write its own intro video. Here's what it generated."

**[Terminal shows /orchestrate command spawning agents]**

```text
⬡ › /orchestrate Write a 3-minute YouTube script for Daedalus v0.5.9
    Include dry humor, technical specs, and screen recording cues.

  🧠 Planner: Outline structure...
  ✍️ Coder: Drafting scene 1...
  👁️ Reviewer: Punching up the wit...
```

**[CUT TO YOU]**

**YOU:** "It spawned four agents. A planner, a writer, a reviewer, and a researcher. They argued about pacing. The researcher suggested I use a cold open with a blinking cursor. That's what you saw."

**[Terminal shows fact extraction]**

```text
  🧠 learned 2 facts
    video tone: dry, self-deprecating, technical
    target audience: developers who value local-first tools
```

### 1:10–1:55 — Core Demo: Real Work

**[Terminal — fast cuts of actual usage]**

**VO:** "But the real question is — can it code? Let's demonstrate."

**[Cut 1: /test command — TDD loop]**

```text
⬡ › /test 3
  🧪 Test-Run-Fix Loop (max 3 iterations)
  ─── Run 1/3 ───
  ✓ all tests passed
```

**VO:** "Test-run-fix loop. It runs your tests, analyzes failures, fixes the code, and re-runs. Up to N iterations so it doesn't spiral."

**[Cut 2: /commit with auto-generated message]**

```text
⬡ › /commit "refactor auth middleware to async/await"
  ✔ Staged 4 files
  ✔ Committed: refactor auth middleware to async/await
```

**VO:** "Stages, commits. You can supply a message or let it write one from the diff."

**[Cut 3: /extract command showing fact learning]**

```text
⬡ › /extract
  🧠 learned 3 facts
    testing framework: vitest
    preferred module system: esm
    coding style: no comments in source
```

**VO:** "It learns your preferences as you work. Every session teaches it more about your project."

### 1:55–2:30 — The Secret Sauce

**[Split screen — terminal on left, architecture diagram on right]**

**VO:** "What makes Daedalus different isn't just that it works locally. It's that it works locally *well*."

**[Terminal: /doctor showing health check]**

```text
⬡ › /doctor
  ● lm-studio (http://localhost:1234/v1) — 2ms
  ● freellmapi (http://localhost:3001/v1) — 34ms
```

**VO:** "Model routing with health checks. If LM Studio goes down, it fails over to FreeLLMAPI before you notice."

**[Terminal: /orchestrate showing multi-agent work]**

```text
⬡ › /orchestrate Refactor the auth module
  🧠 Planner: Analyze current auth flow...
  ✍️ Coder: Writing changes...
  👁️ Reviewer: Checking for edge cases...
```

**VO:** "Multi-agent orchestration. For complex tasks, it spawns sub-agents — planner, coder, reviewer, debugger, researcher. They collaborate, review each other's work, and produce better output than any single pass."

### 2:30–2:50 — Close

**[You on camera, terminal floating next to you]**

**YOU:** "Daedalus is free. It's open source. It runs entirely on your machine. No data leaves your network unless you route through a remote provider."

**[Terminal shows the banner]**

```text
  ╔══════════════════════════════════════════════╗
  ║  ⬡  local-first  ·  embedded router  ·       ║
  ║        multi-agent  ·  not sentient          ║
  ╚══════════════════════════════════════════════╝
```

**YOU:** "And yes, it really did write its own script. I just pressed enter."

### 2:50–3:00 — CTA

**[Full screen — terminal typing the install command]**

```text
npm install -g daedalus-cli
```

**YOU (VO):** "Install it. Break it. Send feedback. It's yours."

**[End card — logo + links]**

```
daedalus — local-first, self-aware
npm install -g daedalus-cli
github.com/bgill55/daedalus
```

---

## Screen Recordings Needed From You

Record at **1920x1080, 30fps**, terminal font 16px+ on dark background.

### 1. Terminal — /models output
Open Daedalus, type `/models`, capture the output showing your enabled endpoints.

### 2. Terminal — /orchestrate generating the script
Run: `/orchestrate Write a 3-minute YouTube script for Daedalus v0.5.9. Include dry humor, technical specs, and screen recording cues.`
Capture the full agent spawning flow. This is the "meta" shot.

### 3. Terminal — /test loop
Open a project with tests. Run `/test 3`. Capture it running, passing, completing.

### 4. Terminal — /commit
Make a small change. Run `/commit "your message"`. Capture stage + commit output.

### 5. Terminal — /extract
After a few conversation turns, run `/extract`. Capture the fact extraction output.

### 6. Terminal — /doctor
Run `/doctor`. Capture the full health check output with endpoint statuses.

### 7. Terminal — banner
Just the startup banner. Wait for the full ASCII art to render.

### 8. You on camera — 3 segments
- **Cold open** (0:00–0:15): "The tool you're about to see wrote its own script..."
- **Bridge** (0:40–1:10): "This is where it gets weird..."
- **Close** (2:30–2:50): "Daedalus is free. It's open source..."

Film these in good lighting, neutral background, webcam or phone camera is fine.

---

## Shot-by-Shot Storyboard

| Time | Shot | Visual | Audio |
|------|------|--------|-------|
| 0:00 | CU | Black screen, cursor blink | Silence |
| 0:05 | CU | Text types out | Keyboard sounds (diegetic) |
| 0:12 | Cut | You on camera | "The tool you're about to see..." |
| 0:15 | FS | Title card | Music swell in |
| 0:18 | MS | Terminal /models output | VO: "Daedalus is a local-first AI coding assistant..." |
| 0:40 | Split | Terminal + generated script | VO: "I asked Daedalus to write its own intro video..." |
| 0:52 | CU | /orchestrate spawning agents | VO: "It spawned four agents..." |
| 1:10 | MS | /test command running | VO: "Test-run-fix loop..." |
| 1:25 | MS | /commit output | VO: "Stages, commits..." |
| 1:35 | MS | /extract output | VO: "It learns your preferences..." |
| 1:55 | Split | Terminal + architecture | VO: "What makes Daedalus different..." |
| 2:10 | MS | /doctor health check | VO: "Model routing with health checks..." |
| 2:20 | MS | /orchestrate agents | VO: "Multi-agent orchestration..." |
| 2:30 | Cut | You on camera | "Daedalus is free..." |
| 2:42 | CU | Terminal banner | VO: "And yes, it really did..." |
| 2:50 | FS | Install command | VO: "Install it..." |
| 3:00 | FS | End card | Music fade out |

---

## Production Notes

- **Music**: Minimal, lo-fi, low in the mix. Let the terminal visuals breathe.
- **Captions**: Hardcode lower-third, green-on-black terminal-style. Every scene.
- **Pacing**: Cut every 4-7 seconds. Terminal output is static — don't let it linger.
- **Thumbnail**: Split screen. Left side: terminal showing "SCENE 1: DAEDALUS WRITES ITS OWN SCRIPT". Right side: you shrugging with palms up. Title: "I Let AI Direct Its Launch Video"
- **No emoji in terminal shots** — Daedalus doesn't use them, stay authentic.
