// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(registration => {
      console.log('[script.js] Service worker registered successfully:', registration);
      
      registration.addEventListener('updatefound', () => {
        console.log('[script.js] Service worker update found');
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', event => {
            if (event.target.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                console.log('[script.js] New service worker installed, page will reload on next navigation');
                addLog('Service worker update available. Page will reload on next visit.');
              }
            }
          });
        }
      });
    })
    .catch(error => {
      console.warn('[script.js] Service worker registration failed:', error);
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      console.log('[script.js] Service worker controller changed, reloading page');
      window.location.reload();
    }
  });
}

const statusEl = document.getElementById('connection-status');
const lastUpdateEl = document.getElementById('last-update');
const logContainer = document.getElementById('log-container');
const clearBtn = document.getElementById('clear-log');

const metrics = {
  cpu: { value: document.getElementById('cpu-value'), status: document.getElementById('cpu-status') },
  memory: { value: document.getElementById('memory-value'), status: document.getElementById('memory-status') },
  disk: { value: document.getElementById('disk-value'), status: document.getElementById('disk-status') },
  network: { value: document.getElementById('network-value'), status: document.getElementById('network-status') },
};

function addLog(message, isRaw = false) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry active';
  entry.innerHTML = `<span class="time">[${time}]</span> ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
  });
}

const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatStatusBadge = document.getElementById('chat-status-badge');

function highlightSyntax(code) {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  return escaped
    .replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|type|interface|def|self|pub|fn|struct|match|case|switch|try|catch|throw|finally|yield)\b/g, '<span class="hl-keyword">$1</span>')
    .replace(/\b(true|false|null|undefined|None|True|False|nil)\b/g, '<span class="hl-boolean">$1</span>')
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="hl-number">$1</span>')
    .replace(/(["'`])(.*?)\1/g, '<span class="hl-string">$1$2$1</span>')
    .replace(/(\/\/.*|\/\*[\s\S]*?\*\/|#.*)/g, '<span class="hl-comment">$1</span>');
}

function renderMarkdown(text) {
  let html = '';
  if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
    try {
      html = window.marked.parse(text, { breaks: true, gfm: true });
    } catch {
      html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
  } else {
    html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  tempDiv.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    const rawCode = code ? (code.textContent || '') : (pre.textContent || '');
    const langMatch = code?.className?.match(/language-([a-zA-Z0-9_-]+)/);
    const lang = langMatch ? langMatch[1] : 'CODE';

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-block-header';

    const langSpan = document.createElement('span');
    langSpan.className = 'code-lang';
    langSpan.textContent = lang;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = 'COPY CODE';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(rawCode).then(() => {
        copyBtn.textContent = 'COPIED!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'COPY CODE';
          copyBtn.classList.remove('copied');
        }, 1800);
      });
    });

    header.appendChild(langSpan);
    header.appendChild(copyBtn);

    if (code) {
      code.innerHTML = highlightSyntax(rawCode);
    }

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });

  return tempDiv.innerHTML;
}

function attachCliFooter(msgEl, modelName, toolCount, durationMs, tokenCount) {
  if (!msgEl) return;
  if (msgEl.querySelector('.msg-cli-footer')) return;

  const footer = document.createElement('div');
  footer.className = 'msg-cli-footer';

  const left = document.createElement('div');
  left.className = 'msg-cli-footer-left';

  const intel = document.createElement('span');
  intel.className = 'cli-pill cli-pill-intel';
  intel.innerHTML = '<span class="cli-dot">●</span> intelligence';
  left.appendChild(intel);

  const divider1 = document.createElement('span');
  divider1.className = 'msg-cli-footer-divider';
  divider1.textContent = '·';
  left.appendChild(divider1);

  const modelPill = document.createElement('span');
  modelPill.className = 'cli-pill cli-pill-model';
  modelPill.textContent = modelName || 'auto';
  left.appendChild(modelPill);

  if (toolCount && toolCount > 0) {
    const dividerTools = document.createElement('span');
    dividerTools.className = 'msg-cli-footer-divider';
    dividerTools.textContent = '·';
    left.appendChild(dividerTools);

    const toolsPill = document.createElement('span');
    toolsPill.className = 'cli-pill cli-pill-tools';
    toolsPill.textContent = `${toolCount} tool(s)`;
    left.appendChild(toolsPill);
  }

  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : null;
  if (durationSec) {
    const dividerTime = document.createElement('span');
    dividerTime.className = 'msg-cli-footer-divider';
    dividerTime.textContent = '·';
    left.appendChild(dividerTime);

    const timePill = document.createElement('span');
    timePill.className = 'cli-pill cli-pill-time';
    timePill.textContent = `${durationSec}s`;
    left.appendChild(timePill);
  }

  if (tokenCount && tokenCount > 0 && durationMs && durationMs > 0) {
    const tokPerSec = (tokenCount / (durationMs / 1000)).toFixed(1);
    const dividerSpeed = document.createElement('span');
    dividerSpeed.className = 'msg-cli-footer-divider';
    dividerSpeed.textContent = '·';
    left.appendChild(dividerSpeed);

    const speedPill = document.createElement('span');
    speedPill.className = 'cli-pill cli-pill-speed';
    speedPill.textContent = `${tokPerSec} tok/s`;
    left.appendChild(speedPill);
  }

  footer.appendChild(left);
  msgEl.appendChild(footer);
}

let userProfileName = 'YOU';
let activeAssistantBody = null;
let activeAssistantMsgEl = null;
let thinkingEl = null;
let currentToolTreeEl = null;
let currentTurnExecutedTools = [];
let currentTurnTokenCount = 0;
let turnStartTime = null;

function addChatMessage(role, text, roleBadge = null, imageBase64 = null, timestamp = null, meta = null) {
  if (!chatMessages) return null;
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;
  
  const header = document.createElement('div');
  header.className = 'msg-header';
  
  const sender = document.createElement('span');
  sender.className = 'sender';
  sender.textContent = role === 'user' ? userProfileName : 'DAEDALUS';
  header.appendChild(sender);
  
  if (roleBadge) {
    const badge = document.createElement('span');
    badge.className = 'badge-role';
    badge.textContent = roleBadge;
    header.appendChild(badge);
  }

  const timeStr = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-timestamp';
  timeSpan.textContent = timeStr;
  header.appendChild(timeSpan);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'COPY';
    copyBtn.addEventListener('click', () => {
      const raw = body.dataset.raw || body.textContent || '';
      navigator.clipboard.writeText(raw).then(() => {
        copyBtn.textContent = 'COPIED!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'COPY';
          copyBtn.classList.remove('copied');
        }, 1800);
      });
    });
    header.appendChild(copyBtn);
  }
  
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.dataset.raw = text;

  if (imageBase64) {
    const img = document.createElement('img');
    img.className = 'chat-msg-img';
    img.src = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    img.alt = 'Uploaded image';
    body.appendChild(img);
  }

  if (role === 'assistant') {
    const textContainer = document.createElement('div');
    textContainer.innerHTML = renderMarkdown(text);
    body.appendChild(textContainer);
  } else {
    const textSpan = document.createElement('div');
    textSpan.textContent = text;
    body.appendChild(textSpan);
  }
  
  msgEl.appendChild(header);
  msgEl.appendChild(body);

  if (role === 'assistant' && meta) {
    attachCliFooter(msgEl, meta.model, meta.toolCount, meta.durationMs, meta.tokenCount);
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (role === 'assistant') {
    activeAssistantMsgEl = msgEl;
  }
  return body;
}

function renderToolStart(toolName) {
  if (!chatMessages) return null;

  if (!currentTurnExecutedTools.includes(toolName)) {
    currentTurnExecutedTools.push(toolName);
  }

  if (!currentToolTreeEl) {
    const tree = document.createElement('div');
    tree.className = 'tool-execution-tree running';

    const header = document.createElement('div');
    header.className = 'tool-tree-header';

    const left = document.createElement('div');
    left.className = 'tool-tree-left';

    const rail = document.createElement('span');
    rail.className = 'tool-tree-rail';
    rail.textContent = '┊';

    const icon = document.createElement('span');
    icon.className = 'tool-tree-icon';
    icon.textContent = '⚡';

    const label = document.createElement('span');
    label.className = 'tool-tree-label';
    label.textContent = `Running: ${toolName}...`;

    left.appendChild(rail);
    left.appendChild(icon);
    left.appendChild(label);

    const right = document.createElement('div');
    right.className = 'tool-tree-right';

    const badge = document.createElement('span');
    badge.className = 'tool-tree-badge running';
    badge.textContent = 'RUNNING';

    const count = document.createElement('span');
    count.className = 'tool-tree-count';
    count.textContent = '1 tool';

    const chevron = document.createElement('span');
    chevron.className = 'tool-tree-chevron';
    chevron.textContent = '▶';

    right.appendChild(badge);
    right.appendChild(count);
    right.appendChild(chevron);

    header.appendChild(left);
    header.appendChild(right);

    const details = document.createElement('div');
    details.className = 'tool-tree-details hidden';

    header.addEventListener('click', () => {
      tree.classList.toggle('open');
      details.classList.toggle('hidden');
    });

    tree.appendChild(header);
    tree.appendChild(details);
    chatMessages.appendChild(tree);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    currentToolTreeEl = tree;
  }

  const label = currentToolTreeEl.querySelector('.tool-tree-label');
  if (label) label.textContent = `Running: ${toolName}...`;

  const count = currentToolTreeEl.querySelector('.tool-tree-count');
  if (count) count.textContent = `${currentTurnExecutedTools.length} tool(s)`;

  return currentToolTreeEl;
}

function renderToolResult(toolName, resultSummary) {
  if (!currentToolTreeEl) {
    renderToolStart(toolName);
  }

  if (currentToolTreeEl) {
    const details = currentToolTreeEl.querySelector('.tool-tree-details');
    if (details) {
      const item = document.createElement('div');
      item.className = 'tool-tree-item';
      
      const rail = document.createElement('span');
      rail.className = 'tool-tree-item-rail';
      rail.textContent = '┊ └─';

      const name = document.createElement('span');
      name.className = 'tool-tree-item-name';
      name.textContent = toolName;

      const summary = document.createElement('span');
      summary.className = 'tool-tree-item-summary';
      summary.textContent = resultSummary ? `(${resultSummary})` : '✔ completed';

      item.appendChild(rail);
      item.appendChild(name);
      item.appendChild(summary);
      details.appendChild(item);
    }

    const label = currentToolTreeEl.querySelector('.tool-tree-label');
    if (label) {
      label.textContent = `Executed tools: ${currentTurnExecutedTools.join(', ')}`;
    }

    const badge = currentToolTreeEl.querySelector('.tool-tree-badge');
    if (badge) {
      badge.className = 'tool-tree-badge completed';
      badge.textContent = '✔ DONE';
    }

    currentToolTreeEl.classList.remove('running');
    currentToolTreeEl.classList.add('completed');
  }
}

function showThinkingSpinner() {
  removeThinkingSpinner();
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'chat-msg thinking';
  thinkingEl.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    <span class="thinking-text">Daedalus is consulting the labyrinth...</span>
  `;
  chatMessages.appendChild(thinkingEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeThinkingSpinner() {
  if (thinkingEl && thinkingEl.parentNode) {
    thinkingEl.parentNode.removeChild(thinkingEl);
  }
  thinkingEl = null;
}

function updateThinkingSpinner(text) {
  if (thinkingEl && chatMessages) {
    const label = thinkingEl.querySelector('.thinking-text');
    if (label) label.textContent = text;
    chatMessages.appendChild(thinkingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const attachmentPreviewEl = document.getElementById('attachment-preview');
const chatPanel = document.querySelector('.chat-panel');

let currentAttachment = null;

function setAttachment(attachment) {
  currentAttachment = attachment;
  if (!attachmentPreviewEl) return;
  attachmentPreviewEl.innerHTML = '';
  if (!attachment) {
    attachmentPreviewEl.classList.add('hidden');
    return;
  }
  attachmentPreviewEl.classList.remove('hidden');

  const chip = document.createElement('div');
  chip.className = 'attachment-chip';

  if (attachment.isImage && attachment.dataUrl) {
    const thumb = document.createElement('img');
    thumb.className = 'attachment-thumb';
    thumb.src = attachment.dataUrl;
    chip.appendChild(thumb);
  }

  const name = document.createElement('span');
  name.className = 'attachment-name';
  name.textContent = attachment.name;
  chip.appendChild(name);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'attachment-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove attachment';
  removeBtn.addEventListener('click', () => setAttachment(null));
  chip.appendChild(removeBtn);

  attachmentPreviewEl.appendChild(chip);
}

function processFile(file) {
  if (!file) return;
  const isImage = file.type.startsWith('image/');
  const reader = new FileReader();
  if (isImage) {
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
      setAttachment({
        name: file.name || 'image.png',
        isImage: true,
        dataUrl: typeof dataUrl === 'string' ? dataUrl : '',
        base64,
      });
    };
    reader.readAsDataURL(file);
  } else {
    reader.onload = (e) => {
      const textContent = typeof e.target.result === 'string' ? e.target.result : '';
      setAttachment({
        name: file.name,
        isImage: false,
        textContent,
      });
    };
    reader.readAsText(file);
  }
}

if (attachBtn && fileInput) {
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) {
      processFile(e.target.files[0]);
      fileInput.value = '';
    }
  });
}

document.addEventListener('paste', (e) => {
  if (!e.clipboardData?.items) return;
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        processFile(file);
        break;
      }
    }
  }
});

if (chatPanel) {
  chatPanel.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatPanel.classList.add('drag-over');
  });
  chatPanel.addEventListener('dragleave', (e) => {
    if (!chatPanel.contains(e.relatedTarget)) {
      chatPanel.classList.remove('drag-over');
    }
  });
  chatPanel.addEventListener('drop', (e) => {
    e.preventDefault();
    chatPanel.classList.remove('drag-over');
    if (e.dataTransfer?.files?.[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  });
}

const sentHistory = [];
let sentIndex = -1;

function autoResizeInput() {
  if (!chatInput) return;
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + 'px';
}

if (chatForm && chatInput) {
  chatInput.addEventListener('input', autoResizeInput);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      requestAnimationFrame(autoResizeInput);
      return;
    }

    if (e.key === 'Escape') {
      chatInput.value = '';
      chatInput.style.height = 'auto';
      sentIndex = -1;
      return;
    }

    if (e.key === 'ArrowUp') {
      if (chatInput.selectionStart === 0 && chatInput.selectionEnd === 0 && sentHistory.length > 0) {
        if (sentIndex === -1) {
          sentIndex = sentHistory.length - 1;
        } else if (sentIndex > 0) {
          sentIndex--;
        }
        chatInput.value = sentHistory[sentIndex] || '';
        autoResizeInput();
        e.preventDefault();
      }
    } else if (e.key === 'ArrowDown') {
      if (sentIndex !== -1) {
        if (sentIndex < sentHistory.length - 1) {
          sentIndex++;
          chatInput.value = sentHistory[sentIndex] || '';
        } else {
          sentIndex = -1;
          chatInput.value = '';
        }
        autoResizeInput();
        e.preventDefault();
      }
    }
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text && !currentAttachment) return;
    
    let effectiveText = text;
    if (currentAttachment && !currentAttachment.isImage && currentAttachment.textContent) {
      effectiveText = effectiveText
        ? `${effectiveText}\n\n[Attached file: ${currentAttachment.name}]\n\`\`\`\n${currentAttachment.textContent}\n\`\`\``
        : `[Attached file: ${currentAttachment.name}]\n\`\`\`\n${currentAttachment.textContent}\n\`\`\``;
    }

    const imageBase64 = currentAttachment?.isImage ? currentAttachment.base64 : undefined;
    const attachmentSnap = currentAttachment;
    setAttachment(null);

    sentHistory.push(text || (attachmentSnap ? `[Attached ${attachmentSnap.name}]` : ''));
    sentIndex = -1;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    if (chatStatusBadge) chatStatusBadge.textContent = 'THINKING...';
    
    turnStartTime = Date.now();
    currentTurnExecutedTools = [];
    currentTurnTokenCount = 0;
    currentToolTreeEl = null;
    activeAssistantBody = null;
    activeAssistantMsgEl = null;

    addChatMessage('user', effectiveText || 'Attached image', null, imageBase64);
    showThinkingSpinner();
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: effectiveText, imageBase64 })
      });
      
      if (!res.ok) {
        removeThinkingSpinner();
        const errData = await res.json().catch(() => ({}));
        addChatMessage('error', `Error: ${errData.error || res.statusText}`);
        if (chatStatusBadge) chatStatusBadge.textContent = 'ERROR';
      }
    } catch (err) {
      removeThinkingSpinner();
      addChatMessage('error', `Network Error: ${err.message}`);
      if (chatStatusBadge) chatStatusBadge.textContent = 'ERROR';
    }
  });
}

// Sidebar Tab Switching
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-tab-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    const tabName = tab.getAttribute('data-tab');
    const target = document.getElementById('tab-' + tabName);
    if (target) target.classList.remove('hidden');
    if (tabName === 'files') loadFileTree();
    if (tabName === 'context') loadContextFiles();
    if (tabName === 'sessions') loadSessions();
  });
});

// Cheat Sheet Click-to-Insert Handler
document.querySelectorAll('.cmd-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const cmd = chip.getAttribute('data-cmd');
    if (!cmd || !chatInput) return;
    chatInput.value = cmd;
    chatInput.focus();
  });
});

// File Tree
const fileTreeEl = document.getElementById('file-tree');
const fileTreeCwdEl = document.getElementById('file-tree-cwd');
const fileTreeRefreshBtn = document.getElementById('file-tree-refresh');
let fileTreeLoaded = false;

function fileIcon(node) {
  if (node.type === 'dir') return '▶';
  const ext = node.name.split('.').pop() || '';
  const icons = { ts: '𝑇', js: '𝑱', json: '{}', md: '≡', css: '⌗', html: '◇', txt: '·', yml: '⚙', yaml: '⚙', sh: '$', py: '𝑃', go: 'G', rs: '⚙' };
  return icons[ext] || '·';
}

function renderTreeNodes(nodes, depth) {
  const ul = document.createElement('ul');
  ul.className = 'tree-list';
  for (const node of nodes) {
    const li = document.createElement('li');
    li.className = 'tree-node';
    li.style.paddingLeft = (depth * 12) + 'px';

    if (node.type === 'dir') {
      const toggle = document.createElement('span');
      toggle.className = 'tree-icon tree-dir-icon';
      toggle.textContent = fileIcon(node);

      const label = document.createElement('span');
      label.className = 'tree-label tree-dir';
      label.textContent = node.name;

      let childrenEl = null;
      let expanded = false;

      const expand = () => {
        expanded = !expanded;
        toggle.classList.toggle('expanded', expanded);
        if (expanded && !childrenEl && node.children?.length) {
          childrenEl = renderTreeNodes(node.children, 0);
          li.appendChild(childrenEl);
        }
        if (childrenEl) childrenEl.classList.toggle('hidden', !expanded);
      };

      toggle.addEventListener('click', expand);
      label.addEventListener('click', expand);
      li.appendChild(toggle);
      li.appendChild(label);
    } else {
      const icon = document.createElement('span');
      icon.className = 'tree-icon tree-file-icon';
      icon.textContent = fileIcon(node);

      const label = document.createElement('span');
      label.className = 'tree-label tree-file';
      label.textContent = node.name;
      label.title = node.path;

      label.addEventListener('click', () => {
        if (!chatInput) return;
        const current = chatInput.value;
        chatInput.value = current ? current + ' ' + node.path : node.path;
        chatInput.focus();
      });

      li.appendChild(icon);
      li.appendChild(label);
    }

    ul.appendChild(li);
  }
  return ul;
}

async function loadFileTree() {
  if (!fileTreeEl) return;
  if (fileTreeLoaded) return;
  fileTreeEl.innerHTML = '<div class="file-tree-loading">Loading...</div>';
  try {
    const res = await fetch('/api/files');
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    if (fileTreeCwdEl) fileTreeCwdEl.textContent = data.cwd || '—';
    fileTreeEl.innerHTML = '';
    if (!data.tree?.length) {
      fileTreeEl.innerHTML = '<div class="file-tree-loading">No files found.</div>';
      return;
    }
    fileTreeEl.appendChild(renderTreeNodes(data.tree, 0));
    fileTreeLoaded = true;
  } catch {
    fileTreeEl.innerHTML = '<div class="file-tree-loading">Failed to load tree.</div>';
  }
}

if (fileTreeRefreshBtn) {
  fileTreeRefreshBtn.addEventListener('click', () => {
    fileTreeLoaded = false;
    loadFileTree();
  });
}

// Active Context Files
const contextFilesListEl = document.getElementById('context-files-list');
const contextRefreshBtn = document.getElementById('context-refresh-btn');

async function loadContextFiles() {
  if (!contextFilesListEl) return;
  contextFilesListEl.innerHTML = '<div class="file-tree-loading">Loading context...</div>';
  try {
    const res = await fetch('/api/context');
    if (!res.ok) throw new Error('Failed to load context');
    const data = await res.json();
    contextFilesListEl.innerHTML = '';
    if (!data.files || data.files.length === 0) {
      contextFilesListEl.innerHTML = '<div class="file-tree-loading">No active files in context.</div>';
      return;
    }
    data.files.forEach(file => {
      const chip = document.createElement('div');
      chip.className = 'context-file-chip';

      const name = document.createElement('span');
      name.className = 'context-file-name';
      name.textContent = file;
      name.title = `Click to insert ${file}`;
      name.addEventListener('click', () => {
        if (!chatInput) return;
        const current = chatInput.value;
        chatInput.value = current ? current + ' ' + file : file;
        chatInput.focus();
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'context-file-remove';
      removeBtn.textContent = '×';
      removeBtn.title = `Remove ${file} from context`;
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await fetch('/api/context', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file })
          });
          loadContextFiles();
        } catch {}
      });

      chip.appendChild(name);
      chip.appendChild(removeBtn);
      contextFilesListEl.appendChild(chip);
    });
  } catch {
    contextFilesListEl.innerHTML = '<div class="file-tree-loading">Failed to load context files.</div>';
  }
}

if (contextRefreshBtn) {
  contextRefreshBtn.addEventListener('click', () => {
    loadContextFiles();
  });
}

// Chat History Loading
let historyLoaded = false;
async function loadChatHistory() {
  if (historyLoaded) return;
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return;
    const data = await res.json();
    if (data.history && Array.isArray(data.history)) {
      const validHistory = data.history.filter(item => item.role === 'user' || item.role === 'assistant');
      if (validHistory.length > 0) {
        chatMessages.innerHTML = '';
        validHistory.forEach(item => {
          addChatMessage(
            item.role === 'assistant' ? 'assistant' : 'user',
            item.text,
            null,
            null,
            item.timestamp,
            item.role === 'assistant' ? { model: 'daedalus' } : null
          );
        });
      }
    }
    historyLoaded = true;
  } catch {}
}

let reconnectAttempts = 0;

function connectSSE() {
  const eventSource = new EventSource('/telemetry');

  eventSource.onopen = () => {
    reconnectAttempts = 0;
    if (statusEl) {
      statusEl.className = 'status connected';
      statusEl.textContent = '● CONNECTED';
    }
    addLog('Connected to Daedalus telemetry stream.');
    loadChatHistory();
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (lastUpdateEl) {
        lastUpdateEl.textContent = new Date().toLocaleTimeString();
      }

      if (data.type === 'connected') {
        return;
      }

      if (data.type === 'chat_token') {
        if (data.role === 'user') {
          // already added locally or by another client
        } else {
          removeThinkingSpinner();
          currentTurnTokenCount += (data.text || '').split(/\s+/).filter(Boolean).length;
          if (!activeAssistantBody) {
            activeAssistantBody = addChatMessage('assistant', data.text || '', 'STREAM', null, data.timestamp);
            if (activeAssistantBody) {
              activeAssistantMsgEl = activeAssistantBody.closest('.chat-msg');
            }
          } else if (data.text) {
            const raw = (activeAssistantBody.dataset.raw || '') + data.text;
            activeAssistantBody.dataset.raw = raw;
            activeAssistantBody.innerHTML = renderMarkdown(raw);
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
          if (chatStatusBadge) chatStatusBadge.textContent = 'STREAMING...';
        }
        return;
      }

      if (data.type === 'chat_tool_start') {
        addLog(`⚡ Agent tool started: <strong>${data.tool}</strong>`);
        if (chatStatusBadge) chatStatusBadge.textContent = `TOOL: ${data.tool}`;
        updateThinkingSpinner(`Running: ${data.tool}...`);
        renderToolStart(data.tool);
        return;
      }

      if (data.type === 'chat_tool_result') {
        addLog(`✔ Agent tool finished: <strong>${data.tool}</strong>`);
        updateThinkingSpinner('Daedalus is processing results...');
        renderToolResult(data.tool, data.content || data.result);
        return;
      }

      if (data.type === 'chat_done') {
        removeThinkingSpinner();
        if (activeAssistantBody && activeAssistantBody.dataset.raw) {
          activeAssistantBody.innerHTML = renderMarkdown(activeAssistantBody.dataset.raw);
        }
        if (activeAssistantMsgEl) {
          const duration = data.durationMs || (turnStartTime ? Date.now() - turnStartTime : 0);
          const activeModelName = data.model || (modelLabel ? modelLabel.textContent.replace('MODEL: ', '').toLowerCase() : 'auto');
          attachCliFooter(activeAssistantMsgEl, activeModelName, currentTurnExecutedTools.length, duration, currentTurnTokenCount);
        }
        activeAssistantBody = null;
        activeAssistantMsgEl = null;
        currentToolTreeEl = null;
        if (chatStatusBadge) chatStatusBadge.textContent = 'READY';
        addLog('Chat completion finished.');
        return;
      }

      if (data.type === 'chat_error') {
        removeThinkingSpinner();
        addChatMessage('error', `Execution error: ${data.content}`, null, null, data.timestamp);
        if (chatStatusBadge) chatStatusBadge.textContent = 'ERROR';
        return;
      }

      if (data.metric && metrics[data.metric]) {
        metrics[data.metric].value.textContent = data.value + '%';
        metrics[data.metric].status.textContent = data.value > 80 ? 'HIGH' : (data.value > 40 ? 'BUSY' : 'NORMAL');
        addLog(`Received metric update: <strong>${data.metric.toUpperCase()}</strong> = ${data.value}%`);
      } else if (data.cpu !== undefined || data.memory !== undefined) {
        if (data.cpu !== undefined && metrics.cpu) {
          metrics.cpu.value.textContent = data.cpu + '%';
        }
        if (data.memory !== undefined && metrics.memory) {
          metrics.memory.value.textContent = data.memory + '%';
        }
        addLog(`Telemetry update: CPU=${data.cpu || '--'}%, MEM=${data.memory || '--'}%`);
      }
    } catch {
      addLog(`Event: ${event.data}`);
    }
  };

  eventSource.onerror = () => {
    reconnectAttempts++;
    const delay = Math.min(16000, Math.pow(2, reconnectAttempts - 1) * 1000);
    if (statusEl) {
      statusEl.className = 'status reconnecting';
      statusEl.textContent = `● RECONNECTING (${Math.round(delay / 1000)}s)...`;
    }
    eventSource.close();
    setTimeout(connectSSE, delay);
  };
}

// Chronicles (Saved Sessions) Management
const sessionsListEl = document.getElementById('sessions-list');
const sessionNewBtn = document.getElementById('session-new-btn');
const sessionRefreshBtn = document.getElementById('session-refresh-btn');

async function loadSessions() {
  if (!sessionsListEl) return;
  sessionsListEl.innerHTML = '<div class="file-tree-loading">Accessing session archives...</div>';
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error('Failed to load sessions');
    const data = await res.json();
    sessionsListEl.innerHTML = '';
    if (!data.sessions || data.sessions.length === 0) {
      sessionsListEl.innerHTML = '<div class="file-tree-loading">No saved sessions found.</div>';
      return;
    }
    
    data.sessions.forEach(sess => {
      const card = document.createElement('div');
      card.className = 'session-card';
      
      const header = document.createElement('div');
      header.className = 'session-card-header';
      
      const title = document.createElement('span');
      title.className = 'session-card-title';
      title.textContent = sess.title || sess.id.slice(0, 16);
      title.title = sess.title || sess.id;
      
      const date = document.createElement('span');
      date.className = 'session-card-date';
      date.textContent = new Date(sess.updated_at || sess.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      header.appendChild(title);
      header.appendChild(date);
      
      const meta = document.createElement('div');
      meta.className = 'session-card-meta';
      
      const turns = document.createElement('span');
      turns.className = 'session-card-date';
      turns.textContent = `${sess.turns_count || 0} turns`;
      
      const actions = document.createElement('div');
      actions.className = 'session-actions';
      
      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'session-btn';
      resumeBtn.textContent = 'RESUME';
      resumeBtn.title = 'Resume this session';
      resumeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        resumeBtn.textContent = '...';
        try {
          const r = await fetch('/api/sessions/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sess.id }),
          });
          if (r.ok) {
            historyLoaded = false;
            await loadChatHistory();
            addLog(`Resumed session: <strong>${sess.title || sess.id}</strong>`);
            loadSessions();
          }
        } catch {
          resumeBtn.textContent = 'RESUME';
        }
      });
      
      const delBtn = document.createElement('button');
      delBtn.className = 'session-btn delete';
      delBtn.textContent = 'DEL';
      delBtn.title = 'Delete session';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete session "${sess.title || sess.id}"?`)) return;
        try {
          await fetch('/api/sessions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sess.id }),
          });
          loadSessions();
        } catch {}
      });
      
      actions.appendChild(resumeBtn);
      actions.appendChild(delBtn);
      
      meta.appendChild(turns);
      meta.appendChild(actions);
      
      card.appendChild(header);
      card.appendChild(meta);
      sessionsListEl.appendChild(card);
    });
  } catch {
    sessionsListEl.innerHTML = '<div class="file-tree-loading">Failed to load session archives.</div>';
  }
}

if (sessionNewBtn) {
  sessionNewBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/sessions/new', { method: 'POST' });
      if (res.ok) {
        historyLoaded = false;
        chatMessages.innerHTML = '';
        addChatMessage('assistant', 'New session initialized. Sanctum is ready for instructions.', 'ARCHITECT');
        loadSessions();
        loadContextFiles();
      }
    } catch {}
  });
}

if (sessionRefreshBtn) {
  sessionRefreshBtn.addEventListener('click', () => loadSessions());
}

// New Chat / New Rite Button Handler
const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) {
  newChatBtn.addEventListener('click', async () => {
    chatMessages.innerHTML = '';
    activeAssistantBody = null;
    addChatMessage('assistant', 'Sanctum console refreshed. Ready for consultation.', 'ARCHITECT');
    if (chatStatusBadge) chatStatusBadge.textContent = 'SANCTUM READY';
    try {
      await fetch('/api/sessions/new', { method: 'POST' });
      loadSessions();
      loadContextFiles();
    } catch {}
  });
}

// Model Switcher Modal & Active Model Badge
const activeModelBadge = document.getElementById('active-model-badge');
const modelLabel = document.getElementById('model-label');
const modelModal = document.getElementById('model-modal');
const modelModalClose = document.getElementById('model-modal-close');
const modelOptionsList = document.getElementById('model-options-list');

const DEFAULT_MODELS = [
  { id: 'auto', name: 'Auto / Smart Router', desc: 'Dynamically routes based on task complexity and health' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Anthropic — Superior reasoning & code generation' },
  { id: 'gpt-4o', name: 'GPT-4o', desc: 'OpenAI — High-speed multimodal intelligence' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: 'Google — Vast context window & deep analysis' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', desc: 'Google — Ultra-low latency responses' },
  { id: 'deepseek-chat', name: 'DeepSeek V3', desc: 'DeepSeek — High-efficiency coding & logic' },
  { id: 'ollama/llama3.1', name: 'Llama 3.1 / Local', desc: 'Local-first offline execution via Ollama' },
];

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) return;
    const data = await res.json();
    const currentModel = data.activeModel || 'auto';
    if (modelLabel) {
      modelLabel.textContent = `MODEL: ${currentModel.toUpperCase()}`;
    }
    
    if (modelOptionsList) {
      const models = (data.availableModels && data.availableModels.length > 0)
        ? data.availableModels
        : DEFAULT_MODELS;
      
      modelOptionsList.innerHTML = '';
      models.forEach(m => {
        const card = document.createElement('div');
        card.className = `model-option-card ${m.id === currentModel ? 'active' : ''}`;
        
        const header = document.createElement('div');
        header.className = 'model-option-header';
        
        const name = document.createElement('span');
        name.className = 'model-option-name';
        name.textContent = m.name || m.id;
        
        const badge = document.createElement('span');
        badge.className = 'model-option-badge';
        badge.textContent = m.provider ? m.provider.toUpperCase() : (m.id === currentModel ? 'ACTIVE' : 'SELECT');
        
        header.appendChild(name);
        header.appendChild(badge);
        
        const desc = document.createElement('div');
        desc.className = 'model-option-desc';
        desc.textContent = m.desc || `Switch active engine to ${m.id}`;
        
        card.appendChild(header);
        card.appendChild(desc);
        
        card.addEventListener('click', async () => {
          try {
            await fetch('/api/models/switch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: m.id })
            });
            if (modelLabel) modelLabel.textContent = `MODEL: ${m.id.toUpperCase()}`;
            addLog(`Switched active model to <strong>${m.name || m.id}</strong>`);
            closeModelModal();
            loadModels();
          } catch {}
        });
        
        modelOptionsList.appendChild(card);
      });
    }
  } catch {}
}

function openModelModal() {
  if (modelModal) {
    modelModal.classList.remove('hidden');
    loadModels();
  }
}

function closeModelModal() {
  if (modelModal) {
    modelModal.classList.add('hidden');
  }
}

if (activeModelBadge) {
  activeModelBadge.addEventListener('click', openModelModal);
}

if (modelModalClose) {
  modelModalClose.addEventListener('click', closeModelModal);
}

if (modelModal) {
  modelModal.addEventListener('click', (e) => {
    if (e.target === modelModal) closeModelModal();
  });
}

// ─────────────────────────────────────────────────────────────
// QR Code Pairing Modal — M-5 / M-6
// ─────────────────────────────────────────────────────────────
const qrPairBtn = document.getElementById('qr-pair-btn');
const qrModal = document.getElementById('qr-modal');
const qrModalClose = document.getElementById('qr-modal-close');
const qrImage = document.getElementById('qr-image');
const qrWsUrl = document.getElementById('qr-ws-url');

function openQrModal() {
  if (qrModal) {
    qrModal.classList.remove('hidden');
    const webUrl = window.location.origin;
    if (qrWsUrl) {
      qrWsUrl.textContent = webUrl;
    }
    if (qrImage) {
      qrImage.src = `/api/qr?url=${encodeURIComponent(webUrl)}&t=${Date.now()}`;
    }
    addLog(`QR pairing portal opened: <strong>${webUrl}</strong>`);
  }
}

function closeQrModal() {
  if (qrModal) {
    qrModal.classList.add('hidden');
  }
}

if (qrPairBtn) {
  qrPairBtn.addEventListener('click', openQrModal);
}

if (qrModalClose) {
  qrModalClose.addEventListener('click', closeQrModal);
}

if (qrModal) {
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });
}

async function loadUserProfile() {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const data = await res.json();
    if (data.name && data.name.trim()) {
      userProfileName = data.name.trim().toUpperCase();
      document.querySelectorAll('.chat-msg.user .sender').forEach(el => {
        el.textContent = userProfileName;
      });
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Touch-Optimized UI — M-4: TouchTargetConfig interface
// ─────────────────────────────────────────────────────────────
/**
 * @typedef {Object} TouchTargetConfig
 * @property {string} selector         - CSS selector for the interactive element
 * @property {number} [minSizePx=48]   - Minimum width and height in pixels
 * @property {string} [touchAction='manipulation'] - touch-action CSS value
 */

/**
 * Apply touch optimizations by injecting CSS for minimum tap targets
 * and touch-action on elements matching the given selectors.
 * @param {TouchTargetConfig[]} configs
 */
function applyTouchOptimizations(configs) {
  if (!configs || configs.length === 0) return;

  const styleId = 'touch-optimization-styles';
  let styleEl = document.getElementById(styleId);

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  const rules = configs.map(function (cfg) {
    var minSize = cfg.minSizePx !== undefined ? cfg.minSizePx : 48;
    var touchAction = cfg.touchAction !== undefined ? cfg.touchAction : 'manipulation';
    var sel = cfg.selector;
    return [
      sel + ' {',
      '  min-width: ' + minSize + 'px;',
      '  min-height: ' + minSize + 'px;',
      '  touch-action: ' + touchAction + ';',
      '}',
    ].join('\n');
  });

  styleEl.textContent = rules.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Critical element pointerdown listeners — M-4
// ─────────────────────────────────────────────────────────────
/**
 * Add both click and pointerdown listeners to ensure tactile responsiveness.
 * pointerdown fires before click and works for both touch and mouse.
 * @param {HTMLElement|null} el
 * @param {() => void} handler
 */
function addDualInteractionListeners(el, handler) {
  if (!el) return;
  el.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    handler();
  });
  // Keep click for keyboard / accessibility
  if (!el.dataset._hasClickBound) {
    el.addEventListener('click', handler);
    el.dataset._hasClickBound = 'true';
  }
}

// Wire up pointerdown on all critical interactive elements
document.addEventListener('DOMContentLoaded', function () {
  // #active-model-badge — opens model selection modal
  addDualInteractionListeners(
    document.getElementById('active-model-badge'),
    openModelModal
  );

  // #clear-log — clears the log panel
  addDualInteractionListeners(
    document.getElementById('clear-log'),
    function () {
      if (logContainer) logContainer.innerHTML = '';
    }
  );

  // #new-chat-btn — starts a new chat session
  addDualInteractionListeners(
    document.getElementById('new-chat-btn'),
    function () {
      if (chatMessages) chatMessages.innerHTML = '';
      addLog('New rite initiated. The cosmos awaits your query.');
    }
  );

  // #attach-btn — triggers file attachment
  addDualInteractionListeners(
    document.getElementById('attach-btn'),
    function () {
      var fileInput = document.getElementById('file-input');
      if (fileInput) fileInput.click();
    }
  );

  // #send-btn — submits the chat form
  addDualInteractionListeners(
    document.getElementById('send-btn'),
    function () {
      var form = document.getElementById('chat-form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  );

  // #model-modal-close — closes model selection modal
  addDualInteractionListeners(
    document.getElementById('model-modal-close'),
    closeModelModal
  );

  // #qr-pair-btn — opens QR pairing modal
  addDualInteractionListeners(
    document.getElementById('qr-pair-btn'),
    openQrModal
  );

  // #qr-modal-close — closes QR pairing modal
  addDualInteractionListeners(
    document.getElementById('qr-modal-close'),
    closeQrModal
  );

  // Apply global touch optimizations via CSS
  applyTouchOptimizations([
    { selector: 'button', minSizePx: 48, touchAction: 'manipulation' },
    { selector: 'a[href]', minSizePx: 48, touchAction: 'manipulation' },
    { selector: '.model-pill', minSizePx: 44, touchAction: 'manipulation' },
    { selector: '.clear-btn', minSizePx: 48, touchAction: 'manipulation' },
    { selector: '.chat-header-btn', minSizePx: 48, touchAction: 'manipulation' },
    { selector: '.attach-btn', minSizePx: 44, touchAction: 'manipulation' },
    { selector: '#send-btn', minSizePx: 48, touchAction: 'manipulation' },
    { selector: '.model-option-card', minSizePx: 48, touchAction: 'manipulation' },
    { selector: '.code-copy-btn', minSizePx: 36, touchAction: 'manipulation' },
  ]);
});

// ─────────────────────────────────────────────────────────────
// WebSocket & Milestone Push Notifications — M-7
// ─────────────────────────────────────────────────────────────
let wsClient = null;
let wsReconnectTimer = null;

function showMilestoneNotification(payload) {
  if (!payload || payload.type !== 'milestone') return;

  const title = `[DAEDALUS] Milestone ${payload.id ? payload.id.toUpperCase() : ''}: ${payload.title || 'Update'}`;
  const options = {
    body: payload.summary || `Status: ${(payload.status || 'passed').toUpperCase()}${payload.score !== undefined ? ` (${payload.score}/100)` : ''}`,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `daedalus-milestone-${payload.id || Date.now()}`,
    renotify: true,
  };

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, options);
      } catch {}
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(function (permission) {
        if (permission === 'granted') {
          try {
            new Notification(title, options);
          } catch {}
        }
      });
    }
  }

  // Also log into Oracle system log
  addLog(`Milestone <strong>${payload.id || ''}</strong>: ${payload.title} — <em>${(payload.status || 'passed').toUpperCase()}</em>`);
}

function connectWebSocket() {
  if (wsClient && (wsClient.readyState === WebSocket.OPEN || wsClient.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    wsClient = new WebSocket(wsUrl);

    wsClient.onopen = function () {
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    wsClient.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'milestone') {
          showMilestoneNotification(data);
        }
      } catch {}
    };

    wsClient.onclose = function () {
      wsClient = null;
      if (!wsReconnectTimer) {
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
      }
    };

    wsClient.onerror = function () {
      try { wsClient.close(); } catch {}
    };
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Bootstrapping
// ─────────────────────────────────────────────────────────────
connectSSE();
connectWebSocket();
loadModels();
loadUserProfile();

setInterval(function () {
  if (lastUpdateEl) {
    lastUpdateEl.textContent = new Date().toLocaleTimeString();
  }
}, 1000);

// ─────────────────────────────────────────────────────────────
// PWA Install Prompt Handling — M-8
// ─────────────────────────────────────────────────────────────
let deferredPrompt = null;
const installBanner = document.getElementById('install-banner');
const installButton = document.getElementById('install-button');
const installBannerCloseButtons = document.querySelectorAll('.install-banner-close');

function showInstallBanner() {
  if (installBanner) {
    installBanner.classList.remove('hidden');
  }
}

function hideInstallBanner() {
  if (installBanner) {
    installBanner.classList.add('hidden');
  }
}

window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  deferredPrompt = event;
  console.log('[script.js] beforeinstallprompt captured, install banner ready');
  showInstallBanner();
});

if (installButton) {
  installButton.addEventListener('click', async function () {
    if (!deferredPrompt) {
      console.warn('[script.js] No deferred install prompt available');
      return;
    }

    try {
      const result = await deferredPrompt.prompt();
      const choice = result && result.outcome ? result.outcome : 'unknown';

      if (choice === 'accepted') {
        console.log('[script.js] User accepted PWA install prompt');
        addLog('PWA install accepted. Daedalus will be added to your home screen.');
      } else {
        console.log('[script.js] User dismissed PWA install prompt:', choice);
        addLog('PWA install dismissed by user.');
      }
    } catch (err) {
      console.error('[script.js] PWA install prompt failed:', err);
      addLog('PWA install prompt encountered an error.');
    } finally {
      deferredPrompt = null;
      hideInstallBanner();
    }
  });
}

installBannerCloseButtons.forEach(btn => {
  btn.addEventListener('click', function () {
    console.log('[script.js] Install banner dismissed by user');
    deferredPrompt = null;
    hideInstallBanner();
  });
});

window.addEventListener('appinstalled', function () {
  console.log('[script.js] PWA installed successfully');
  addLog('Daedalus has been installed as an app.');
  deferredPrompt = null;
  hideInstallBanner();
});


