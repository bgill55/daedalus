import blessed from 'neo-blessed';
import os from 'os';
import pc from 'picocolors';

function getCpuTimes() {
  const cpus = os.cpus();
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }
  const total = user + nice + sys + idle + irq;
  return { idle, total };
}

export function initMonitor(parent: any) {
  const box = blessed.box({
    parent,
    top: 0,
    left: 0,
    width: '100%',
    height: 6,
    border: { type: 'line' },
    style: {
      border: { fg: 'dim' }
    },
  });

  let lastCpuTimes = getCpuTimes();

  function updateStats() {
    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usedGB = (usedMem / (1024 * 1024 * 1024)).toFixed(1);
    const totalGB = (totalMem / (1024 * 1024 * 1024)).toFixed(1);
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // CPU
    const currentCpu = getCpuTimes();
    const idleDiff = currentCpu.idle - lastCpuTimes.idle;
    const totalDiff = currentCpu.total - lastCpuTimes.total;
    lastCpuTimes = currentCpu;
    
    let cpuPercent = 0;
    if (totalDiff > 0) {
      cpuPercent = Math.round((1 - idleDiff / totalDiff) * 100);
    }
    cpuPercent = Math.min(100, Math.max(0, cpuPercent));

    // Render bar progress
    const getProgressBar = (pct: number, colorFn: (s: string) => string) => {
      const filled = Math.round(pct / 10);
      const empty = 10 - filled;
      return colorFn('█'.repeat(filled)) + pc.dim('░'.repeat(empty));
    };

    box.setContent(
      pc.bold('  SYSTEM MONITOR\n\n') +
      `  Memory: ${usedGB}G/${totalGB}G (${memPercent}%)\n` +
      `  [ ${getProgressBar(memPercent, pc.cyan)} ]\n\n` +
      `  CPU Usage: ${cpuPercent}%\n` +
      `  [ ${getProgressBar(cpuPercent, pc.magenta)} ]`
    );
    
    if (box.screen) {
      box.screen.render();
    }
  }

  // Initial update and interval
  updateStats();
  const interval = setInterval(updateStats, 1000);

  // Stop interval when the box is detached or screen destroyed
  box.on('destroy', () => {
    clearInterval(interval);
  });

  return box;
}
