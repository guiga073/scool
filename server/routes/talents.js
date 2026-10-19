// server/routes/talents.js
// Banco de talentos: potenciais professores que a administração quer guardar para o futuro.
//
// REGRA DE ACESSO (a mesma de todas as telas da administração): só quem entrou como administrador.
// Professor, aluno e visitante recebem 401 em TODAS as rotas daqui — inclusive no download do
// currículo e no envio dele. A conferência de login é sempre a primeira coisa de cada rota.
//
// Os dados e o currículo ficam em server/talents.js.

const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const { isNavigation, sendErrorPage } = require('./materials');
const tal = require('../talents');

function talentId(req) {
  const id = tal.asId(req.params.id);
  if (id === null) throw httpError(404, 'Talento não encontrado');
  return id;
}

// O nome do arquivo vai num cabeçalho, codificado com encodeURIComponent pelo navegador.
function decodeHeader(req, name) {
  const raw = req.headers[name];
  if (raw === undefined) return '';
  try {
    return decodeURIComponent(String(raw));
  } catch (e) {
    throw httpError(400, 'Dados do envio inválidos. Atualize a página e tente de novo.');
  }
}

// Se o envio é recusado antes de o arquivo ser lido e o arquivo é enorme, não vale a pena esperar o
// navegador mandar tudo: encerra a conexão depois de responder.
const DRAIN_LIMIT_BYTES = tal.MAX_CV_BYTES + 1000 * 1000;

function register(router) {
  // Precisa vir ANTES de "/api/talents/:id", senão "config" seria entendido como um código.
  router.get('/api/talents/config', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, tal.config());
  });

  // Lista. Filtros opcionais: ?search=texto e ?subjectId=código.
  router.get('/api/talents', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, tal.list(req.query));
  });

  router.post('/api/talents', async (req, res) => {
    requireAuth(req);
    sendJson(res, 201, tal.create(req.body));
  });

  router.get('/api/talents/:id', async (req, res) => {
    requireAuth(req);
    const talent = tal.get(talentId(req));
    if (!talent) throw httpError(404, 'Talento não encontrado');
    sendJson(res, 200, talent);
  });

  // Edição parcial: só os campos enviados são alterados.
  router.put('/api/talents/:id', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, tal.update(talentId(req), req.body));
  });

  router.delete('/api/talents/:id', async (req, res) => {
    requireAuth(req);
    tal.remove(talentId(req));
    sendJson(res, 200, { ok: true });
  });

  // Envio do currículo: o próprio arquivo é o corpo da requisição ("raw"), com o nome no cabeçalho
  // X-File-Name. Enviar de novo troca o currículo anterior.
  router.post('/api/talents/:id/cv', async (req, res) => {
    try {
      requireAuth(req);
      const talent = await tal.receiveCv(req, talentId(req), decodeHeader(req, 'x-file-name'));
      sendJson(res, 201, talent);
    } catch (err) {
      const declared = Number(req.headers['content-length']) || 0;
      if (!req.complete && declared > DRAIN_LIMIT_BYTES) res.setHeader('Connection', 'close');
      throw err;
    }
  }, { raw: true });

  // Download do currículo (ou, para PDF e imagens, abrir no navegador com ?inline=1).
  router.get('/api/talents/:id/cv', async (req, res) => {
    try {
      requireAuth(req);
      tal.sendCv(res, talentId(req), { inline: req.query.inline === '1' });
    } catch (err) {
      // Quando a pessoa clica em "Baixar" e dá erro (sessão expirou, currículo removido), o navegador abre a
      // resposta numa aba: nesse caso, uma página legível em vez de texto técnico (JSON).
      if (err && err.statusCode && !res.headersSent && isNavigation(req)) { sendErrorPage(res, err.statusCode, err.message); return; }
      throw err;
    }
  });

  router.delete('/api/talents/:id/cv', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, tal.removeCv(talentId(req)));
  });
}

module.exports = { register };
