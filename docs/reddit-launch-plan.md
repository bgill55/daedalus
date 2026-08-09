# Reddit Launch Plan — Daedalus

Account: 15-year-old, 10k karma (post as yourself, not a brand new account).

## Asset links (use these in posts)
- Repo + docs: https://github.com/bgill55/daedalus
- Docs site (landing): https://bgill55.github.io/daedalus/#/
- Live interactive demo (no install): https://bgill55.github.io/daedalus-lite/live-demo.html
- NotebookLM 3-min walkthrough: https://notebook.google.com/notebook/c9d27926-1a36-49b1-8af5-ab43e626e7fa/artifact/7d56eccf-6eac-4718-83f1-dcd3a6aa83e1?utm_source=nlm_web_share&utm_medium=google_oo&utm_campaign=art_share_1
- Infographic (attach to post body): The_Daedalus_Technical_Ecosystem_Overview.png (now in docs/images/daedalus_ecosystem_overview.png)

## Posting order (1-2 days apart to avoid cross-post spam filter)
1. r/SideProject
2. r/selfhosted
3. r/LOCALLLaMA
4. r/opensource
5. r/commandline (or r/typescript)

## Video comment (post as FIRST reply on every thread)
> For the visual walkthrough, here's a 3-min NotebookLM overview of how Daedalus verifies its own patches and the ecosystem architecture: https://notebook.google.com/notebook/c9d27926-1a36-49b1-8af5-ab43e626e7fa/artifact/7d56eccf-6eac-4718-83f1-dcd3a6aa83e1?utm_source=nlm_web_share&utm_medium=google_oo&utm_campaign=art_share_1
> (Architecture infographic is attached to the post above.)

## VARIANT 1 — r/selfhosted + r/LOCALLLaMA + r/ollama
Title: I built a local-first AI coding CLI that verifies its own patches — and runs 100% on your hardware

Body:
Tired of coding agents that ship broken diffs and call it done. So I built Daedalus — a local-first CLI that runs against Ollama/LM Studio (or your own API keys) with nothing leaving your machine unless you route it out.

What it actually does locally:
- Embedded model router with complexity-based routing + multi-model fallback (point it at your local Ollama/LM Studio models)
- Multi-agent orchestration (/orchestrate, /autopilot) for end-to-end feature branches
- Patch tool runs `tsc --noEmit` + your test suite, and reverts its own broken edits — no "looks good, trust me"
- Hard guardrails: circuit breaker on repeated command failure, batch short-circuit on a failed patch
- Docker/WSL sandboxing so agent commands run isolated from your host

Open source (AGPL). Try it in your browser with zero install — interactive REPL sandbox:
https://bgill55.github.io/daedalus-lite/live-demo.html

Full CLI: `npm install -g daedalus-cli`
Repo + docs: https://github.com/bgill55/daedalus
Docs site: https://bgill55.github.io/daedalus/#/

I made a 3-min NotebookLM walkthrough and a technical ecosystem infographic (attached) if you want the visual version. AMA — what would make a local coding agent actually trustworthy for you?

## VARIANT 2 — r/opensource + r/SideProject
Title: After 3 years of broken agent diffs, I open-sourced the CLI I built to stop lying to itself

Body:
Daedalus is a local-first AI coding CLI (TypeScript/Node, AGPL). The core bet: an agent should verify before it claims done. So the patch tool compiles and tests its own edits and reverts them if they break, and a circuit breaker stops runaway loops.

Differentiators:
- Self-verifying patches (tsc + tests, auto-revert)
- SpecFirst gate + Σ-Mem (verification-weighted memory, not flat chat history)
- FTS5 codebase indexing for symbol-aware search
- Multi-agent orchestration with dynamic sub-agent spawning

Browser demo (no install, free queries): https://bgill55.github.io/daedalus-lite/live-demo.html
Source: https://github.com/bgill55/daedalus
Docs: https://bgill55.github.io/daedalus/#/

I'd genuinely like critique — what's the failure mode you'd expect here, and how would you harden it? (Infographic of the architecture attached.)

## VARIANT 3 — r/commandline + r/typescript + r/node
Title: A terminal-native AI coding agent written in TypeScript — patches itself, reverts its own mistakes

Body:
Daedalus is a CLI (not a GUI, not a VSCode extension) for agentic coding. Built in TypeScript ESM, runs under Node 20+.

The part I cared about as a TS dev: the tool layer is typed, the patch tool diffs pre-edit vs post-edit compiler output so it only flags regressions it introduced, and a guardrail layer halts on repeated failures instead of spinning.

Quick tour in your browser (interactive REPL, no install):
https://bgill55.github.io/daedalus-lite/live-demo.html

Install: `npm install -g daedalus-cli`
Code: https://github.com/bgill55/daedalus
Docs: https://bgill55.github.io/daedalus/#/

There's a 3-min walkthrough (NotebookLM) and an architecture infographic if you'd rather not read the README. Curious what terminal-first workflows you'd want it to support.

## Notes
- Attach the infographic PNG to the post body (image tab in composer) — strongest asset, lead with it.
- Video goes in the first comment (Reddit post bodies rarely accept video embeds).
- Keep posts value-first; the $19 Daedalus-Lite starter kit lives inside the live demo, not in the post, so self-promo rules stay clean.
- r/LOCALLLaMA / r/selfhosted are receptive but check each sub's "no promotional" rule before posting.
