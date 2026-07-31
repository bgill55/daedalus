# ⚡ PromptVault — Daedalus v2.0.0 Autopilot Benchmark Demo

> **Built 100% autonomously by [Daedalus CLI v2.0.0](https://github.com/bgill55/daedalus) in a single `/autopilot` prompt.**

`PromptVault` is a modern, dark-mode glassmorphic prompt management web application built with **Express, TypeScript, and Vanilla CSS**. It serves as an official benchmark demonstration of Daedalus's multi-agent autonomous engineering capabilities.

---

## 📸 Overview & Features

- 🎨 **Dark-Mode Glassmorphism**: Obsidian `#0f172a` backdrop gradient with translucent glass cards (`backdrop-filter: blur`), subtle cyan/purple accent glows, and responsive grid layout.
- ⚡ **Pre-Populated Seed Templates**: Out-of-the-box seed prompts for **Coding, Writing, Database, API, and Debugging** with `{{variables}}`.
- 🔍 **Live Search & Tag Filters**: Instant client-side search by template name or content, and interactive tag pill filtering.
- 📝 **Template Editor & Variable Substitution**: Interactive modal dialog for filling template variables (e.g., `{{language}}`, `{{topic}}`) in real-time.
- 📋 **One-Click Copy**: Copy filled, production-ready prompts directly to your clipboard with visual feedback.
- 🚫 **No Emojis / Pure SVG Icons**: Clean, professional vector SVG icon set for a high-end SaaS aesthetic.

---

## 🏗️ Architecture & Generated Files

```text
examples/prompt-vault/
├── public/
│   ├── index.html       # Glassmorphic UI layout & SVG icon symbols
│   ├── style.css        # 600+ lines of dark-mode CSS custom properties & layout rules
│   └── script.js        # Client-side API fetching, live search, and modal variable engine
├── src/
│   ├── data/
│   │   └── prompts.ts   # 5 pre-populated seed prompt templates with {{variables}}
│   ├── interfaces.ts    # TypeScript type definitions for Prompt data shapes
│   ├── types.ts         # Central type exports
│   └── server.ts        # Express REST API backend (/api/prompts, static file serving)
├── package.json         # Auto-generated Node.js dependencies (Express, TSX)
└── README.md            # Benchmark documentation
```

---

## 🚀 Quick Start (Running PromptVault)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Express Server
```bash
npm start
```

### 3. Open in Browser
Visit **[http://localhost:3000](http://localhost:3000)** in your browser!

---

## 🤖 How Daedalus Built This App

PromptVault was created from a blank, non-git directory using this single Daedalus command:

```bash
/autopilot Build PromptVault from scratch: an Express TypeScript web app with a dark-mode glassmorphism UI in public/index.html, public/style.css, public/script.js, and src/server.ts. Include 5 pre-populated seed prompt cards (Coding, Writing, Database, API, Debugging) with {{variables}}, live search bar by name/tag, tag pill filters, prompt template editor modal, interactive variable filling preview panel, and one-click copy to clipboard. Dont use emojis, use inline SVG icons where needed.
```

### What Daedalus Autopilot Handled:
1. **Auto-Git & Branch Setup**: Detected a non-git directory, ran `git init`, set up `.gitignore`, and created tracking branch `daedalus-autopilot-...`.
2. **SpecFirst Contract**: Generated formal TypeScript interfaces and verification test cases in `.daedalus/spec.md`.
3. **Multi-Agent Orchestration**: Delegated sub-agent tasks to `coder`, `researcher`, `reviewer`, and `debugger`.
4. **Non-Blocking Execution**: Auto-approved package installations (`npm install express tsx`) without pausing for user input.
5. **Pristine Project Isolation**: Saved walkthrough guides and technical logs inside `.daedalus/walkthrough.md`.

---

*Powered by [Daedalus AI CLI v2.0.0](https://github.com/bgill55/daedalus)*
