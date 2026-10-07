// server/routes/payments.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

function register(router) {
  // ---- PAGAMENTOS AVULSOS (aula a aula, só de alunos que NÃO são de pagamento mensal) ----
  // `happened` = a aula já começou (decidido aqui, no fuso do servidor). Aula que já
  // aconteceu e não foi paga é cobrança "devida agora"; aula futura ainda não venceu.
  router.get('/api/payments/receivable', async (req, res) => {
    requireAuth(req);
    svc.runPeriodicChecks(db);
    const nowStr = svc.formatLocalDateTime(new Date());
    const rows = db.prepare(`
      SELECT classes.id, classes.start_time, classes.end_time, classes.student_value, classes.student_paid, classes.student_paid_at,
             students.id AS student_id, students.name AS student_name, subjects.name AS subject_name,
             CASE WHEN classes.start_time <= ? THEN 1 ELSE 0 END AS happened
      FROM classes
      JOIN students ON students.id = classes.student_id
      JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.status = 'scheduled' AND classes.student_paid = 0 AND students.monthly_payment = 0
      ORDER BY classes.start_time
    `).all(nowStr);
    sendJson(res, 200, rows.map(r => ({ ...r, happened: !!r.happened })));
  });

  router.post('/api/payments/class/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    db.prepare("UPDATE classes SET student_paid = 1, student_paid_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // Marca várias aulas de uma vez (um único UPDATE, então ou vai tudo ou nada). Só mexe em
  // aulas ativas, ainda não pagas, de alunos de pagamento por aula.
  router.post('/api/payments/class/mark-paid-bulk', async (req, res) => {
    requireAuth(req);
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (ids.length === 0) throw httpError(400, 'Nenhuma aula informada');
    if (ids.length > 500) throw httpError(400, 'Aulas demais de uma vez (máximo 500)');
    const placeholders = ids.map(() => '?').join(',');
    // RETURNING devolve exatamente as aulas que mudaram agora (as que já estavam pagas ficam de fora);
    // é isso que o botão "Desfazer" usa para reverter só o que este clique marcou.
    const changed = db.prepare(`
      UPDATE classes SET student_paid = 1, student_paid_at = datetime('now', 'localtime')
      WHERE id IN (${placeholders}) AND status = 'scheduled' AND student_paid = 0
        AND student_id IN (SELECT id FROM students WHERE monthly_payment = 0)
      RETURNING id
    `).all(...ids);
    sendJson(res, 200, { updated: changed.length, ids: changed.map((r) => Number(r.id)) });
  });

  router.post('/api/payments/class/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    db.prepare('UPDATE classes SET student_paid = 0, student_paid_at = NULL WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // Volta várias aulas para "pendente" de uma vez (desfaz o "marcar o mês como recebido"). Só mexe em
  // aulas que estão pagas; as demais ficam como estão.
  router.post('/api/payments/class/mark-pending-bulk', async (req, res) => {
    requireAuth(req);
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (ids.length === 0) throw httpError(400, 'Nenhuma aula informada');
    if (ids.length > 500) throw httpError(400, 'Aulas demais de uma vez (máximo 500)');
    const placeholders = ids.map(() => '?').join(',');
    const changed = db.prepare(`
      UPDATE classes SET student_paid = 0, student_paid_at = NULL
      WHERE id IN (${placeholders}) AND student_paid = 1
      RETURNING id
    `).all(...ids);
    sendJson(res, 200, { updated: changed.length, ids: changed.map((r) => Number(r.id)) });
  });

  // ---- PAGAMENTOS MENSAIS (alunos marcados como "pagamento mensal" no cadastro) ----
  // Um item por aluno e por mês, com o TOTAL das aulas do mês somado na hora (não existe mais
  // valor digitado à mão). Meses sem nenhuma aula não aparecem.
  router.get('/api/payments/monthly', async (req, res) => {
    requireAuth(req);
    svc.runPeriodicChecks(db);
    sendJson(res, 200, svc.pendingMonthlyBilling(db));
  });

  // Ao marcar como recebida, guarda o total calculado naquele momento em `value` — é o
  // "quanto foi recebido" que o Histórico e o Financeiro usam, e que não muda depois.
  router.post('/api/payments/monthly-charge/:id/mark-paid', async (req, res) => {
    requireAuth(req);
    const charge = db.prepare('SELECT * FROM monthly_charges WHERE id = ?').get(req.params.id);
    if (!charge) throw httpError(404, 'Mensalidade não encontrada');
    const { total } = svc.monthTotalForStudent(db, charge.student_id, charge.year, charge.month);
    db.prepare("UPDATE monthly_charges SET status = 'paid', paid_at = datetime('now', 'localtime'), value = ? WHERE id = ?")
      .run(total, req.params.id);
    sendJson(res, 200, { ok: true, value: total });
  });

  router.post('/api/payments/monthly-charge/:id/mark-pending', async (req, res) => {
    requireAuth(req);
    // value volta a 0, como era antes de ser recebida: enquanto pendente, o total é sempre calculado na hora.
    db.prepare("UPDATE monthly_charges SET status = 'pending', paid_at = NULL, value = 0 WHERE id = ?").run(req.params.id);
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

    // Aluno de pagamento mensal: o que vale é a mensalidade do mês (soma das aulas), não o
    // status de cada aula individualmente.
    let monthly = null;
    if (student.monthly_payment) {
      const t = svc.monthTotalForStudent(db, student.id, year, month);
      const charge = db.prepare(
        'SELECT id, status, value, paid_at FROM monthly_charges WHERE student_id = ? AND year = ? AND month = ?'
      ).get(student.id, year, month) || null;
      monthly = { total: t.total, classCount: t.classCount, zeroValueCount: t.zeroValueCount, charge };
    }

    sendJson(res, 200, {
      student: { id: student.id, name: student.name, guardian_name: student.guardian_name, monthly_payment: !!student.monthly_payment },
      year, month,
      classes: classes.map(c => ({ ...c, student_paid: !!c.student_paid })),
      monthly,
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
