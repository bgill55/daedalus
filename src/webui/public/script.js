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
