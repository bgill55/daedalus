---
name: clip-pipeline
description: Run the YouTube Factory Viral Clipping Studio pipeline from a production brief. Parses the brief, fills Studio fields via REST API, triggers pre-flight and render, polls until complete, and outputs the final deliverable path for human QA.
trigger: clip pipeline|run the pipeline|process a brief|cut a clip|render a clip|youtube factory clip
safety: instructions
---

# Clip Pipeline Skill

Drive the **YouTube Factory Viral Clipping Studio** (`http://localhost:5000`) end-to-end from a production brief markdown file. You handle automation through rendering. A human does QA. You never publish.

## Boundary Rules
- **You do:** Parse brief, verify Studio health, invoke preflight, trigger render, poll until finished, report deliverable paths.
- **You do NOT:** QA video/audio, publish to social platforms, edit captions or copy, invent missing timestamps.
- **Stop on completion:** Once rendered, report the output MP4 and metadata text file path, then stop.

---

## Step 1: Parse the Production Brief

The brief is a markdown file with the following exact format:

| Field | Format | Example |
| :--- | :--- | :--- |
| **URL** | `URL: <youtube-link>` | `URL: https://youtu.be/BEULMc2QdnY` |
| **Keep** | `Keep: HH:MM:SS -> HH:MM:SS` | `Keep: 00:16:30 -> 00:17:45` |
| **Middle cuts** | `Cut out: HH:MM:SS -> HH:MM:SS` (repeatable) | `Cut out: 00:17:00 -> 00:17:10` |
| **Headline** | `Headline: <text>` | `Headline: THE $60 CALL THAT BOOKED AN INTERNET PARIAH` |
| **Guest line** | `Guest: <text>` | `Guest: JULIAN DOREY x MIKE CLUM // BEHIND THE SCENES` |
| **BGM prompt** | `BGM: <prompt>` | `BGM: dark investigative synth pulse, 80 bpm` |
| **Pinned comment** | `Pinned: <text>` | `Pinned: Would you pay $60 for that call?` |
| **Captions** | Lines starting with `IG:`, `TikTok:`, `YT:` | (Copy verbatim, do not reword) |

### Parsing Rules:
1. **Slug generation:** Generate `clip_name` from Headline: lowercase alphanumeric with underscores, prefixed with `clip_` (e.g. `clip_the_60_dollar_call`). Max 30 chars.
2. **Timestamps:** Extract `start` and `end` from `Keep`. If `Cut out:` lines exist, parse them into a list of pairs: `[["00:17:00", "00:17:10"]]`.

---

## Step 2: Health Check & Reset

Studio Base URL: `http://localhost:5000`

1. **Verify Studio is up:**
   ```bash
   curl -s http://localhost:5000/api/clipper/status
   ```
   If connection is refused: report that YouTube Factory web server (`app.py`) is offline on port 5000 and stop.

2. **Check for running job:**
   If `status == "running"`, report that another job is active and stop.
   If previous job was completed or errored, clear state:
   ```bash
   curl -s -X POST http://localhost:5000/api/clipper/reset
   ```

---

## Step 3: Trigger Pre-Flight

Pre-flight performs audio extraction, Whisper transcription, and face framing tracking.

```bash
curl -s -X POST http://localhost:5000/api/clipper/preflight \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<URL>",
    "start": "<KEEP_START>",
    "end": "<KEEP_END>",
    "name": "<CLIP_NAME>",
    "title": "<HEADLINE>",
    "cut_segments": [["<CUT_START>", "<CUT_END>"]],
    "style": "facecam",
    "censor": true
  }'
```

*Note: If no cuts exist, pass `"cut_segments": null`.*
Wait for the HTTP response (Pre-flight runs synchronously and returns the preflight report JSON). If it returns an error `{"error": ...}`, report and stop.

---

## Step 4: Trigger Render

Initiate the asynchronous render worker:

```bash
curl -s -X POST http://localhost:5000/api/clipper/render \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<URL>",
    "start": "<KEEP_START>",
    "end": "<KEEP_END>",
    "name": "<CLIP_NAME>",
    "title": "<HEADLINE>",
    "sub_title": "<GUEST_LINE>",
    "cut_segments": [["<CUT_START>", "<CUT_END>"]],
    "bgm_prompt": "<BGM_PROMPT>",
    "style": "facecam",
    "censor": true,
    "title_bar": true,
    "enable_cta": true,
    "enable_transitions": true
  }'
```

Expected response: `{"status": "started", "clip_name": "<CLIP_NAME>"}`.

---

## Step 5: Poll Status Until Done

Poll every 20-30 seconds:
```bash
curl -s http://localhost:5000/api/clipper/status
```

Response structure:
```json
{
  "clip_name": "clip_the_60_dollar_call",
  "status": "running" | "completed" | "error",
  "step": "Transcribing & framing vertical video...",
  "progress": 55,
  "output_file": "D:\\Youtube_Factory\\workspace\\julian_clips\\clip_...\\clip_....mp4",
  "error": null
}
```

- **Loop:** Keep polling while `status == "running"`.
- **Timeout:** If elapsed time exceeds 20 minutes without progress changes, report a stall and stop. Do NOT trigger a second render.
- **On Error:** If `status == "error"` or `error` is not null, log the error message and stop.

---

## Step 6: Report Deliverables

When `status == "completed"`:
1. Locate the clip directory: `D:\Youtube_Factory\workspace\julian_clips\<CLIP_NAME>\`
2. Deliverable files:
   - **Rendered Video:** `<output_file>`
   - **Metadata Package:** `D:\Youtube_Factory\workspace\julian_clips\<CLIP_NAME>\clip_metadata.txt`
   - **JSON Metadata:** `D:\Youtube_Factory\workspace\julian_clips\<CLIP_NAME>\metadata.json`
3. Output the summary report:
   ```markdown
   ### Render Complete & Ready for QA
   - **Clip Name:** <CLIP_NAME>
   - **Video File:** <output_file>
   - **Metadata File:** <path to clip_metadata.txt>
   - **Brief Processed:** <brief_filename>

   Human QA required before any publishing.
   ```
4. Stop immediately.
