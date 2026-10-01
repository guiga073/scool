// server/routes/adminTools.js
// Ferramentas administrativas de uso pontual (não são fluxos do dia a dia).

const { db } = require('../db');
const { sendJson } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

function register(router) {
  router.post('/api/admin/recalculate-historical-values', async (req, res) => {
    requireAuth(req);
    const result = svc.recalculateHistoricalValues(db);
    sendJson(res, 200, result);
  });
}

module.exports = { register };
