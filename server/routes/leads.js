// server/routes/leads.js
// Controle de interessados: pais e responsáveis que pediram informações e ainda não agendaram aula.
//
// REGRA DE ACESSO (a mesma de todas as telas da administração): só quem entrou como administrador.
// Professor, aluno e visitante recebem 401 em TODAS as rotas daqui. A conferência de login é sempre a
// primeira coisa de cada rota.
//
// Os dados ficam em server/leads.js.

const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const leads = require('../leads');

function leadId(req) {
  const id = leads.asId(req.params.id);
  if (id === null) throw httpError(404, 'Interessado não encontrado');
  return id;
}

function register(router) {
  // Precisa vir ANTES de "/api/leads/:id", senão "config" seria entendido como um código.
  router.get('/api/leads/config', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, leads.config());
  });

  // Lista. Filtros opcionais: ?search=texto, ?reason=código (valor, interno, outros ou nenhum) e ?subjectId=código.
  router.get('/api/leads', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, leads.list(req.query));
  });

  router.post('/api/leads', async (req, res) => {
    requireAuth(req);
    sendJson(res, 201, leads.create(req.body));
  });

  router.get('/api/leads/:id', async (req, res) => {
    requireAuth(req);
    const lead = leads.get(leadId(req));
    if (!lead) throw httpError(404, 'Interessado não encontrado');
    sendJson(res, 200, lead);
  });

  // Edição parcial: só os campos enviados são alterados.
  router.put('/api/leads/:id', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, leads.update(leadId(req), req.body));
  });

  router.delete('/api/leads/:id', async (req, res) => {
    requireAuth(req);
    leads.remove(leadId(req));
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register };
