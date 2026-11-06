'use strict';
/**
 * 本地预览服务器（仅开发用，CI 不涉及）
 *   node tools/serve.cjs [端口]
 * 然后访问 http://127.0.0.1:8210/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(path.resolve(__dirname, '..'), '_site');
const PORT = Number(process.argv[2] || 8210);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('403');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 —— 先运行 node tools/build.cjs');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`预览：http://127.0.0.1:${PORT}/`);
  });
