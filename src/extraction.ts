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
    if (msg.role === 'assistant' && msg.tool_calls) {
      const calls = msg.tool_calls;
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

  const isGenericTitle = !sessionManager.sessionTitle ||
    sessionManager.sessionTitle === 'Loaded Session' ||
    sessionManager.sessionTitle === 'New Session' ||
    /^Session on/i.test(sessionManager.sessionTitle);

  if (isGenericTitle && messages.some(m => m.role === 'user')) {
    const conversationBrief = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(0, 6)
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n');

    try {
      const titleResponse = await router.chat.completions.create({
        model: 'auto',
        messages: [
          {
            role: 'system',
            content: 'Generate a very short, concise, and descriptive title (3 to 5 words) for this conversation based on the messages. Return ONLY the plain text title, no quotes, no markdown, no punctuation, and no meta-text (do not say "Title:").'
          },
          {
            role: 'user',
            content: conversationBrief
          }
        ],
        temperature: 0.3,
        max_tokens: 20
      });

      const newTitle = (titleResponse.choices[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
      if (newTitle && newTitle.length > 2 && !/^Session on/i.test(newTitle)) {
        sessionManager.updateSessionTitle(newTitle);
        console.log(`  ${pc.dim('[')} ${pc.dim('auto-named session:')} ${pc.cyan(newTitle)} ${pc.dim(']')}`);
      }
    } catch {
      // Ignored
    }
  }

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

    const text = (response.choices[0]?.message?.content || '').trim();
    if (!text) return;

    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return;

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      const cleanedJson = cleanJson(jsonMatch[0]);
      parsed = JSON.parse(cleanedJson);
    }
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
  } catch (err) {
    console.log(`  ${pc.dim('[extract]')} ${pc.yellow(`skipped: ${(err as Error).message}`)}`);
  }
}

function cleanJson(str: string): string {
  let cleaned = str.trim();
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
  cleaned = cleaned.replace(/([{,\[]\s*)'([^']*)'\s*:/g, '$1"$2":');
  cleaned = cleaned.replace(/:\s*'([^']*)'\s*([,}\]])/g, ':"$1"$2');
  cleaned = cleaned.replace(/\[\s*'([^']*)'\s*([,\]])/g, '["$1"$2');
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_-]+)\s*:/g, '$1"$2":');
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  return cleaned;
}

