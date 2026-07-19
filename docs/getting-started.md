# Getting Started

Welcome to Daedalus, a local-first, terminal-based AI coding assistant. This guide will walk you through the requirements, installation, and first-time setup process to get you up and running quickly.

<p align="center">
  <video src="images/Daedalus__AI_Coding_Assistant.mp4" width="100%" controls></video>
</p>

---

## Requirements

Before installing Daedalus, make sure your environment meets the following requirements:

*   **Node.js**: Version 20 or higher is required.
*   **Operating System**: Windows, macOS, or Linux.
*   **LLM Backend**: You will need either a local LLM runner or a remote API key.
    *   **Local Providers**: LM Studio, Ollama, llama.cpp, or vLLM running on your local machine.
    *   **Remote Providers**: API keys for Anthropic, OpenAI, OpenRouter, or Groq.

---

## Installation

### Globally via NPM

The easiest way to install Daedalus is globally using npm:

```bash
npm install -g daedalus-cli
```

Once installed, you can start the assistant by typing:

```bash
daedalus
```

To run with the interactive terminal dashboard layout (recommended):

```bash
daedalus --tui
```

### From Source

If you prefer to run or develop Daedalus from source:

1.  Clone the repository:
    ```bash
    git clone https://github.com/bgill55/daedalus.git
    cd daedalus
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Build the project:
    ```bash
    npm run build
    ```
4.  Run from the build output:
    ```bash
    node dist/index.js
    ```
    Or link the binary globally for local development:
    ```bash
    npm link
    daedalus
    ```

---

## First-Time Setup & Onboarding

When you run Daedalus for the first time, it automatically starts the onboarding wizard to configure your LLM connections:

1.  **Local LLM Discovery**: The wizard scans your local ports to find running servers (Ollama, LM Studio, etc.).
2.  **Remote Provider Setup**: If no local models are detected or if you prefer to use remote LLMs, the wizard will prompt you to configure API keys for services like Anthropic or OpenAI.
3.  **Tier Assignment**: Daedalus configures model tiers (such as assigning a higher-intelligence model for planning/reviewing tasks and a faster model for execution).

### Manual Onboarding

If you need to reconfigure your models or rerun the initial setup at any time, run the following command inside the Daedalus interactive shell:

```text
/onboard
```

---

## Basic Workflow

Once you are in the Daedalus shell, you can start coding and collaborating with the assistant using these steps:

### 1. Add Files to Context
Before asking questions about your codebase, add the relevant files to the active prompt context:
```text
/add path/to/file.ts
```

To see what files are currently in your context, use:
```text
/context
```

### 2. Run Commands
You can execute shell commands directly from the prompt or ask the agent to run them for you.

### 3. Orchestrate Complex Goals
For multi-step, autonomous tasks (such as writing tests, implementing a feature, or debugging), invoke the orchestration system:
```text
/orchestrate implement a health check endpoint under /health
```
This spawns a multi-agent workflow (Planner, Coder, Reviewer) to carry out the task autonomously.

### 4. View Available Commands
For a complete list of commands and utilities, run:
```text
/help
```
To get detailed manuals, parameter lists, subcommands, and config options for any specific command, run:
```text
/help <command>
```
For example, `/help config` lists all global configuration keys, and `/help mcp` lists all Model Context Protocol management options.

---

## Security & Sandboxing

By default, Daedalus runs command-line tools directly on your host machine. If you are working on untrusted codebases or want to ensure a clean build environment, you can isolate the execution sandbox. 

Daedalus supports sandboxing via:
*   **Docker**: Runs commands inside a container while mapping your project root directory.
*   **WSL (Windows Subsystem for Linux)**: Runs commands in a native Linux environment on Windows.

To learn how to enable and configure these environments, see the [Execution Sandboxing & Shell Configuration Guide](sandboxing.md).

