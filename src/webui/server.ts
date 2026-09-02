import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const PORT = 3888;
const HOST = 'localhost';

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
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
