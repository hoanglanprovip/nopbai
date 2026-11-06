const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/effects.js': 'effects.js' }[pathname];
  if (!file) return res.writeHead(404).end();
  try {
    const data = await readFile(join(__dirname, '..', file));
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' }).end(data);
  } catch { res.writeHead(500).end(); }
}).listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173'));
