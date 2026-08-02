# Configuration Reference Guide

This guide describes all configuration options available in Daedalus. You can view them using the `/config` command and update them using the `/config set <key> = <value>` command. All settings updated via the command line are validated and applied instantly in real-time without requiring a CLI restart.

---

## Router Settings

*   **`router.strategy`**: (Description needed)
*   **`router.chain`**: (Description needed)
*   **`router.healthCheckInterval`**: (Description needed)
*   **`router.requestTimeout`**: (Description needed)
*   **`router.defaultRateLimit`**: (Description needed)
*   **`router.autoEscalate`**: (Description needed)
*   **`router.complexityRouting`**: (Description needed)

---

## Agent Settings

*   **`agents.default`**: (Description needed)
*   **`agents.available`**: (Description needed)
*   **`agents.autoOrchestrate`**: (Description needed)
*   **`agents.ensemble`**: (Description needed)

---

## Tool Settings

*   **`tools.builtin`**: (Description needed)
*   **`tools.mcpServers`**: (Description needed)
*   **`tools.shell`**: (Description needed)
*   **`tools.sandbox`**: (Description needed)
*   **`tools.sandboxImage`**: (Description needed)
*   **`tools.wslDistribution`**: (Description needed)

---

## Image Generation Settings

*   **`imageGen.enabled`**: Enable/disable local image generation tool and commands (default: true).
*   **`imageGen.provider`**: Image generation engine ("auto", "sd-webui", or "pollinations"). Defaults to "auto" (attempts local SD WebUI first, falling back to free Pollinations AI).
*   **`imageGen.endpoint`**: Local Stable Diffusion WebUI API endpoint URL (default: "http://127.0.0.1:7860").
*   **`imageGen.defaultWidth`**: Default image width in pixels (default: 512).
*   **`imageGen.defaultHeight`**: Default image height in pixels (default: 512).
*   **`imageGen.defaultSteps`**: Default sampling steps for image generation (default: 20).
*   **`imageGen.outputDir`**: Default directory to save generated PNG images (default: "./assets/images").

---

## Context Settings

*   **`context.maxTokens`**: (Description needed)
*   **`context.summarizeAt`**: (Description needed)
*   **`context.includeGitDiff`**: (Description needed)
*   **`context.includeIndex`**: (Description needed)

---

## Codebase Indexing Settings

*   **`indexing.enabled`**: (Description needed)
*   **`indexing.watch`**: (Description needed)
*   **`indexing.languages`**: (Description needed)
*   **`indexing.exclude`**: (Description needed)

---

## Session Settings

*   **`session.autoSave`**: (Description needed)
*   **`session.exportJsonl`**: (Description needed)
*   **`session.maxHistoryTurns`**: (Description needed)

---

## UI Settings

*   **`ui.streaming`**: (Description needed)
*   **`ui.showTokens`**: (Description needed)
*   **`ui.showCost`**: (Description needed)
*   **`ui.diffStyle`**: (Description needed)
*   **`ui.theme`**: (Description needed)
*   **`ui.tui`**: (Description needed)
*   **`ui.compactMode`**: (Description needed)
*   **`ui.collapseCommentary`**: (Description needed)

---

## Safety Settings

*   **`safety.protectGit`**: (Description needed)
*   **`safety.autoApprove`**: (Description needed)

---

## Update Settings

*   **`updateCheck`**: (Description needed)
