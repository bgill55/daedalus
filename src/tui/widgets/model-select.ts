import blessed from 'neo-blessed';
import pc from 'picocolors';
import { DaedalusConfig } from '../../config/index.js';
import type { LocalRouter } from '../../router/index.js';
import type { ModelEntry, ModelHealth } from '../../router/types.js';
import { getCachedHealth } from '../../router/health.js';

interface ModelLabelState {
  blacklistReason?: string;
  emaMs?: number;
  emaThresholdMs?: number;
  health?: ModelHealth | undefined;
}

export function buildModelLabel(m: { name: string }, state: ModelLabelState): string {
  if (state.blacklistReason) return `  {yellow-fg}✕{/} ${m.name} {dim}(blacklisted){/}`;
  if (state.health && state.health.healthy === false) {
    const why = state.health.error ? ` {dim}(${state.health.error}){/}` : '';
    return `  {red-fg}●{/} ${m.name}${why}`;
  }
  if (state.emaThresholdMs && state.emaThresholdMs > 0 && (state.emaMs ?? 0) >= state.emaThresholdMs) {
    return `  {yellow-fg}●{/} ${m.name} {dim}(slow ${state.emaMs}ms){/}`;
  }
  return `  {green-fg}●{/} ${m.name}`;
}

export function initModelSelect(parent: blessed.Widgets.BoxElement, config: DaedalusConfig & { modelOverride?: string }, router: LocalRouter) {
  // Get active models from config
  const enabledModels = (config.router?.chain?.filter((m: { enabled?: boolean }) => m.enabled) || []) as ModelEntry[];

  // Build labels that reflect live router health, blacklist, and slow-guard state
  const blacklist = new Map(
    (router.getSessionBlacklist?.() ?? []).map(b => [`${b.endpoint}|${b.model}`, b.reason])
  );
  const ema = new Map(
    (router.getLatencyEma?.() ?? []).map(e => [`${e.endpoint}|${e.model}`, e])
  );
  const labelFor = (m: ModelEntry): string => {
    const key = `${m.endpoint}|${m.model}`;
    return buildModelLabel(m, {
      blacklistReason: blacklist.get(key),
      emaMs: ema.get(key)?.emaMs,
      emaThresholdMs: ema.get(key)?.thresholdMs,
      health: getCachedHealth(m),
    });
  };

  const modelNames = enabledModels.map((m: { name: string }) => m.name);
  const options = ['Automatic Routing', ...enabledModels.map((m: ModelEntry) => labelFor(m))];

  // Self-bordered list selector
  const list = blessed.list({
    parent,
    top: 6, // Positioned below monitor (height 6)
    left: 0,
    width: '100%',
    height: 8,
    tags: true,
    border: { type: 'line' },
    label: ' SELECTED MODEL ',
    keys: true,
    mouse: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'dim' },
      style: { inverse: true }
    },
    style: {
      border: { fg: 'dim' },
      focus: { border: { fg: 'cyan' } },
      selected: { bg: 'cyan', fg: 'black', bold: true },
      item: { fg: 'white' }
    }
  });

  // Call setItems explicitly to avoid neo-blessed constructor bugs
  list.setItems(options.map(opt => `  ${opt}`));

  // Highlight initial selection
  const currentOverride = config.modelOverride;
  if (currentOverride) {
    const idx = modelNames.indexOf(currentOverride);
    if (idx !== -1) {
      list.select(idx + 1); // offset by 1 for Automatic Routing
    } else {
      list.select(0);
    }
  } else {
    list.select(0);
  }

  // Handle select event
  list.on('select', (_item: unknown, index: number) => {
    const logBox = parent.screen?.children.find((c: unknown) => typeof (c as { log?: unknown }).log === 'function') as { log: (msg: string) => void } | undefined;
    
    if (index === 0) {
      config.modelOverride = undefined;
      if (logBox) {
        logBox.log(pc.yellow(`\n  [TUI] Model selection set to: ${pc.bold('Automatic Routing')}`));
      }
    } else {
      const selectedModelName = modelNames[index - 1];
      const modelEntry = enabledModels.find((m: { name: string }) => m.name === selectedModelName);
      if (modelEntry) {
        config.modelOverride = modelEntry.name;
        if (logBox) {
          logBox.log(pc.yellow(`\n  [TUI] Model selection overridden to: ${pc.bold(modelEntry.name)}`));
        }
      }
    }
    
    parent.screen.render();
  });

  // Focus when clicking empty space or border of the list
  list.on('click', () => {
    list.focus();
    parent.screen.render();
  });

  // Handle single click item selection and focus
  list.on('element click', (el: unknown) => {
    list.focus();
    const listElement = list as unknown as { items: unknown[]; select: (i: number) => void; emit: (e: string, el: unknown, i: number) => void };
    const index = listElement.items.indexOf(el);
    if (index !== -1) {
      listElement.select(index);
      listElement.emit('select', el, index);
      parent.screen.render();
    }
  });

  // Mouse wheel support for shifting selection
  list.on('wheelup', () => {
    list.up(1);
    parent.screen.render();
  });

  list.on('wheeldown', () => {
    list.down(1);
    parent.screen.render();
  });

  return list;
}
