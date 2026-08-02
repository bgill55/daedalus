import { describe, it, expect, vi } from 'vitest';
import { executeMCPTool } from './tool-executor.js';
import { mcpRegistry } from './registry.js';

vi.mock('./registry.js', () => ({
  mcpRegistry: { callTool: vi.fn() },
}));

describe('executeMCPTool', () => {
  it('propagates the real toolCallId and unwraps structured text content', async () => {
    (mcpRegistry.callTool as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      isError: false,
    });

    const res = await executeMCPTool('mcp_fs_read', { path: 'a' }, {} as any, 'call-abc');
    expect(res.toolCallId).toBe('call-abc');
    expect(res.success).toBe(true);
    expect(res.content).toBe('hello');
  });

  it('stringifies non-structured results', async () => {
    (mcpRegistry.callTool as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const res = await executeMCPTool('mcp_fs_read', {}, {} as any, 'call-def');
    expect(res.content).toBe('{\n  \"ok\": true\n}');
  });

  it('keeps the call id on failure', async () => {
    (mcpRegistry.callTool as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    const res = await executeMCPTool('mcp_fs_read', {}, {} as any, 'call-xyz');
    expect(res.toolCallId).toBe('call-xyz');
    expect(res.success).toBe(false);
    expect(res.error).toContain('boom');
  });
});
