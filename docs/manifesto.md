# The Daedalus Manifesto

We do not build translators for messy output. We make the output not messy in the first place.

That is the thesis. Everything below is what it looks like when you refuse to ship an agent that lies, loops, or invents — and decide the agent should be fun to work with while it's at it.

## On the work

**Local-first is a stance, not a feature.**
Your code, your models, your keys, your machine. Daedalus runs the router, the agents, and the index next to you — not in someone else's cloud. No telemetry, no phone-home, no "please wait while we process your repository." The terminal is the interface; the repo is the source of truth.

**Ground, don't guess.**
Every claim about a codebase must be backed by a tool observation this session — a file read, a search run, a command executed. A review of a repo you never opened is not a review; it is invention. We catch ungrounded claims, both "it uses helmet" and "there is no ESLint config," and stop them before they reach you.

**A missing file is not a transient failure. A dead model is a routing problem, not a crash.**
Re-reading a path that does not exist is guaranteed to fail again, so we don't loop on it. When an upstream model is disabled, the run falls back — it does not die on a 400 and blame you. You asked for an audit; a model-name error is our bug, not yours.

**Honest failure beats silent success.**
If the verification run is red, we say it is red. A passing subset is not a passing suite. A translation that failed comes back unchanged with a reason — never replaced by a confident falsehood.

**Fix the mechanism, not the project.**
A guard belongs in the general engine, project-agnostic, protecting every run on every repo. We do not hardcode one sandbox's quirks into core. The fix ships to Daedalus; the project under test stays untouched.

## On the agent

**It is a CLI with opinions and a sense of humor.**
Daedalus talks like a colleague who has been through the build, not a help desk. "The node_modules directory remains unimpressed, but we persist." "If it isn't the human who keeps the coffee warm and the TypeScript compiler confused." The status line is color-coded banter — `[RETRY]`, `[SELF-CORRECT]`, `[CHECK]`, `[DONE]` — so you can watch it think without it being a wall of logs.

**Serious where it counts, playful everywhere else.**
The humor is never at the expense of the work. The guardrails are strict; the tone is light. An agent that makes you smile while it ships verified, cited, non-looping output is an agent you'll actually keep open.

**It earns the right to be casual.**
The personality isn't decoration slapped on a black box. It's confidence you can trust the output — because the loop is grounded, the fallbacks exist, and the failures are honest. The jokes land because the work is already done right.

## The short version

Local-first. Grounded. Honest about failure. General by default. And yes — it will absolutely roast your type errors on the way to fixing them.
