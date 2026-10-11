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
    this.routes = []; // { method, segments, handler, opts }
  }

  // opts (opcional): { raw: true } -> o corpo da requisição NÃO é lido como JSON; a própria rota
  // recebe o fluxo de bytes em "req" (usado no envio de arquivos, que pode ter dezenas de MB).
  _add(method, routePath, handler, opts) {
    const segments = routePath.split('/').filter(Boolean);
    this.routes.push({ method, segments, handler, opts: opts || {} });
  }

  get(p, h, o) { this._add('GET', p, h, o); }
  post(p, h, o) { this._add('POST', p, h, o); }
  put(p, h, o) { this._add('PUT', p, h, o); }
  delete(p, h, o) { this._add('DELETE', p, h, o); }

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
      if (ok) return { handler: route.handler, params, opts: route.opts };
    }
    return null;
  }

  async handle(req, res, staticDir) {
    // Um endereço malformado (ex.: "/%E0%A4%A" ou "/api/x/%25zz") faz decodeURIComponent lançar
    // erro. Antes isso acontecia fora de qualquer try/catch e derrubava o servidor inteiro;
    // agora vira uma resposta 400 e o servidor segue no ar.
    let parsed;
    let pathname;
    let match = null;
    try {
      parsed = url.parse(req.url, true);
      pathname = decodeURIComponent(parsed.pathname || '/');
      if (pathname.startsWith('/api/')) match = this._match(req.method, pathname);
    } catch (e) {
      sendJson(res, 400, { error: 'Endereço inválido' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (!match) {
        sendJson(res, 404, { error: 'Rota não encontrada' });
        return;
      }
      try {
        req.params = match.params;
        req.query = parsed.query;
        if (match.opts && match.opts.raw) {
          req.body = {}; // a rota lê o corpo por conta própria (envio de arquivo)
        } else if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
          req.body = await readJsonBody(req);
        } else {
          req.body = {};
        }
        await match.handler(req, res);
      } catch (err) {
        if (res.headersSent) {
          // Já começou a responder (ex.: download interrompido): não dá para mandar um erro em
          // JSON por cima; só encerra a conexão.
          console.error('Erro depois de iniciar a resposta:', err);
          res.destroy();
        } else if (err && err.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
        } else {
          console.error('Erro interno:', err);
          sendJson(res, 500, { error: 'Erro interno do servidor' });
        }
      }
      return;
    }

    // Servir arquivos estáticos do frontend
    try {
      serveStatic(req, res, pathname, staticDir);
    } catch (e) {
      // Ex.: endereço com caractere nulo ("/%00"), que o sistema de arquivos recusa na hora.
      if (!res.headersSent) { res.writeHead(400); res.end('Bad request'); } else { res.destroy(); }
    }
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
