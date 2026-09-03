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
  
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  
  msgEl.appendChild(header);
  msgEl.appendChild(body);
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return body;
}

let activeAssistantBody = null;

if (chatForm && chatInput) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    
    chatInput.value = '';
    if (chatStatusBadge) chatStatusBadge.textContent = 'THINKING...';
    
    addChatMessage('user', text);
    activeAssistantBody = null;
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        addChatMessage('error', `Error: ${errData.error || res.statusText}`);
        if (chatStatusBadge) chatStatusBadge.textContent = 'ERROR';
      }
    } catch (err) {
      addChatMessage('error', `Network Error: ${err.message}`);
      if (chatStatusBadge) chatStatusBadge.textContent = 'ERROR';
    }
  });
}

function connectSSE() {
  const eventSource = new EventSource('/telemetry');

  eventSource.onopen = () => {
    if (statusEl) {
      statusEl.className = 'status connected';
      statusEl.textContent = '● CONNECTED';
    }
    addLog('Connected to Daedalus telemetry stream.');
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

      // Handle Chat Stream Events
      if (data.type === 'chat_token') {
        if (data.role === 'user') {
          // already added locally or by another client
        } else {
          if (!activeAssistantBody) {
            activeAssistantBody = addChatMessage('assistant', data.text || '', 'STREAM');
          } else if (data.text) {
            activeAssistantBody.textContent += data.text;
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
          if (chatStatusBadge) chatStatusBadge.textContent = 'STREAMING...';
        }
        return;
      }

      if (data.type === 'chat_tool_start') {
        addLog(`⚡ Agent tool started: <strong>${data.tool}</strong>`);
        if (chatStatusBadge) chatStatusBadge.textContent = `TOOL: ${data.tool}`;
        return;
      }

      if (data.type === 'chat_tool_result') {
        addLog(`✔ Agent tool finished: <strong>${data.tool}</strong>`);
        return;
      }

      if (data.type === 'chat_done') {
        activeAssistantBody = null;
        if (chatStatusBadge) chatStatusBadge.textContent = 'READY';
        addLog('Chat completion finished.');
        return;
      }

      if (data.type === 'chat_error') {
        addChatMessage('error', `Execution error: ${data.content}`);
        if (chatStatusBadge) chatStatusBadge.textContent = 'ERROR';
        return;
      }

      // Handle Telemetry Metrics
      if (data.metric && metrics[data.metric]) {
        metrics[data.metric].value.textContent = data.value;
        metrics[data.metric].status.textContent = data.value > 80 ? 'HIGH' : (data.value > 40 ? 'BUSY' : 'NORMAL');
        addLog(`Received metric update: <strong>${data.metric.toUpperCase()}</strong> = ${data.value}%`);
      } else if (data.cpu !== undefined || data.memory !== undefined) {
        if (data.cpu !== undefined && metrics.cpu) {
          metrics.cpu.value.textContent = data.cpu;
        }
        if (data.memory !== undefined && metrics.memory) {
          metrics.memory.value.textContent = data.memory;
        }
        addLog(`Telemetry update: CPU=${data.cpu || '--'}%, MEM=${data.memory || '--'}%`);
      }
    } catch {
      addLog(`Event: ${event.data}`);
    }
  };

  eventSource.onerror = () => {
    if (statusEl) {
      statusEl.className = 'status disconnected';
      statusEl.textContent = '● DISCONNECTED';
    }
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

connectSSE();
