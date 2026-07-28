# /feedback Command Documentation

## Overview

The `/feedback` command provides a privacy-first, zero-friction path for users to report bugs or request features directly from the Daedalus CLI. It automatically collects local environment metadata, sanitizes all sensitive information (keys, file paths, personal context), formats a structured markdown payload, and routes it to GitHub or Discord.

## Command Signature

```bash
/feedback [bug|feature]
```

## User Experience & CLI Flow

### Interactive Steps

1. **Selection**: If no subcommand is passed, prompt:
   ```
   What would you like to submit?
   [1] Bug Report
   [2] Feature Request
   ```

2. **User Input**:
   - **Title**: A short headline (e.g., "Model router failed over during long context prompt")
   - **Description**: A brief explanation of what happened or what's needed
   - **Include Session Trajectory?** [Y/n] (Only for bug reports—attaches recent anonymized agent logs if recent errors occurred)

3. **Privacy Scrub Notice**: Display a quick preview of sanitized diagnostic data:
   ```
   [Diagnostics Captured]
   • OS: linux (x64)
   • Node: v20.11.0
   • Active Tier: intelligence (local-llm)
   • Sensitive data scrubbed: 3 local path strings, 1 API token pattern
   ```

4. **Dispatch Options**:
   - [1] Open pre-filled GitHub Issue (Browser)
   - [2] Copy pre-formatted Markdown to Clipboard
   - [3] Direct Post to Community Discord (if Webhook configured)

## System Architecture & Component Interactions

```
┌───────────────────────────┐
│    /feedback User Input   │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│   System Diagnostics      │
│   (OS, Node, Router, TUI) │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│   Privacy Sanitizer       │
│ - Strip Paths (~/User/..) │
│ - Mask API Keys/Tokens    │
│ - Remove Repo Names/URLs  │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│   Markdown Payload Builder │
└─────────────┬─────────────┘
              │
┌─────────────┼─────────────┐
│             │             │
▼             ▼             ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Browser  │ │ Clipboard│ │ Discord  │
│ (GitHub) │ │          │ │ Webhook  │
└──────────┘ └──────────┘ └──────────┘
```

## Technical Implementation & Privacy Guardrails

### Privacy Sanitizer Engine

Before any payload leaves the machine, run string replacements over diagnostic logs and context snippets using strict regex filters:

#### Home Directory & Local Paths
Replace all occurrences of process environment home directory paths (e.g., `/Users/username/projects/my-app` or `C:\Users\username\...`) with `<workspace_root>` or `~/<redacted>`.

#### API Keys & Credentials
- **OpenAI/Anthropic/Groq key patterns**: `sk-[a-zA-Z0-9_-]{20,}` → `[REDACTED_API_KEY]`
- **Generic Bearer tokens / Basic Auth headers** → `[REDACTED_TOKEN]`

#### Git Remotes
Strip origin URLs containing private GitHub usernames or private enterprise domains.

### Generated Markdown Template

```markdown
## Overview
<!-- User description goes here -->

## Environment Diagnostics
- **Daedalus CLI Version:** v1.x.x
- **OS Platform:** darwin (arm64)
- **Node Version:** v20.10.0
- **Active Router Strategy:** priority
- **Primary Model Tier:** intelligence (`local-llm` @ `localhost:1234`)
- **TUI Enabled:** false

<details>
<summary>Sanitized System Diagnostics Output</summary>

```json
{
  "arch": "arm64",
  "memoryUsage": "42%",
  "activeMcpServers": ["sqlite", "github"],
  "lastErrorTrace": "<redacted_stack_trace_if_applicable>"
}
```

</details>
```

## Documentation Updates

This documentation is automatically synchronized with the codebase. To update this document after code changes, run:

```bash
npm run sync-docs
```

This ensures the documentation stays current with the latest implementation details and features.