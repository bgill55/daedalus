import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Simulate the MCP delay - create rl immediately, read after 10s
setTimeout(() => {
  console.log('Now reading...');
  rl.on('line', (line) => {
    console.log('GOT LINE:', line);
    process.exit(0);
  });
}, 10000);

setInterval(() => {}, 100000);
