// server/routes/freebies.js
// Materiais gratuitos com cadastro (Manual do ENEM).
//   Públicas (chamadas pela página do site, olimais.com.br):  GET/POST /api/gratis/:slug, GET /api/gratis/baixar/:token
//   Painel (só administração): /api/admin/downloads/...
// As regras ficam em server/freebies.js.

const fs = require('fs');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const { isNavigation, sendErrorPage } = require('./materials');
const fb = require('../freebies');

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || '?';
}

// O formulário fica no site (outro endereço): só o site da OLIMAIS pode ler as respostas (CORS).
// O site envia como "text/plain" (pedido simples, sem consulta prévia do navegador).
function cors(req, res) {
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (origin && fb.allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

function idParam(req) {
  const id = fb.asId(req.params.id);
  if (!id) throw httpError(404, 'Não encontrado.');
  return id;
}

function sendPdf(res, file, fileName, disposition) {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': stat.size,
    'Content-Disposition': `${disposition}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

function register(router) {
  // ---------- públicas ----------

  router.get('/api/gratis/baixar/:token', async (req, res) => {
    try {
      const { file, fileName } = fb.downloadFile(req.params.token);
      sendPdf(res, file, fileName, 'attachment');
    } catch (err) {
      if (err && err.statusCode && !res.headersSent && isNavigation(req)) { sendErrorPage(res, err.statusCode, err.message); return; }
      throw err;
    }
  });

  router.get('/api/gratis/:slug', async (req, res) => {
    cors(req, res);
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, fb.publicMaterial(req.params.slug));
  });

  router.post('/api/gratis/:slug', async (req, res) => {
    cors(req, res);
    // Navegador em outro site tentando cadastrar pessoas aqui: recusa (o navegador sempre manda o Origin).
    const origin = String(req.headers.origin || '').replace(/\/+$/, '');
    if (origin && !fb.allowedOrigins().includes(origin)) throw httpError(403, 'Origem não permitida.');
    sendJson(res, 201, await fb.register(req.params.slug, req.body, clientIp(req)));
  });

  // ---------- painel ----------

  router.get('/api/admin/downloads/resumo', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.summary()); });

  router.get('/api/admin/downloads/pessoas', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.listPeople(req.query)); });
  router.get('/api/admin/downloads/pessoas.csv', async (req, res) => {
    requireAuth(req);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="downloads-manual-olimais.csv"' });
    res.end(fb.csv());
  });
  router.get('/api/admin/downloads/pessoas/:id', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.getPerson(idParam(req))); });
  router.put('/api/admin/downloads/pessoas/:id', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.updatePerson(idParam(req), req.body)); });
  router.post('/api/admin/downloads/pessoas/:id/interessado', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.addToLeads(idParam(req))); });
  router.delete('/api/admin/downloads/pessoas/:id', async (req, res) => { requireAuth(req); fb.removePerson(idParam(req)); sendJson(res, 200, { ok: true }); });

  router.get('/api/admin/downloads/materiais', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.listMaterials()); });
  router.put('/api/admin/downloads/materiais/:id', async (req, res) => { requireAuth(req); sendJson(res, 200, fb.updateMaterial(idParam(req), req.body)); });
  router.post('/api/admin/downloads/materiais/:id/arquivo', async (req, res) => {
    requireAuth(req);
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { name = ''; }
    sendJson(res, 200, await fb.saveMaterialFile(idParam(req), req, name));
  }, { raw: true });
  router.get('/api/admin/downloads/materiais/:id/arquivo', async (req, res) => {
    requireAuth(req);
    const m = fb.materialRow(idParam(req));
    const file = fb.materialFile(m);
    if (!file) throw httpError(404, 'Este material ainda não tem PDF.');
    sendPdf(res, file, fb.fileNameFor(m), 'inline');
  });
}

module.exports = { register };
