import blessed from 'neo-blessed';
import pc from 'picocolors';
import { DaedalusConfig } from '../../config/index.js';

export function initModelSelect(parent: blessed.Widgets.BoxElement, config: DaedalusConfig, _router: unknown) {
  // Get active models from config
  const enabledModels = config.router?.chain?.filter((m: { enabled?: boolean }) => m.enabled) || [];
  const modelNames = enabledModels.map((m: { name: string }) => m.name);
  const options = ['Automatic Routing', ...modelNames];

  // Self-bordered list selector
  const list = blessed.list({
    parent,
    top: 6, // Positioned below monitor (height 6)
    left: 0,
    width: '100%',
    height: 8,
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
