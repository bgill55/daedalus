const { spawn } = require('child_process');
const path = require('path');

const projectDir = process.argv[2] || '.';
const goal = process.argv[3] || 'add a new page at src/pages/about.tsx with basic company info and a link back to home';

const cliPath = path.resolve('D:/Daedalus/dist/index.js');
const env = { ...process.env, DAEDALUS_AUTO_APPROVE: 'true' };

const child = spawn('node', [cliPath], {
  cwd: projectDir,
  env,
  stdio: ['pipe', 'inherit', 'pipe']
});

const stderrChunks = [];
child.stderr.on('data', (d) => stderrChunks.push(d));

child.stdin.write(`/orchestrate ${goal}\n`);

// Fallback: send /exit after 5 minutes
const timeout = setTimeout(() => {
  console.log('\n[watchdog] timeout reached, sending /exit');
  child.stdin.write('/exit\n');
}, 5 * 60 * 1000);

child.on('close', (code) => {
  clearTimeout(timeout);
  const err = Buffer.concat(stderrChunks).toString();
  if (code !== 0) console.error('Process exited with code', code, err);
  else console.log('Process exited cleanly');
});
