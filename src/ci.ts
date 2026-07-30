import fs from 'fs';
import path from 'path';
import { execute as termExec } from './tools/builtin/terminal.js';
import { ToolContext } from './types.js';

export interface CiReviewResult {
  passed: boolean;
  typeCheckPassed: boolean;
  lintPassed: boolean;
  testsPassed: boolean;
  summary: string;
  markdownReport: string;
}

export async function runHeadlessCiReview(
  projectRoot: string = process.cwd(),
  baseBranch: string = 'main'
): Promise<CiReviewResult> {
  const dummyContext: ToolContext = {
    projectRoot,
    activeFiles: new Map(),
    sessionId: 'ci-session',
    projectHash: 'ci-hash',
    agentRole: 'coder',
    get abortSignal() { return new AbortController().signal; },
  };

  let typeCheckPassed = true;
  let lintPassed = true;
  let testsPassed = true;
  let typeCheckOutput = '';
  let lintOutput = '';
  let testsOutput = '';

  // 1. Run tsc check if tsconfig.json exists
  if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
    const tscRes = await termExec({ command: 'npx tsc --noEmit', timeout: 60, workdir: projectRoot }, dummyContext);
    typeCheckPassed = tscRes.success;
    typeCheckOutput = tscRes.content || tscRes.error || '';
  }

  // 2. Run lint if package.json has lint script
  if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      if (pkg.scripts?.lint) {
        const lintRes = await termExec({ command: 'npm run lint', timeout: 60, workdir: projectRoot }, dummyContext);
        lintPassed = lintRes.success;
        lintOutput = lintRes.content || lintRes.error || '';
      }
    } catch {
      // Ignore JSON parse errors in tests or edge cases
    }
  }

  // 3. Run test suite to catch functional regressions
  if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      if (pkg.scripts?.test) {
        const testRes = await termExec({ command: 'npm test', timeout: 120, workdir: projectRoot }, dummyContext);
        testsPassed = testRes.success;
        testsOutput = testRes.content || testRes.error || '';
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  // 4. Run git diff against base branch to inspect touched files
  let diffSummary = '';
  let diffPatch = '';
  const diffStatRes = await termExec({ command: `git diff --stat origin/${baseBranch}...HEAD`, timeout: 15, workdir: projectRoot }, dummyContext);
  if (diffStatRes.success && diffStatRes.content) {
    diffSummary = diffStatRes.content.trim();
  }

  const diffPatchRes = await termExec({ command: `git diff origin/${baseBranch}...HEAD -- "*.ts" "*.js"`, timeout: 15, workdir: projectRoot }, dummyContext);
  if (diffPatchRes.success && diffPatchRes.content) {
    diffPatch = diffPatchRes.content.trim();
  }

  // 5. AI semantic diff analysis — Daedalus reads the actual diff and flags logic bugs
  let semanticFindings = '';
  if (diffPatch) {
    try {
      const { createRouter } = await import('./router/index.js');
      const { loadConfig } = await import('./config/index.js');
      const config = loadConfig();
      const router = createRouter(config.router);

      const truncatedDiff = diffPatch.slice(0, 8000);
      const aiRes = await router.chat.completions.create({
        model: 'intelligence',
        messages: [
          {
            role: 'system',
            content: `You are an expert code reviewer. Analyze the following git diff for semantic bugs, contract mismatches (e.g. JSDoc stating rules different from regex or code logic), AGENTS.md rule violations (redundant inline comments restating obvious code flow), schema mismatches, unreachable code paths, and logic errors.
Be concise. Format findings as a numbered markdown list.
If no bugs are found, respond with exactly: "No semantic issues found."`,
          },
          {
            role: 'user',
            content: `Review this diff:\n\`\`\`diff\n${truncatedDiff}\n\`\`\``,
          },
        ],
        temperature: 0.1,
      });
      semanticFindings = aiRes.choices[0]?.message?.content?.trim() || '';
    } catch {
      semanticFindings = '';
    }
  }

  const passed = typeCheckPassed && lintPassed && testsPassed;

  let markdownReport = `## 🤖 Daedalus Automated PR Review\n\n`;
  markdownReport += `**Overall Status**: ${passed ? '✅ PASSED' : '❌ ACTION REQUIRED'}\n\n`;
  markdownReport += `### 🔍 Verification Checks\n`;
  markdownReport += `- **Type Check (\`npx tsc\`)**: ${typeCheckPassed ? '✅ Passed' : '❌ Failed'}\n`;
  markdownReport += `- **Linter (\`npm run lint\`)**: ${lintPassed ? '✅ Passed' : '❌ Failed'}\n`;
  markdownReport += `- **Test Suite (\`npm test\`)**: ${testsPassed ? '✅ Passed' : '❌ Failed'}\n\n`;

  if (diffSummary) {
    markdownReport += `### 📊 Changed Files\n\`\`\`\n${diffSummary}\n\`\`\`\n\n`;
  }

  if (semanticFindings && semanticFindings !== 'No semantic issues found.') {
    markdownReport += `### 🧠 Daedalus Semantic Analysis\n${semanticFindings}\n\n`;
  } else if (semanticFindings === 'No semantic issues found.') {
    markdownReport += `### 🧠 Daedalus Semantic Analysis\n✅ No semantic issues found.\n\n`;
  }

  if (!typeCheckPassed) {
    markdownReport += `### ⚠️ Type Check Failures\n\`\`\`\n${typeCheckOutput.slice(0, 1000)}\n\`\`\`\n\n`;
  }

  if (!lintPassed) {
    markdownReport += `### ⚠️ Lint Warnings/Errors\n\`\`\`\n${lintOutput.slice(0, 1000)}\n\`\`\`\n\n`;
  }

  if (!testsPassed) {
    markdownReport += `### ⚠️ Test Failures\n\`\`\`\n${testsOutput.slice(0, 2000)}\n\`\`\`\n\n`;
  }

  markdownReport += `---\n*Automated review generated by [Daedalus CLI](https://github.com/bgill55/daedalus)*\n`;

  const { formatMarkdownPRReply } = await import('./formatting.js');
  const cleanReport = formatMarkdownPRReply(markdownReport);

  return {
    passed,
    typeCheckPassed,
    lintPassed,
    testsPassed,
    summary: passed ? 'All PR checks passed successfully.' : 'PR checks failed verification.',
    markdownReport: cleanReport,
  };
}

export async function runHeadlessCiFix(
  projectRoot: string = process.cwd()
): Promise<{ success: boolean; message: string }> {
  const review = await runHeadlessCiReview(projectRoot);
  if (review.passed) {
    return { success: true, message: 'No fixes required. All checks passed.' };
  }

  const dummyContext: ToolContext = {
    projectRoot,
    activeFiles: new Map(),
    sessionId: 'ci-session',
    projectHash: 'ci-hash',
    agentRole: 'coder',
    get abortSignal() { return new AbortController().signal; },
  };

  await termExec({ command: 'npx eslint --fix src', timeout: 30, workdir: projectRoot }, dummyContext);

  const recheck = await runHeadlessCiReview(projectRoot);
  if (recheck.passed) {
    return { success: true, message: 'Successfully auto-fixed lint issues.' };
  }

  return { success: false, message: 'Auto-fix completed partial repairs, manual intervention required.' };
}
