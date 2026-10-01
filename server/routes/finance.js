// server/routes/finance.js
const { db } = require('../db');
const { sendJson } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

function register(router) {
  router.get('/api/finance/monthly', async (req, res) => {
    requireAuth(req);
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
    sendJson(res, 200, svc.monthlyFinancialSeries(db, months));
  });

  router.get('/api/finance/breakdown', async (req, res) => {
    requireAuth(req);
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    sendJson(res, 200, svc.monthBreakdown(db, new Date(year, month - 1, 1)));
  });
}

module.exports = { register };
