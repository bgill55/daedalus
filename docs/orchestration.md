# Multi-Agent Orchestration & Task Control

Daedalus uses a multi-agent orchestration architecture to plan, delegate, execute, and verify complex coding goals. When you run `/orchestrate <goal>` (or its short aliases: `/orc`, `/run`, `/o`), the orchestrator coordinates sub-agents to divide and conquer the task.

---

## Agent Roles

The orchestrator manages five specialized sub-agents:

1.  **Planner**: Outlines the plan, breaks down the main goal into bite-sized tasks, and defines verification criteria.
2.  **Coder**: Edits existing files, creates new files, and executes commands.
3.  **Researcher**: Explores the codebase, searches the web, and reads documentation.
4.  **Reviewer**: Evaluates code changes, security vulnerabilities, and confirms formatting requirements.
5.  **Debugger**: Runs tests, parses error logs, and corrects syntax or logic failures.

---

## Orchestration Flow & Task Checklist

Upon starting, the orchestrator prints a dynamically wrapped task checklist representing the current plan:

*   `[ ]` **Pending**: Task is queued for execution.
*   `[▶]` **In Progress**: Active sub-agent is running the task.
*   `[✓]` **Completed**: Task completed successfully and changes were verified.
*   `[✗]` **Failed**: Task failed or exceeded its turn budget.
*   `[S]` **Skipped**: User chose to skip the task.

---

## Interactive Failure Checkpoints

If a sub-agent task fails or reaches its turn limit, the orchestrator pauses, displays the failed task, and prompts you to choose a recovery path:

```text
Task failed. Choose action: [r]etry / [e]dit / [s]kip / [a]bort
```

### Recovery Options

*   **`[r]etry`**: Re-runs the task with a clean turn budget. The orchestrator feeds the previous failure logs back to the agent so it can correct its mistake.
*   **`[e]dit`**: Prompts you to rephrase the task goal. This is useful when the agent gets confused, lacks specific instructions, or needs to target a concrete file path.
*   **`[s]kip`**: Skips the failed task and immediately moves on to the next task in the plan.
*   **`[a]bort`**: Halts the execution loop and saves the current state. The session is preserved, allowing you to manually inspect the workspace, modify files, or restart later.

---

## Session Resuming

If an orchestration is aborted or paused, the plan and its task progress are stored in the active session. 

*   To resume the orchestration, run the orchestrate command again: `/o`, `/orc`, or `/orchestrate`.
*   The CLI will detect the pending plan and prompt:
    `Would you like to resume it? [y]es / [n]o`
*   Resuming automatically restores the checklist, marks completed tasks as checked off, and starts execution on the first uncompleted task.

---

## Granular Task Planning

To ensure local models do not exhaust their context or turn budgets, the planner follows strict constraints:
*   Tasks are sized to fit within a **4-turn limit** for the coder agent.
*   Goals are broken down into discrete, file-scoped or function-scoped tasks rather than broad assignments (e.g., "Implement the video generator service in backend/video_service.py" instead of "Implement the backend").
*   Re-planning automatically dedupes completed file targets to prevent duplicate or circular task generation.

---

## Concurrent Background Execution

For independent subtasks, you can spawn background agents using the `/spawn` or `/delegate` commands with the `--bg` flag:

```text
o › /spawn --bg researcher "Find all usages of configDir in src/"
```

*   **Task Management**: View active background tasks via `/tasks`, view detailed logs/results via `/task <id>`, and cancel tasks using `/task kill <id>`.
*   **Prompt-Safe Notifications**: Notifications of completed background tasks are queued and printed right before your next REPL prompt redraw, ensuring your current active workspace is never interrupted.
