import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const PORT = 3000;
const HOST = 'localhost';

export interface TelemetryData {
  timestamp: number;
  metric: string;
  value: number;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/telemetry') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection message
    res.write('data: {"type":"connected"}\n\n');

    // Generate and send dummy telemetry data every second
    const interval = setInterval(() => {
      const data: TelemetryData = {
        timestamp: Date.now(),
        metric: ['cpu', 'memory', 'disk', 'network'][Math.floor(Math.random() * 4)],
        value: Math.floor(Math.random() * 100)
      };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }, 1000);

    // Clean up interval on client disconnect
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

const server = createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.info(`[webui] Server listening on http://${HOST}:${PORT}`);
});

export { server };
