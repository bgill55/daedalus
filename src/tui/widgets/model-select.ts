import blessed from 'neo-blessed';
import pc from 'picocolors';

export function initModelSelect(parent: any, config: any, router: any) {
  // Get active models from config
  const enabledModels = config.router?.chain?.filter((m: any) => m.enabled) || [];
  const modelNames = enabledModels.map((m: any) => m.name);
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
    items: options.map(opt => `  ${opt}`),
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
  list.on('select', (item: any, index: number) => {
    const logBox = parent.screen.children.find((c: any) => c.log);
    
    if (index === 0) {
      config.modelOverride = undefined;
      if (logBox) {
        logBox.log(pc.yellow(`\n  [TUI] Model selection set to: ${pc.bold('Automatic Routing')}`));
      }
    } else {
      const selectedModelName = modelNames[index - 1];
      const modelEntry = enabledModels.find((m: any) => m.name === selectedModelName);
      if (modelEntry) {
        config.modelOverride = modelEntry.name;
        if (logBox) {
          logBox.log(pc.yellow(`\n  [TUI] Model selection overridden to: ${pc.bold(modelEntry.name)}`));
        }
      }
    }
    
    parent.screen.render();
  });

  // Handle single click item selection
  list.on('element click', (el: any) => {
    const index = (list as any).items.indexOf(el);
    if (index !== -1) {
      list.select(index);
      list.emit('select', el, index);
      parent.screen.render();
    }
  });

  return list;
}
