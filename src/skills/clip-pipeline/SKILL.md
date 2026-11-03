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
| **BGM prompt** | `BGM: <prompt>` | `BGM: 105 bpm aggressive pulse. A notch above Part 1's energy.` |
| **Pinned comment** | `Pinned: <text>` | `Pinned: Would you pay $60 for that call?` |
| **Captions** | Lines starting with `IG:`, `TikTok:`, `YT:` | (Copy verbatim, do not reword) |
| **Punch words** | Quoted terms in `Captions:` description | `"POUNDING THE TABLE" "POWER GRID TAKEOUTS"` |

### Parsing Rules:
1. **Slug generation:** Generate `clip_name` from Headline: lowercase alphanumeric with underscores, prefixed with `clip_` (e.g. `clip_the_60_dollar_call`). Max 30 chars.
2. **Timestamps:** Extract `start` and `end` from `Keep`. If `Cut out:` lines exist, parse them into a list of pairs: `[["00:17:00", "00:17:10"]]`.
3. **BGM trigger:** If `BGM:` prompt is present, always specify `"bgm_path": "stable_audio_3"` in the render payload so YouTube Factory uses Stable Audio 3 rather than the library fallback track.
4. **Keyword captions & Subtitle Punch Words:**
   - Extract uppercase punch terms enclosed in double quotes from the `Captions:` directive (e.g. `["POUNDING", "POWER GRID", "NUMBER ONE CONCERN"]`).
   - Set `"cut_style": "evidence_cut"` and pass `"keyword_captions"` in the render payload to trigger animated payoff keyword cards.
   - Inject color tags (`{\c&H2020FF&}` for Crimson Red or `{\c&H00D7FF&}` for Yellow) into the matching tokens in `subtitles.ass` during the pre-flight / edit stage so on-screen karaoke punch words pop with custom color.

---

## Step 2: Health Check & Reset

Studio Base URL: `http://127.0.0.1:5000`

> [!NOTE]
> On Windows environments, Windows `cmd.exe` misinterprets single-quoted multi-line `curl -d '{...}'` JSON payloads.
> Always use `python -c` (with standard library `urllib.request`) or a Node.js one-liner to dispatch requests cleanly without escaping failures.

1. **Verify Studio is up:**
   ```bash
   python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:5000/api/clipper/status').read().decode())"
   ```
   If connection is refused: report that YouTube Factory web server (`app.py`) is offline on port 5000 and stop.

2. **Check for running job:**
   If `status == "running"`, report that another job is active and stop.
   If previous job was completed or errored, clear state:
   ```bash
   python -c "import urllib.request; req = urllib.request.Request('http://127.0.0.1:5000/api/clipper/reset', data=b'{}', headers={'Content-Type': 'application/json'}); print(urllib.request.urlopen(req).read().decode())"
   ```

---

## Step 3: Trigger Pre-Flight

Pre-flight performs audio extraction, Whisper transcription, and face framing tracking.

```bash
python -c "import urllib.request, json; data = json.dumps({'url': '<URL>', 'start': '<KEEP_START>', 'end': '<KEEP_END>', 'name': '<CLIP_NAME>', 'title': '<HEADLINE>', 'cut_segments': <CUT_SEGMENTS>, 'style': 'facecam', 'censor': True}).encode('utf-8'); req = urllib.request.Request('http://127.0.0.1:5000/api/clipper/preflight', data=data, headers={'Content-Type': 'application/json'}); print(urllib.request.urlopen(req).read().decode())"
```

*Note: Replace `<CUT_SEGMENTS>` with either `[['00:17:00', '00:17:10']]` or `None`.*
Wait for the response (Pre-flight runs synchronously and returns the preflight report JSON). If it returns an error `{"error": ...}`, report and stop.

---

## Step 4: Trigger Render

Initiate the asynchronous render worker with Stable Audio 3 generation and keyword captions enabled:

```bash
python -c "import urllib.request, json; data = json.dumps({'url': '<URL>', 'start': '<KEEP_START>', 'end': '<KEEP_END>', 'name': '<CLIP_NAME>', 'title': '<HEADLINE>', 'sub_title': '<GUEST_LINE>', 'cut_segments': <CUT_SEGMENTS>, 'bgm_path': 'stable_audio_3', 'bgm_prompt': '<BGM_PROMPT>', 'cut_style': 'evidence_cut', 'keyword_captions': <KEYWORD_CAPTIONS>, 'style': 'facecam', 'censor': True, 'title_bar': True, 'enable_cta': True, 'enable_transitions': True}).encode('utf-8'); req = urllib.request.Request('http://127.0.0.1:5000/api/clipper/render', data=data, headers={'Content-Type': 'application/json'}); print(urllib.request.urlopen(req).read().decode())"
```

*Note: If no custom `bgm_prompt` is in the brief, omit `bgm_path` to use the default library background music. Replace `<KEYWORD_CAPTIONS>` with the list of extracted punch terms (e.g. `['POUNDING', 'POWER GRID', 'NUMBER ONE CONCERN']`) or `None`.*

Expected response: `{"status": "started", "clip_name": "<CLIP_NAME>"}`.

---

## Step 5: Poll Status Until Done

Poll every 20-30 seconds:
```bash
python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:5000/api/clipper/status').read().decode())"
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
