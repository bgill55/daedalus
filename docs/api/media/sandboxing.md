# Execution Sandboxing & Shell Configuration

By default, Daedalus executes terminal commands directly on your host machine. For isolated environments or cross-platform command translation, you can configure Docker or Windows Subsystem for Linux (WSL) sandboxing.

---

## Docker Sandbox

Running commands inside a Docker container prevents local execution side effects and ensures a clean build environment.

### Configuration

Add the following to your `~/.daedalus/config.json`:

```json
{
  "tools": {
    "sandbox": "docker",
    "sandboxImage": "node:20"
  }
}
```

*   **`sandbox`**: Set to `"docker"`.
*   **`sandboxImage`**: The Docker image to spin up (defaults to `"node:20"`). You can change this to any image containing your project's compile/run dependencies (e.g., `"python:3.11"`, `"golang:1.21"`, `"rust:1.75"`).

### How it Works
When a terminal tool runs, Daedalus spins up a container using the configured image. It automatically mounts your project root directory to `/workspace` inside the container and sets it as the working directory. Any file creations or modifications made inside the container reflect instantly on your host filesystem.

---

## WSL Sandbox (Windows Only)

For Windows developers who prefer building and running code in a native Linux environment, Daedalus supports sandboxing via Windows Subsystem for Linux.

### Configuration

Add the following to your `~/.daedalus/config.json`:

```json
{
  "tools": {
    "sandbox": "wsl",
    "wslDistribution": "Ubuntu"
  }
}
```

*   **`sandbox`**: Set to `"wsl"`.
*   **`wslDistribution`**: The installed WSL distribution name (e.g., `"Ubuntu"`, `"Debian"`, `"Alpine"`).

### How it Works
When a terminal tool runs on Windows, Daedalus routes the command through WSL. It automatically translates Windows absolute directory paths (e.g., `D:\project\src`) into their WSL equivalent paths (e.g., `/mnt/d/project/src`) so that commands execute in the correct directories.

---

## Shell Preference Configuration

You can customize the command-line shell used by the terminal executor. Daedalus resolves shell preferences in the following order of priority:

1.  **Environment Variable**: Looks for `DAEDALUS_SHELL` or fallback `SHELL`.
2.  **Configuration File**: Looks for `"shell"` under `"tools"` in `~/.daedalus/config.json`.

```json
{
  "tools": {
    "shell": "powershell"
  }
}
```

### Supported Shells
*   `powershell` or `pwsh`
*   `cmd` (Windows Command Prompt)
*   `bash` (or other Unix shell paths like `/bin/zsh`, `/bin/sh`)
*   Any absolute executable path to a custom shell.
