// server/router.js
// Roteador HTTP minimalista sobre o módulo nativo node:http.
// Sem dependências externas (sem Express).

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class Router {
  constructor() {
    this.routes = []; // { method, segments, handler }
  }

  _add(method, routePath, handler) {
    const segments = routePath.split('/').filter(Boolean);
    this.routes.push({ method, segments, handler });
  }

  get(p, h) { this._add('GET', p, h); }
  post(p, h) { this._add('POST', p, h); }
  put(p, h) { this._add('PUT', p, h); }
  delete(p, h) { this._add('DELETE', p, h); }

  _match(method, pathname) {
    const reqSegments = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== reqSegments.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const rs = route.segments[i];
        const qs = reqSegments[i];
        if (rs.startsWith(':')) {
          params[rs.slice(1)] = decodeURIComponent(qs);
        } else if (rs !== qs) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }

  async handle(req, res, staticDir) {
    const parsed = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);

    if (pathname.startsWith('/api/')) {
      const match = this._match(req.method, pathname);
      if (!match) {
        sendJson(res, 404, { error: 'Rota não encontrada' });
        return;
      }
      try {
        req.params = match.params;
        req.query = parsed.query;
        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
          req.body = await readJsonBody(req);
        } else {
          req.body = {};
        }
        await match.handler(req, res);
      } catch (err) {
        if (err && err.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
        } else {
          console.error('Erro interno:', err);
          sendJson(res, 500, { error: 'Erro interno do servidor' });
        }
      }
      return;
    }

    // Servir arquivos estáticos do frontend
    serveStatic(req, res, pathname, staticDir);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 5 * 1024 * 1024; // 5MB
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(httpError(413, 'Corpo da requisição muito grande'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(httpError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function serveStatic(req, res, pathname, staticDir) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(staticDir, filePath);

  if (!fullPath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback: se não achar o arquivo e não tiver extensão, devolve index.html
      if (!path.extname(filePath)) {
        fs.readFile(path.join(staticDir, 'index.html'), (err2, data2) => {
          if (err2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(data2);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

module.exports = { Router, sendJson, httpError };
