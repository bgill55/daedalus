import pc from 'picocolors';
import type { LocalRouter } from './router/index.js';
import type { ChatMessage } from './types.js';
import { SessionManager } from './session/manager.js';

const LEARNING_TOOLS = new Set([
  'write_file', 'patch', 'edit_file',
  'commit', 'git_commit',
]);

let extractionTurnCount = 0;
const EXTRACTION_INTERVAL = 5;

function recentTurnHasLearningSignal(messages: ChatMessage[]): boolean {
  const lastMsgs = messages.slice(-10);
  for (const msg of lastMsgs) {
    if (msg.role === 'assistant' && (msg as any).tool_calls) {
      const calls: Array<{ function: { name: string } }> = (msg as any).tool_calls;
      for (const tc of calls) {
        if (LEARNING_TOOLS.has(tc.function.name)) return true;
      }
    }
  }
  return false;
}

export async function extractAndSave(
  router: LocalRouter,
  sessionManager: SessionManager,
  messages: ChatMessage[],
): Promise<void> {
  extractionTurnCount++;

  const hasSignal = recentTurnHasLearningSignal(messages);
  const lastFew = messages.slice(-4);
  const anyToolResults = lastFew.some(m => m.role === 'tool');
  const assistantHadContent = lastFew.some(m => m.role === 'assistant' && m.content && String(m.content).length > 20);

  if (!hasSignal && !anyToolResults && !assistantHadContent) return;
  if (!hasSignal && extractionTurnCount % EXTRACTION_INTERVAL !== 0) return;

  const existingFacts = sessionManager.loadMemory().facts;

  const recentMsgs = messages
    .filter(m => m.role === 'assistant' || m.role === 'tool' || m.role === 'user')
    .slice(-10)
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content.slice(0, 500)
        : JSON.stringify(m.content).slice(0, 500),
    }));

  if (recentMsgs.length < 2) return;

  try {
    const response = await router.chat.completions.create({
      model: 'auto',
      messages: [
        { role: 'system', content: 'You are a concise fact extractor. Return JSON only.' },
        { role: 'user', content: [
          'Extract new facts about this project, codebase, user preferences, or setup from the conversation.',
          'Return JSON array of {"key":"...","value":"..."} or [] if nothing new.',
          '',
          'Examples:',
          '- {"key":"testing framework","value":"vitest"}',
          '- {"key":"coding style","value":"no comments, named exports"}',
          '- {"key":"build command","value":"npm run build (tsc)"}',
          '',
          'Conversation:',
          recentMsgs.map(m => `${m.role}: ${m.content}`).join('\n'),
        ].join('\n') },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });

    const text = ((response.choices[0] as any)?.message?.content || '').trim();
    if (!text) return;

    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return;

    const parsed: { key: string; value: string }[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return;

    const existingKeyValues = new Set(existingFacts.map(f => `${f.key}::${f.value}`));
    const newFacts = parsed.filter(f =>
      f.key && f.value &&
      !existingKeyValues.has(`${f.key}::${f.value}`),
    );

    if (newFacts.length === 0) return;

    for (const f of newFacts) {
      sessionManager.addFact(f.key, f.value, 'agent');
    }

    console.log(`  ${pc.dim('[')} ${pc.dim(`learned ${newFacts.length} fact${newFacts.length > 1 ? 's' : ''}`)} ${pc.dim(']')}`);
    for (const f of newFacts) {
      console.log(`  ${pc.dim('  |')} ${pc.cyan(f.key)}${pc.dim(':')} ${pc.gray(f.value)}`);
    }
  } catch {
    // Extraction is best-effort
  }
}
