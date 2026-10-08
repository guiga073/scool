// server/routes/finance.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

// Mês pedido na URL (?year=2026&month=9). Sem nada, é o mês atual. Valor fora do normal dá erro 400.
function parseMonth(req) {
  const now = new Date();
  const q = req.query || {};
  const has = (v) => v !== undefined && v !== '';
  if (!has(q.year) && !has(q.month)) return { year: now.getFullYear(), month: now.getMonth() + 1 };
  const year = Number(q.year);
  const month = Number(q.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw httpError(400, 'Mês inválido');
  }
  return { year, month };
}

function register(router) {
  // Série de N meses. Por padrão termina no mês atual; com ?end=2026-09 termina no mês pedido
  // (meses que ainda não chegaram vêm com a previsão pela agenda, marcados com projected: true).
  router.get('/api/finance/monthly', async (req, res) => {
    requireAuth(req);
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
    let endRef = null;
    if (req.query.end) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.end));
      const y = m && Number(m[1]);
      const mo = m && Number(m[2]);
      if (!m || y < 2000 || y > 2100 || mo < 1 || mo > 12) throw httpError(400, 'Mês inválido');
      endRef = new Date(y, mo - 1, 1);
    }
    sendJson(res, 200, svc.monthlyFinancialSeries(db, months, endRef));
  });

  // Previsão de um mês (projeção com tudo que está agendado — ver monthForecast). Sem ?year&month, o mês atual.
  router.get('/api/finance/forecast', async (req, res) => {
    requireAuth(req);
    const { year, month } = parseMonth(req);
    svc.runPeriodicChecks(db); // garante mensalidades e despesas recorrentes do mês atual já geradas
    sendJson(res, 200, svc.monthForecast(db, new Date(year, month - 1, 1)));
  });

  // Faturamento por disciplina e custo por professor de um mês (o previsto, se o mês ainda não chegou).
  router.get('/api/finance/breakdown', async (req, res) => {
    requireAuth(req);
    const { year, month } = parseMonth(req);
    sendJson(res, 200, svc.monthBreakdown(db, new Date(year, month - 1, 1)));
  });
}

module.exports = { register };
