import { createServer } from 'node:http';
import configuration from '../api/billing/config.js';
import checkout from '../api/billing/checkout.js';
import status from '../api/billing/status.js';
import webhook from '../api/billing/webhook.js';

const routes = { '/api/billing/config': configuration, '/api/billing/checkout': checkout, '/api/billing/status': status, '/api/billing/webhook': webhook };
const port = Number(process.env.BILLING_DEV_PORT || 3001);
createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
    const route = routes[url.pathname];
    if (!route) { outgoing.writeHead(404).end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 262144) { outgoing.writeHead(413).end(); return; } chunks.push(chunk); }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(url, { method: incoming.method, headers, ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
    const response = await route.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Local billing server error' })); }
}).listen(port, '127.0.0.1', () => console.log(`Local billing API: http://127.0.0.1:${port}/api/billing/config`));
