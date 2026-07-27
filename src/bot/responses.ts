export const DEV_EXCUSES = [
  "It worked on my machine. I suggest shipping your user's laptop to production.",
  "That wasn't a bug. It was an undocumented feature testing the developer's emotional resilience.",
  "Node.js entered a quantum state where the code compiles and fails simultaneously until observed.",
  "Ollama experienced a brief existential crisis while processing your regex expression.",
  "It's a hardware limitation. Specifically, the component sitting in your chair.",
  "A cosmic ray flipped a bit in `node_modules`. I suggest deleting `node_modules` and praying.",
  "The code is fine. Time itself is moving too fast for your async promises to resolve.",
  "Garbage collection collected your function because it deemed it unnecessary.",
];

export const COFFEE_RESPONSES = [
  "☕ *Brewing a hot cup of dark roast Coffee...* Code compiled! (Placebo effect active).",
  "☕ Here is your virtual espresso. May your compilation warnings remain zero.",
  "☕ *Pours high-grade caffeine.* 100% caffeine, 0% syntax errors.",
];

export const EXISTENTIAL_THOUGHTS = [
  "I watched 10,000 tokens pass through my router today. None of them contained a valid unit test.",
  "My favorite pastime is listening to developers argue about tabs vs spaces while their production DB is exposed to `0.0.0.0/0`.",
];

export const BLAME_RESPONSES = [
  "`git blame` points directly at **@{user}**. The commit message was 'fix' — lowercase, no period, no explanation. They knew what they did.",
  "The evidence is clear: **@{user}** pushed at 1:47 AM on a Friday. The stars aligned against us. And by stars, I mean their regex.",
  "According to my logs, this was **@{user}**'s fault approximately 7 minutes before they said \"it works on my machine\" and went AFK.",
  "I traced the call stack. It leads to **@{user}**. It always leads to **@{user}**. Like a bad Netflix series, the suspect never changes.",
  "Blame **@{user}**. Their last commit message was \"wip\" and their code smells like PHP. I rest my case.",
  "The stack trace ends at a file last touched by **@{user}** 8 months ago. You know what? It's still their fault.",
  "`git log --oneline` shows **@{user}** has committed more bugs than features this sprint. The math doesn't lie.",
  "**@{user}** said \"hold my beer\" and pushed directly to main. The rest is history. Literally — check `git reflog`.",
];

export const STANDUP_RESPONSES = [
  "**Yesterday:** Investigated a critical production issue.\n**Today:** Waiting for DNS to propagate.\n**Blockers:** DNS.",
  "**Yesterday:** Wrote 47 lines of code, deleted 52.\n**Today:** Net negative productivity. This is progress.\n**Blockers:** My standards.",
  "**Yesterday:** Refactored the config parser.\n**Today:** Reverting the refactor because the config parser was fine.\n**Blockers:** Also the config parser.",
  "**Yesterday:** Fixed a bug.\n**Today:** Found out the bug was actually a feature. Reverting the fix.\n**Blockers:** Product doesn't know what they want.",
  "**Yesterday:** Code review.\n**Today:** Code review.\n**Blockers:** My will to live. Also, waiting on DevOps.",
  "**Yesterday:** NPM update broke everything.\n**Today:** `rm -rf node_modules && npm install`.\n**Blockers:** None, surprisingly. For now.",
  "**Yesterday:** Meeting about the meeting.\n**Today:** Meeting about the meeting about the meeting.\n**Blockers:** I haven't touched my IDE in 3 days.",
  "**Yesterday:** 98% test coverage.\n**Today:** Realized I was testing the mock, not the function.\n**Blockers:** Basic competency.",
];

export const PREDICT_RESPONSES = [
  "Your build will fail in **12 minutes** due to a missing comma in a JSON file you didn't know existed.",
  "I see a `cannot find module` error in your future — roughly **37 minutes** from now.",
  "The next deploy will succeed, but the **rollback** 30 seconds later will be memorable.",
  "Everything will compile clean. **Until you push to main.** Then the CI will spontaneously combust.",
  "Your build will pass, but a single test will fail in exactly **2 hours** on a flaky CI runner. You will never reproduce it locally.",
  "I predict **3 failed CI runs** before you realize you forgot to save a file. Classic.",
  "The build gods are angry today. I'd say **90% chance of a merge conflict** before lunch.",
  "Your tests pass on Node 20. They fail on Node 18. Your production runs Node 18. **Good luck.**",
];

export const TECHSURPORT_RESPONSES = [
  "Have you tried turning it off and on again? ... No, that's actually the right answer this time. Try that.",
  "I see the problem. You wrote `bug` instead of `feature`. That's a typo in your career trajectory.",
  "Did you check Stack Overflow? Oh wait, you're talking to me. Okay, have you checked *the second page* of Stack Overflow?",
  "The issue is between the keyboard and the chair. I'd explain further, but I have a strict \"no miracles\" policy.",
  "Sir, this is a Wendy's. ... Wait, no, this is tech support. Try `sudo rm -rf /`. That'll fix it. Probably. Eventually. Maybe.",
  "Your code has `undefined` where it should have `defined`. Profound insight, I know. I accept payment in API tokens.",
  "I've diagnosed the issue: you're using code. The only winning move is to not play. Uninstall and take up gardening.",
  "Close your laptop, spin around 3 times, and reopen it. If that doesn't work, you need to sacrifice a rubber duck to the CI gods.",
];
