// server/routes/payments.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

function register(router) {
  // ---- A RECEBER (aulas avulsas de alunos que NÃO são de pagamento mensal) ----
  router.get('/api/payments/receivable', async (req, res) => {
    requireAuth(req);
    svc.runPeriodicChecks(db);
    const rows = db.prepare(`
      SELECT classes.id, classes.start_time, classes.end_time, classes.student_value, classes.student_paid, classes.student_paid_at,
             students.id AS student_id, students.name AS student_name, subjects.name AS subject_name
      FROM classes
      JOIN students ON students.id = classes.student_id
      JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.status = 'scheduled' AND classes.student_paid = 0 AND students.monthly_payment = 0
      ORDER BY classes.start_time
    `).all();
    sendJson(res, 200, rows);
  });

  router.post('/api/payments/class/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE classes SET student_paid = 1, student_paid_at = datetime('now') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/payments/class/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare('UPDATE classes SET student_paid = 0, student_paid_at = NULL WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- PAGAMENTOS ESPECIAIS (alunos de mensalidade) ----
  router.get('/api/payments/special', async (req, res) => {
    requireAuth(req);
    svc.runPeriodicChecks(db);
    const rows = db.prepare(`
      SELECT monthly_charges.*, students.name AS student_name
      FROM monthly_charges
      JOIN students ON students.id = monthly_charges.student_id
      WHERE monthly_charges.status = 'pending'
      ORDER BY monthly_charges.year DESC, monthly_charges.month DESC, students.name
    `).all();
    sendJson(res, 200, rows);
  });

  router.post('/api/payments/monthly-charge/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE monthly_charges SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/payments/monthly-charge/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE monthly_charges SET status = 'pending', paid_at = NULL WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- A PAGAR (faturas quinzenais dos professores) ----
  router.get('/api/payments/payable', async (req, res) => {
    requireAuth(req);
    svc.runPeriodicChecks(db);
    const invoices = db.prepare(`
      SELECT teacher_invoices.*, teachers.name AS teacher_name
      FROM teacher_invoices
      JOIN teachers ON teachers.id = teacher_invoices.teacher_id
      WHERE teacher_invoices.status = 'pending'
      ORDER BY teacher_invoices.period_start DESC
    `).all();

    // Quinzena em andamento (ainda não fechou, então ainda não virou fatura) — apenas para visibilidade.
    const now = new Date();
    const { first, second } = svc.getQuinzenaPeriods(now.getFullYear(), now.getMonth());
    const currentPeriod = now.getDate() <= 15 ? first : second;
    const teachers = db.prepare('SELECT id, name FROM teachers WHERE active = 1').all();
    const inProgress = teachers.map(t => {
      const totals = svc.calcPeriodTotals(db, t.id, currentPeriod.start, currentPeriod.end);
      return { teacher_id: t.id, teacher_name: t.name, period_start: currentPeriod.start, period_end: currentPeriod.end, ...totals };
    }).filter(t => t.count > 0);

    sendJson(res, 200, { invoices, inProgress });
  });

  router.post('/api/payments/invoice/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE teacher_invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/payments/invoice/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE teacher_invoices SET status = 'pending', paid_at = NULL WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- DESPESAS ----
  router.get('/api/expenses', async (req, res) => {
    requireAuth(req);
    const rows = db.prepare("SELECT * FROM expenses WHERE status = 'pending' ORDER BY due_date IS NULL, due_date, created_at DESC").all();
    sendJson(res, 200, rows);
  });

  router.post('/api/expenses', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    if (!b.description || !b.description.trim()) throw httpError(400, 'Descrição é obrigatória');
    const info = db.prepare('INSERT INTO expenses (description, value, due_date) VALUES (?, ?, ?)')
      .run(b.description.trim(), Number(b.value) || 0, b.due_date || null);
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
    sendJson(res, 201, row);
  });

  router.put('/api/expenses/:id', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Despesa não encontrada');
    db.prepare('UPDATE expenses SET description=?, value=?, due_date=? WHERE id=?')
      .run(b.description || existing.description, Number(b.value ?? existing.value), b.due_date ?? existing.due_date, req.params.id);
    sendJson(res, 200, db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id));
  });

  router.post('/api/expenses/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE expenses SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/expenses/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE expenses SET status = 'pending', paid_at = NULL WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.delete('/api/expenses/:id', async (req, res) => {
    requireAuth(req);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- HISTÓRICO / RELATÓRIO (tudo que já foi pago/recebido) ----
  router.get('/api/payments/history', async (req, res) => {
    requireAuth(req);
    const receivedClasses = db.prepare(`
      SELECT classes.id, 'aula' AS type, students.name AS name, classes.student_value AS value,
             classes.student_paid_at AS paid_at, classes.start_time AS reference_date
      FROM classes JOIN students ON students.id = classes.student_id
      WHERE classes.student_paid = 1
    `).all();

    const receivedMonthly = db.prepare(`
      SELECT monthly_charges.id, 'mensalidade' AS type, students.name AS name, monthly_charges.value AS value,
             monthly_charges.paid_at AS paid_at, monthly_charges.month || '/' || monthly_charges.year AS reference_date
      FROM monthly_charges JOIN students ON students.id = monthly_charges.student_id
      WHERE monthly_charges.status = 'paid'
    `).all();

    const paidInvoices = db.prepare(`
      SELECT teacher_invoices.id, 'fatura_professor' AS type, teachers.name AS name, teacher_invoices.total_value AS value,
             teacher_invoices.paid_at AS paid_at, teacher_invoices.period_start AS reference_date
      FROM teacher_invoices JOIN teachers ON teachers.id = teacher_invoices.teacher_id
      WHERE teacher_invoices.status = 'paid'
    `).all();

    const paidExpenses = db.prepare(`
      SELECT id, 'despesa' AS type, description AS name, value, paid_at, due_date AS reference_date
      FROM expenses WHERE status = 'paid'
    `).all();

    const all = [...receivedClasses, ...receivedMonthly, ...paidInvoices, ...paidExpenses]
      .sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));

    sendJson(res, 200, all);
  });
}

module.exports = { register };
