# Daedalus Discord Bot & Webhook Integration

Daedalus includes built-in support for running a **community/team Discord Bot** powered by the LocalRouter engine, as well as **Discord Webhook Notifications** for autonomous coding loops (`/spec` and `daedalus --loop`).

---

##  1. Running the Daedalus Discord Bot

You can host your own Daedalus AI assistant inside your team or community Discord server.

### Prerequisites & Setup

1. Create a Bot in the [Discord Developer Portal](https://discord.com/developers/applications):
   - Enable **Message Content Intent** under the Bot settings.
   - Generate a Bot Token.
2. Set the token in your environment or `.env` file:
   ```bash
   export DISCORD_BOT_TOKEN="your-discord-bot-token-here"
   ```
3. Start the bot:
   ```bash
   npm run bot
   ```

### Discord Bot Features

* **Slash Commands**:
  - `/ask [question]` — Ask Daedalus anything using your configured LocalRouter model chain.
  - `/roast [topic]` — Get a deadpan, witty roast of a framework or code snippet.
  - `/tip` — Receive sharp, practical TypeScript/Node.js coding tips.
  - `/commit` — Generate plausible yet hilarious git commit messages.
  - `/horoscope` — Daily developer horoscope based on real coding concepts.
  - `/recipe [goal]` — Quick "how do I X in Y" code recipes.
  - `/quote` — Original Daedalus developer quotes and cynical one-liners.
  - `/blame` — Playful build failure analysis and dev banter.
* **Multimodal Vision Support**: Attach code screenshots or architecture diagrams to any message in Discord. If a vision-capable model (like `gemini-2.5-flash` or `gemma-4-e4b`) is in your router chain, Daedalus analyzes the image directly!
* **Live Release Awareness**: The bot dynamically reads `package.json` and recent `CHANGELOG.md` entries on every message turn, so it always knows current CLI features, latest versions, and bug fixes out of the box!

---

##  2. Discord Webhook Notifications (Autonomous Loop)

When running the autonomous **Finn Loop** (`/spec` and `daedalus --loop`), Daedalus can post real-time, color-coded embed updates directly to your Discord channel.

### Setting Up Webhooks

Set your webhook URL in `.env` or in `~/.daedalus/config.json`:

```bash
# In .env
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/123456789/abcxyz..."
```

Or via CLI configuration:
```bash
/config set discordWebhook = "https://discord.com/api/webhooks/123456789/abcxyz..."
```

### Real-Time Event Embeds

When active, the loop automatically sends notifications for:
-  **Spec Queued**: Sent when `/spec` generates an implementation-ready issue on GitHub.
-  **Work Started**: Sent when `daedalus --loop` picks up an issue and begins orchestration.
-  **Review Gate Alert**: Sent if an automated self-review gate flags issues or reverts a failing build.
-  **PR Ready**: Sent when orchestration and self-review pass cleanly, with clickable links to the Issue, Branch, and Pull Request.

---

##  Privacy & Security

- **No Hardcoded Tokens**: All tokens (`DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`) are read strictly from environment variables or local user configs.
- **Open-Source Friendly**: The published npm package (`daedalus-cli`) includes only compiled core binaries. Discord bot features remain 100% optional for developers building from source or deploying custom bots.
