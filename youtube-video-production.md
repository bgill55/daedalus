# YouTube Video Script: Daedalus CLI Overview

This file is structured for automated video generation tools or voiceover/screenplay scripts. It includes slide outlines, visual prompts (GFX), and voiceover narration (VO).

---

## Metadata
- **Suggested Video Title:** This Local-First AI Coding Assistant Changes Everything (Daedalus CLI)
- **Alt Title:** Goodbye Cursor? Meet Daedalus TUI
- **Target Duration:** ~5-7 minutes
- **Keywords:** local AI coding assistant, daedalus cli, local LLM coding, ollama coding agent, lm studio coder, terminal coding dashboard, open source ai agent

---

## Scene 1: The Hook (0:00 - 0:45)
- **GFX:** Fast compilation of code editor, high credit card bills, and "API Error: Rate Limit Exceeded" messages.
- **VO:** Let's be honest. AI coding tools are incredible, but they have three major problems: they leak your proprietary code to remote servers, they charge you per-token pricing that adds up fast, and they lock you into a single provider. But what if you could run a state-of-the-art coding agent entirely on your local machine, routing tasks between local models, with a gorgeous interactive terminal dashboard? Meet Daedalus.

---

## Scene 2: What is Daedalus? (0:45 - 1:45)
- **GFX:** Terminal boot sequence showing the Daedalus ascii banner and local routing health checks starting up.
- **VO:** Daedalus is a local-first, terminal-based AI coding assistant. It connects directly to local inference backends like Ollama, LM Studio, llama.cpp, or vLLM—while supporting remote engines like OpenAI and Anthropic as fallbacks. Instead of a simple prompt-and-response loop, Daedalus is an autonomous agent equipped with tools to read, write, edit, and debug your workspace.

---

## Scene 3: The Multi-Agent Orchestration Loop (1:45 - 2:45)
- **GFX:** Flowchart of a task starting → Planner splits the steps → Coder drafts → Reviewer checks → Test suite validates.
- **VO:** Daedalus excels at multi-agent orchestration. When you give it a complex goal, it spawns specialized sub-agents. The Planner outlines the blueprint, the Coder writes the implementation, the Reviewer inspects the diffs, and the Debugger runs tests to fix failures before they ever hit your repository. It even includes a full codebase indexer that scans your symbols in TypeScript, Python, Go, and Rust so the agent actually understands your file context.

---

## Scene 4: Deep Dive: The New TUI Dashboard (2:45 - 4:30)
- **GFX:** Video or screenshots of the side-by-side terminal dashboard in action, showcasing system resource monitors and file toggle checks.
- **VO:** In the latest release, Daedalus introduces a premium terminal-based dashboard. Run `daedalus --tui` and you are greeted with a side-by-side cockpit. On the left is your active chat console where you can chat and watch tool logs stream. On the right, the sidebar shows real-time CPU and Memory gauges to watch your system load during local inference. Below the stats, you can instantly switch the active model routing in real-time. And at the bottom, an interactive, lazy-loaded file tree lets you toggle file inclusion into your prompt context with a single click.

---

## Scene 5: Tool Power & Safety Guardrails (4:30 - 5:30)
- **GFX:** Command prompts illustrating code patching, git status checks, and a sandbox safety warning popup.
- **VO:** Daedalus isn't just smart—it's safe. It has built-in git integration to commit and rollback code patches, web search to pull fresh documentation, and a trust layer that prompts you for permission before executing destructive terminal commands. For advanced users, it even supports sandbox execution inside Docker containers, keeping your host system completely clean.

---

## Scene 6: Outro (5:30 - END)
- **GFX:** Quick commands to install from npm and github link page.
- **VO:** Best of all, Daedalus is open-source and ready right now. Just run `npm install -g daedalus-cli` to start coding locally today. Check out the GitHub repository, star the project, and subscribe for more open-source AI tools. Happy coding!
