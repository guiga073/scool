// server/services.js
// Regras de negócio principais do sistema.

// ---------- Quinzenas ----------

// Dado um ano/mês (mês 0-indexado, como Date.getMonth()), devolve as duas
// quinzenas daquele mês como strings 'YYYY-MM-DD HH:MM:SS'.
function getQuinzenaPeriods(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  const fmt = (y, m, d, h, mi, s) => `${y}-${pad(m + 1)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
  return {
    first: {
      start: fmt(year, month, 1, 0, 0, 0),
      end: fmt(year, month, 15, 23, 59, 59),
    },
    second: {
      start: fmt(year, month, 16, 0, 0, 0),
      end: fmt(year, month, lastDay, 23, 59, 59),
    },
  };
}

// Dada uma data (objeto Date, hora local), devolve a quinzena à qual ela pertence.
function quinzenaForDate(date) {
  const { first, second } = getQuinzenaPeriods(date.getFullYear(), date.getMonth());
  return date.getDate() <= 15 ? first : second;
}

// ---------- Conflitos de horário ----------

// Verifica se um novo agendamento colide com aulas já registradas (não canceladas)
// do mesmo professor OU do mesmo aluno. Datas em formato 'YYYY-MM-DD HH:MM:SS'.
function findConflicts(db, { teacherId, studentId, startTime, endTime, excludeClassId }) {
  let sql = `
    SELECT classes.id, classes.start_time, classes.end_time, classes.teacher_id, classes.student_id,
           students.name AS student_name, teachers.name AS teacher_name
    FROM classes
    JOIN students ON students.id = classes.student_id
    JOIN teachers ON teachers.id = classes.teacher_id
    WHERE classes.status = 'scheduled'
      AND classes.start_time < ?
      AND classes.end_time > ?
      AND (classes.teacher_id = ? OR classes.student_id = ?)
  `;
  const params = [endTime, startTime, teacherId, studentId];
  if (excludeClassId) {
    sql += ' AND classes.id != ?';
    params.push(excludeClassId);
  }
  return db.prepare(sql).all(...params);
}

// ---------- Faturas quinzenais dos professores ----------

function calcPeriodTotals(db, teacherId, periodStart, periodEnd) {
  const rows = db.prepare(
    `SELECT teacher_value, start_time, end_time FROM classes
     WHERE teacher_id = ? AND status = 'scheduled' AND start_time >= ? AND start_time <= ?`
  ).all(teacherId, periodStart, periodEnd);

  let totalValue = 0;
  let totalHours = 0;
  for (const r of rows) {
    totalValue += Number(r.teacher_value) || 0;
    const start = new Date(r.start_time.replace(' ', 'T'));
    const end = new Date(r.end_time.replace(' ', 'T'));
    totalHours += (end - start) / 3600000;
  }
  return { totalValue: round2(totalValue), totalHours: round2(totalHours), count: rows.length };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Mantém em dia a fatura (pendente) de um professor para a quinzena que contém `date`.
// Se a fatura já foi marcada como paga, ela não é mais tocada (fica congelada).
// Se o período ainda não terminou, só atualiza uma fatura pendente já existente
// (não cria uma fatura nova antes do fim do período).
function syncInvoiceForDate(db, teacherId, date) {
  const period = quinzenaForDate(date);
  const existing = db.prepare(
    'SELECT * FROM teacher_invoices WHERE teacher_id = ? AND period_start = ? AND period_end = ?'
  ).get(teacherId, period.start, period.end);

  if (existing && existing.status === 'paid') return; // congelada, não mexe

  const totals = calcPeriodTotals(db, teacherId, period.start, period.end);
  const periodEnded = new Date() > new Date(period.end.replace(' ', 'T'));

  if (existing) {
    if (totals.count === 0) {
      db.prepare('DELETE FROM teacher_invoices WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE teacher_invoices SET total_value = ?, total_hours = ? WHERE id = ?')
        .run(totals.totalValue, totals.totalHours, existing.id);
    }
  } else if (periodEnded && totals.count > 0) {
    db.prepare(
      `INSERT INTO teacher_invoices (teacher_id, period_start, period_end, total_value, total_hours, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(teacherId, period.start, period.end, totals.totalValue, totals.totalHours);
  }
}

// Varre todos os professores e garante que toda quinzena já encerrada (dos últimos
// N meses, para cobrir o caso do servidor ter ficado fora do ar) tenha fatura gerada.
function ensureAllInvoicesGenerated(db, monthsBack = 3) {
  const now = new Date();
  const teachers = db.prepare('SELECT id FROM teachers').all();
  const periods = [];
  for (let i = 0; i < monthsBack; i++) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const { first, second } = getQuinzenaPeriods(ref.getFullYear(), ref.getMonth());
    periods.push(first, second);
  }
  for (const period of periods) {
    if (now <= new Date(period.end.replace(' ', 'T'))) continue; // período ainda não terminou
    for (const t of teachers) {
      const existing = db.prepare(
        'SELECT id FROM teacher_invoices WHERE teacher_id = ? AND period_start = ? AND period_end = ?'
      ).get(t.id, period.start, period.end);
      if (existing) continue;
      const totals = calcPeriodTotals(db, t.id, period.start, period.end);
      if (totals.count === 0) continue;
      db.prepare(
        `INSERT INTO teacher_invoices (teacher_id, period_start, period_end, total_value, total_hours, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      ).run(t.id, period.start, period.end, totals.totalValue, totals.totalHours);
    }
  }
}

// ---------- Mensalidades (pagamento mensal de alunos) ----------

function ensureMonthlyChargesGenerated(db) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const students = db.prepare('SELECT id, monthly_value FROM students WHERE monthly_payment = 1 AND active = 1').all();
  for (const s of students) {
    const existing = db.prepare(
      'SELECT id FROM monthly_charges WHERE student_id = ? AND month = ? AND year = ?'
    ).get(s.id, month, year);
    if (existing) continue;
    db.prepare(
      'INSERT INTO monthly_charges (student_id, month, year, value) VALUES (?, ?, ?, ?)'
    ).run(s.id, month, year, s.monthly_value || 0);
  }
}

// Roda todas as verificações periódicas de uma vez (usada no boot e no cron).
function runPeriodicChecks(db) {
  ensureAllInvoicesGenerated(db);
  ensureMonthlyChargesGenerated(db);
}

// ---------- Aulas recorrentes (acompanhamento) ----------

// Gera uma aula por semana, no mesmo dia da semana e horário, entre startDate e endDate (inclusive).
// dayOfWeek: 0 (domingo) a 6 (sábado). startTime/endTime: 'HH:MM'.
function buildRecurringOccurrences({ dayOfWeek, startTime, endTime, startDate, endDate }) {
  const pad = (n) => String(n).padStart(2, '0');
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);

  // Ancora em meio-dia para evitar qualquer problema de horário de verão ao somar dias.
  let cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  const diff = (dayOfWeek - cursor.getDay() + 7) % 7;
  cursor.setDate(cursor.getDate() + diff);

  const occurrences = [];
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const d = cursor.getDate();
    occurrences.push({
      startTime: `${y}-${pad(m + 1)}-${pad(d)} ${pad(sh)}:${pad(sm)}:00`,
      endTime: `${y}-${pad(m + 1)}-${pad(d)} ${pad(eh)}:${pad(em)}:00`,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return occurrences;
}

module.exports = {
  getQuinzenaPeriods,
  quinzenaForDate,
  findConflicts,
  calcPeriodTotals,
  syncInvoiceForDate,
  ensureAllInvoicesGenerated,
  ensureMonthlyChargesGenerated,
  runPeriodicChecks,
  buildRecurringOccurrences,
  round2,
};
