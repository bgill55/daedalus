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

function renderMarkdown(text) {
  if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
    try {
      return window.marked.parse(text, { breaks: true, gfm: true });
    } catch {
      // fallback
    }
  }
  // Lightweight fallback
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br>');
}

function addChatMessage(role, text, roleBadge = null) {
  if (!chatMessages) return;
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${role}`;
  
  const header = document.createElement('div');
  header.className = 'msg-header';
  
  const sender = document.createElement('span');
  sender.className = 'sender';
  sender.textContent = role === 'user' ? 'YOU' : 'DAEDALUS';
  header.appendChild(sender);
  
  if (roleBadge) {
    const badge = document.createElement('span');
    badge.className = 'badge-role';
    badge.textContent = roleBadge;
    header.appendChild(badge);
  }

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
  if (role === 'assistant') {
    body.innerHTML = renderMarkdown(text);
  } else {
    body.textContent = text;
  }
  
  msgEl.appendChild(header);
  msgEl.appendChild(body);
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return body;
}

let activeAssistantBody = null;
let thinkingEl = null;

function showThinkingSpinner() {
  removeThinkingSpinner();
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'chat-msg thinking';
  thinkingEl.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    <span>Daedalus is formulating response...</span>
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
    const label = thinkingEl.querySelector('span:last-child');
    if (label) label.textContent = text;
    chatMessages.appendChild(thinkingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

const sentHistory = [];
let sentIndex = -1;

if (chatForm && chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
      return;
    }

    if (e.key === 'Escape') {
      chatInput.value = '';
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
        e.preventDefault();
      }
    }
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    
    sentHistory.push(text);
    sentIndex = -1;
    chatInput.value = '';
    if (chatStatusBadge) chatStatusBadge.textContent = 'THINKING...';
    
    addChatMessage('user', text);
    activeAssistantBody = null;
    showThinkingSpinner();
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
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
          addChatMessage(item.role === 'assistant' ? 'assistant' : 'user', item.text);
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
          if (!activeAssistantBody) {
            activeAssistantBody = addChatMessage('assistant', data.text || '', 'STREAM');
          } else if (data.text) {
            const raw = (activeAssistantBody.dataset.raw || '') + data.text;
            activeAssistantBody.dataset.raw = raw;
            activeAssistantBody.innerHTML = renderMarkdown(raw);
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
          if (chatStatusBadge) chatStatusBadge.textContent = 'STREAMING...';
          updateThinkingSpinner('Daedalus is responding...');
        }
        return;
      }

      if (data.type === 'chat_tool_start') {
        addLog(`⚡ Agent tool started: <strong>${data.tool}</strong>`);
        if (chatStatusBadge) chatStatusBadge.textContent = `TOOL: ${data.tool}`;
        updateThinkingSpinner(`Running: ${data.tool}...`);
        return;
      }

      if (data.type === 'chat_tool_result') {
        addLog(`✔ Agent tool finished: <strong>${data.tool}</strong>`);
        updateThinkingSpinner('Daedalus is processing results...');
        return;
      }

      if (data.type === 'chat_done') {
        removeThinkingSpinner();
        if (activeAssistantBody && activeAssistantBody.dataset.raw) {
          activeAssistantBody.innerHTML = renderMarkdown(activeAssistantBody.dataset.raw);
        }
        activeAssistantBody = null;
        if (chatStatusBadge) chatStatusBadge.textContent = 'READY';
        addLog('Chat completion finished.');
        return;
      }

      if (data.type === 'chat_error') {
        removeThinkingSpinner();
        addChatMessage('error', `Execution error: ${data.content}`);
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

connectSSE();

