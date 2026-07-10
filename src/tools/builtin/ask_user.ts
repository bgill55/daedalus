import pc from 'picocolors';
import { ToolContext, ToolResult } from '../../types.js';

export async function askUser(
  args: { question: string; options?: string[] },
  context: ToolContext
): Promise<ToolResult> {
  const askLine = context.askLine;
  if (!askLine) {
    return {
      toolCallId: '',
      name: 'ask_user',
      success: false,
      content: '',
      error: 'Interactive input (askLine) is not available in this context.',
    };
  }

  const { question, options } = args;

  let prompt = `\n${pc.cyan(pc.bold('?'))} ${pc.bold(question)}\n`;

  if (options && options.length > 0) {
    options.forEach((opt, idx) => {
      prompt += `  ${pc.cyan(`${idx + 1}`)} ${pc.dim(')')} ${opt}\n`;
    });
    prompt += `  ${pc.dim(`Enter option number (1-${options.length}) or type a custom response:`)} `;
  } else {
    prompt += `  ${pc.dim('Response:')} `;
  }

  const answer = await askLine(prompt);
  const trimmed = answer.trim();

  if (options && options.length > 0) {
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return {
        toolCallId: '',
        name: 'ask_user',
        success: true,
        content: options[num - 1],
      };
    }
  }

  return {
    toolCallId: '',
    name: 'ask_user',
    success: true,
    content: trimmed,
  };
}
