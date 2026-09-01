import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { mcpRegistry } from '../tools/mcp/registry.js';
import { executeToolCalls } from '../tools/executor.js';
import { getAgentRole, filterToolsForRole, roleLabel, AgentRole } from './roles.js';
import { VALID_AGENT_ROLES } from '../tools/builtin/handoff.js';
import { ToolContext, ToolCall, ChatMessage, ToolResult, messageText, ToolDefinition } from '../types.js';
import { DaedalusSpinner } from '../tools/daedalus-spinner.js';
import { SessionManager } from '../session/manager.js';
import { parseTextToolCalls } from '../formatting.js';
import { planNamesTestFiles } from './orchestrator-validation.js';
import { maskSecrets } from '../security/secret-detector.js';

export class SubAgentRunner {
  private router: LocalRouter;
  private toolContext: ToolContext;
  private subContext?: ToolContext;
  private sessionManager?: SessionManager;
  private modelOverride?: string;

  constructor(
    router: LocalRouter,
    toolContext: ToolContext,
    sessionManager?: SessionManager,
    modelOverride?: string
  ) {
    this.router = router;
    this.toolContext = toolContext;
    this.sessionManager = sessionManager;
    this.modelOverride = modelOverride;
  }

  getSubContext(): ToolContext | undefined {
    return this.subContext;
  }

  setSubContext(ctx?: ToolContext): void {
    this.subContext = ctx;
  }

  async retryApiCall<T>(fn: () => Promise<T>, label: string, maxRetries = 2): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.toolContext.abortSignal.aborted) {
        throw new Error('Operation aborted by user');
      }
      try {
        return await fn();
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === maxRetries) {
          throw lastError;
        }
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
        console.log(pc.dim(`[RETRY] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`));
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          if (this.toolContext.abortSignal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error('Operation aborted by user'));
            };
            this.toolContext.abortSignal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
    throw lastError || new Error(`${label} failed`);
  }

  async runAgent(
    role: AgentRole,
    goal: string,
    context: string,
    tools: ToolDefinition[],
    systemExtra?: string,
  ): Promise<string> {
    const currentDateStr = new Date().toLocaleString();

    const buildSystemPrompt = (activeRole: AgentRole): string => {
      let prompt = `${activeRole.systemPrompt}\n\n## CURRENT TIME\nThe current date and local time is: ${currentDateStr}.\n`;
      const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot;
      if (projectRoot) {
        const filesToCheck = ['CLAUDE.md', '.cursorrules', '.daedalusrules', 'DAEDALUS.md'];
        let rules = '';
        for (const file of filesToCheck) {
          const fullPath = path.join(projectRoot, file);
          if (fs.existsSync(fullPath)) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8').trim();
              if (content) {
                rules += `\n### Rules from ${file}:\n${content}\n`;
              }
            } catch {
              // Ignore unreadable rule file
            }
          }
        }
        if (rules) {
          prompt += `\n## PROJECT-SPECIFIC GUIDELINES\n${rules}`;
        }
      }
      if (systemExtra) {
        prompt += `\n${systemExtra}\n`;
      }
      const cv = this.subContext?.contextVariables;
      if (cv && Object.keys(cv).length > 0) {
        prompt += `\n## SHARED CONTEXT VARIABLES\nThe following state bag is shared across turns and handoffs. Honor it in your work:\n${JSON.stringify(cv, null, 2)}`;
      }
      return prompt;
    };

    let currentRole = role;
    const dynamicSystemPrompt = buildSystemPrompt(currentRole);
    const messages: ChatMessage[] = [
      { role: 'system', content: dynamicSystemPrompt },
      { role: 'user', content: `${context}\n\nTask: ${goal}` },
    ];

    const taskTestIntent = planNamesTestFiles(goal);
    this.subContext = {
      ...this.toolContext,
      allowTestEdits: this.toolContext.testApprovalGranted ? true : taskTestIntent,
    };

    let activeTools = filterToolsForRole(tools, currentRole.name);

    let turns = 0;
    let maxTurns = currentRole.maxTurns ?? 10;
    const patchFailures = new Map<string, number>();
    const taskStartHistoryLength = this.toolContext.patchHistory?.length || 0;
    let idleReadTurn = -1;

    while (turns < maxTurns) {
      if (this.toolContext.abortSignal.aborted) {
        return 'Agent execution aborted by user';
      }
      const agentSpinner = new DaedalusSpinner({ text: `${roleLabel(currentRole.name)} running (turn ${turns + 1})`, color: (s) => pc.cyan(s) });
      agentSpinner.start();
      let completion;
      const isLastTurn = turns === maxTurns - 1;
      const currentTools = isLastTurn ? undefined : (activeTools.length > 0 ? activeTools : undefined);
      const currentToolChoice = isLastTurn ? undefined : ((currentRole.name === 'coder' || currentRole.name === 'debugger') && turns === 0 ? 'required' : 'auto');

      try {
        completion = await this.retryApiCall(
          () => this.router.chat.completions.create({
            model: this.modelOverride || 'auto',
            complexity: this.modelOverride ? undefined : 'complex',
            messages,
            temperature: currentRole.temperature ?? 0.1,
            tools: currentTools,
            tool_choice: currentToolChoice,
          }),
          `${currentRole.name} API call`
        );
      } finally {
        agentSpinner.stop();
      }

      if (!completion || !completion.choices || completion.choices.length === 0) {
        return 'Agent completed without response';
      }

      const message = completion.choices[0].message;
      messages.push(message);

      let effectiveToolCalls = message.tool_calls || [];
      if (!effectiveToolCalls.length && message.content) {
        const parsed = parseTextToolCalls(messageText(message.content));
        if (parsed.length > 0) {
          effectiveToolCalls = parsed;
        }
      }

      if (effectiveToolCalls.length > 0) {
        const results = await executeToolCalls(
          effectiveToolCalls.map((tc: ToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          this.subContext
        );

        const switchedRole = this.subContext?.agentRole;
        if (switchedRole && switchedRole !== currentRole.name && (VALID_AGENT_ROLES as readonly string[]).includes(switchedRole)) {
          const nextRole = getAgentRole(switchedRole);
          currentRole = nextRole;
          maxTurns = currentRole.maxTurns ?? 10;
          activeTools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], currentRole.name);
          messages[0] = { role: 'system', content: buildSystemPrompt(currentRole) };
          console.log(pc.magenta(`\n[HANDOFF] ${switchedRole} agent took over the execution turn`));
        }

        let hadPatchFailure = false;
        let patchFailureFile: string | undefined;
        for (const result of results) {
          if (/patch.*Syntax error introduced|error TS\d+/.test(result.content || '')) {
            hadPatchFailure = true;
            const fileMatch = (result.content || '').match(/src\/([^\s(]+)/);
            patchFailureFile = fileMatch ? fileMatch[1] : undefined;
          }
        }

        if (hadPatchFailure && patchFailureFile) {
          const prev = patchFailures.get(patchFailureFile) || 0;
          patchFailures.set(patchFailureFile, prev + 1);
          if (prev + 1 >= 3) {
            return `Agent aborted: too many patch failures on ${patchFailureFile}.\nLast error from patch tool: ${results.find(r => /patch.*Syntax error/.test(r.content || ''))?.content || 'unknown'}\nFix the TypeScript error in that file before retrying.`;
          }
        } else if (!hadPatchFailure) {
          for (const [file] of Array.from(patchFailures)) {
            patchFailures.set(file, 0);
          }
        }

        for (const result of results) {
          let rawContent = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          if (!result.success && result.error) {
            rawContent = `${rawContent}\n\n[Tool Error] ${result.error}`;
          }
          const cappedContent = rawContent.length > 8000
            ? rawContent.slice(0, 8000) + '\n...[content truncated to prevent oversized request]'
            : rawContent;
          messages.push({
            role: 'tool',
            content: maskSecrets(cappedContent),
            tool_call_id: result.toolCallId,
          });
        }

        const hasArtifacts = this.toolContext.patchHistory && this.toolContext.patchHistory.length > taskStartHistoryLength;
        const hasArtifactTool = effectiveToolCalls.some((tc: ToolCall) =>
          /^(write_file|patch|terminal)$/i.test(tc.function.name)
        );
        if (hasArtifacts && hasArtifactTool) {
          idleReadTurn = -1;
        } else if (hasArtifacts && !hasArtifactTool) {
          if (idleReadTurn === -1) idleReadTurn = turns;
          else if (turns - idleReadTurn >= 3) {
            return 'Agent completed';
          }
        }
        turns++;
        continue;
      }

      const responseText = messageText(message.content);

      if (tools.length > 0 && turns === 0 && /sorry|can'?t|cannot|don'?t have|not (able|capable)|lack(|ing) (the )?(necessary |required )?(tools|capabilities)|unable|apologize/i.test(responseText)) {
        messages.push({
          role: 'user',
          content: 'You have tools available to complete this task. Use read_file, write_file, search_files, terminal, and other tools as needed. Do not apologize or refuse — just use the tools to accomplish the task.',
        });
        turns++;
        continue;
      }

      return responseText || 'Agent completed without response';
    }

    return `Agent reached max turns${this.toolContext.maxTurnsCause ? ` (cause: ${this.toolContext.maxTurnsCause})` : ''}`;
  }

  async executeOpenAIToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return executeToolCalls(toolCalls, this.subContext ?? this.toolContext);
  }
}
