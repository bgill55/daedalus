import blessed from 'neo-blessed';
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

export function initFileTree(parent: any, projectRoot: string, activeFiles: Map<string, string>) {
  const list = blessed.list({
    parent,
    top: 14, // Positioned below model select (height 6 monitor + 8 model select = 14)
    left: 0,
    width: '100%',
    height: '100%-14',
    border: { type: 'line' },
    label: ' PROJECT FILES ',
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

  // Track expanded folder paths
  const expanded = new Map<string, boolean>();
  expanded.set(projectRoot, true);

  interface TreeNode {
    absolutePath: string;
    relativePath: string;
    isDir: boolean;
    depth: number;
    name: string;
  }
  let treeNodes: TreeNode[] = [];

  // Traversal helper — lazy walks only expanded folders
  function getTreeNodes(dir: string, depth = 0): TreeNode[] {
    const nodes: TreeNode[] = [];
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      const sorted = files.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const file of sorted) {
        const absPath = path.join(dir, file.name);
        const relPath = path.relative(projectRoot, absPath);

        // Ignore common build/config/version control folders
        if (
          file.name === 'node_modules' ||
          file.name === '.git' ||
          file.name === 'dist' ||
          file.name === '.gemini' ||
          file.name === 'build' ||
          file.name === '.releaserc.json'
        ) {
          continue;
        }

        const isDir = file.isDirectory();
        nodes.push({
          absolutePath: absPath,
          relativePath: relPath,
          isDir,
          depth,
          name: file.name
        });

        if (isDir && expanded.get(absPath)) {
          nodes.push(...getTreeNodes(absPath, depth + 1));
        }
      }
    } catch {
      // Skip errors
    }
    return nodes;
  }

  function renderTree() {
    treeNodes = getTreeNodes(projectRoot);
    const listItems = treeNodes.map(node => {
      const indent = '  '.repeat(node.depth);
      let prefix = '';
      if (node.isDir) {
        const isExp = expanded.get(node.absolutePath);
        prefix = isExp ? '▼ 📁 ' : '▶ 📁 ';
      } else {
        const isActive = activeFiles.has(node.absolutePath);
        prefix = isActive ? '✔ 📄 ' : '  📄 ';
      }
      
      let nameText = node.name;
      if (!node.isDir && activeFiles.has(node.absolutePath)) {
        nameText = pc.green(nameText);
      }
      return `${indent}${prefix}${nameText}`;
    });

    list.setItems(listItems);
    if (parent.screen) {
      parent.screen.render();
    }
  }

  list.on('select', (item: any, index: number) => {
    const node = treeNodes[index];
    if (!node) return;

    if (node.isDir) {
      const isExp = expanded.get(node.absolutePath);
      expanded.set(node.absolutePath, !isExp);
    } else {
      if (activeFiles.has(node.absolutePath)) {
        activeFiles.delete(node.absolutePath);
        const logBox = parent.screen.children.find((c: any) => c.log);
        if (logBox) {
          logBox.log(pc.red(`\n  [TUI] Removed from context: ${pc.bold(node.relativePath)}`));
        }
      } else {
        activeFiles.set(node.absolutePath, node.relativePath);
        const logBox = parent.screen.children.find((c: any) => c.log);
        if (logBox) {
          logBox.log(pc.green(`\n  [TUI] Added to context: ${pc.bold(node.relativePath)}`));
        }
      }
    }
    renderTree();
  });

  // Focus when clicking empty space or border of the list
  list.on('click', () => {
    list.focus();
    parent.screen.render();
  });

  // Handle single click item selection and focus
  list.on('element click', (el: any) => {
    list.focus();
    const index = (list as any).items.indexOf(el);
    if (index !== -1) {
      list.select(index);
      list.emit('select', el, index);
      parent.screen.render();
    }
  });

  // Mouse wheel support for shifting selection
  list.on('wheelup', () => {
    list.up();
    parent.screen.render();
  });

  list.on('wheeldown', () => {
    list.down();
    parent.screen.render();
  });

  renderTree();

  return list;
}
