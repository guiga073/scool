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
    db.prepare("UPDATE classes SET student_paid = 1, student_paid_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
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

  router.put('/api/payments/monthly-charge/:id', async (req, res) => {
    requireAuth(req);
    const value = Number(req.body && req.body.value);
    if (!Number.isFinite(value) || value < 0) throw httpError(400, 'Valor inválido');
    const existing = db.prepare('SELECT * FROM monthly_charges WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Mensalidade não encontrada');
    db.prepare('UPDATE monthly_charges SET value = ? WHERE id = ?').run(value, req.params.id);
    sendJson(res, 200, db.prepare('SELECT * FROM monthly_charges WHERE id = ?').get(req.params.id));
  });

  router.post('/api/payments/monthly-charge/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE monthly_charges SET status = 'paid', paid_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/payments/monthly-charge/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE monthly_charges SET status = 'pending', paid_at = NULL WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.delete('/api/payments/monthly-charge/:id', async (req, res) => {
    requireAuth(req);
    db.prepare('DELETE FROM monthly_charges WHERE id = ?').run(req.params.id);
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
    db.prepare("UPDATE teacher_invoices SET status = 'paid', paid_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.post('/api/payments/invoice/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE teacher_invoices SET status = 'pending', paid_at = NULL WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.delete('/api/payments/invoice/:id', async (req, res) => {
    requireAuth(req);
    db.prepare('DELETE FROM teacher_invoices WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- DESPESAS ----
  router.get('/api/expenses', async (req, res) => {
    requireAuth(req);
    svc.runPeriodicChecks(db);
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
    db.prepare("UPDATE expenses SET status = 'paid', paid_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
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

  // ---- DESPESAS RECORRENTES (assinaturas mensais etc.) ----
  router.get('/api/expenses/recurring', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, db.prepare('SELECT * FROM recurring_expenses WHERE active = 1 ORDER BY description').all());
  });

  router.post('/api/expenses/recurring', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    if (!b.description || !b.description.trim()) throw httpError(400, 'Descrição é obrigatória');
    const day = Math.min(31, Math.max(1, Number(b.day_of_month) || 1));
    const info = db.prepare('INSERT INTO recurring_expenses (description, value, day_of_month) VALUES (?, ?, ?)')
      .run(b.description.trim(), Number(b.value) || 0, day);
    svc.ensureRecurringExpensesGenerated(db);
    sendJson(res, 201, db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/api/expenses/recurring/:id', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    const existing = db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Despesa recorrente não encontrada');
    if (!b.description || !b.description.trim()) throw httpError(400, 'Descrição é obrigatória');
    const day = Math.min(31, Math.max(1, Number(b.day_of_month) || existing.day_of_month));
    db.prepare('UPDATE recurring_expenses SET description=?, value=?, day_of_month=? WHERE id=?')
      .run(b.description.trim(), Number(b.value) || 0, day, req.params.id);
    svc.syncRecurringExpenseCurrentMonth(db, req.params.id);
    sendJson(res, 200, db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(req.params.id));
  });

  // "Excluir" só desativa — para de gerar despesas novas, mas as que já existem (inclusive
  // pendentes) continuam, porque já são compromissos reais daquele mês.
  router.delete('/api/expenses/recurring/:id', async (req, res) => {
    requireAuth(req);
    db.prepare('UPDATE recurring_expenses SET active = 0 WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- Busca por aluno/responsável (Histórico → "quais aulas esse aluno já pagou?") ----
  router.get('/api/payments/student-search', async (req, res) => {
    requireAuth(req);
    const q = (req.query.q || '').trim();
    if (!q) { sendJson(res, 200, []); return; }
    const like = `%${q}%`;
    sendJson(res, 200, db.prepare(
      `SELECT id, name, guardian_name, monthly_payment FROM students
       WHERE active = 1 AND (name LIKE ? OR guardian_name LIKE ?) ORDER BY name`
    ).all(like, like));
  });

  // Aulas (e mensalidade, se for o caso) de UM aluno, num mês específico, com status de pagamento.
  router.get('/api/payments/student/:id/month', async (req, res) => {
    requireAuth(req);
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!student) throw httpError(404, 'Aluno não encontrado');
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || (now.getMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    const start = `${year}-${pad(month)}-01 00:00:00`;
    const end = `${year}-${pad(month)}-${pad(lastDay)} 23:59:59`;

    const classes = db.prepare(`
      SELECT classes.*, subjects.name AS subject_name, teachers.name AS teacher_name
      FROM classes
      JOIN subjects ON subjects.id = classes.subject_id
      JOIN teachers ON teachers.id = classes.teacher_id
      WHERE classes.student_id = ? AND classes.status = 'scheduled'
        AND classes.start_time >= ? AND classes.start_time <= ?
      ORDER BY classes.start_time
    `).all(req.params.id, start, end);

    let monthlyCharge = null;
    if (student.monthly_payment) {
      monthlyCharge = db.prepare(
        'SELECT * FROM monthly_charges WHERE student_id = ? AND year = ? AND month = ?'
      ).get(req.params.id, year, month) || null;
    }

    sendJson(res, 200, {
      student: { id: student.id, name: student.name, guardian_name: student.guardian_name, monthly_payment: !!student.monthly_payment },
      year, month,
      classes: classes.map(c => ({ ...c, student_paid: !!c.student_paid })),
      monthlyCharge,
    });
  });

  // ---- HISTÓRICO / RELATÓRIO (tudo que já foi pago/recebido) ----
  router.get('/api/payments/history', async (req, res) => {
    requireAuth(req);
    const receivedClasses = db.prepare(`
      SELECT classes.id, 'aula' AS type, students.name AS name, classes.student_value AS value,
             classes.student_paid_at AS paid_at, classes.start_time AS reference_date
      FROM classes JOIN students ON students.id = classes.student_id
      WHERE classes.student_paid = 1 AND classes.status = 'scheduled'
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
