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

// Devolve o total da quinzena INTEIRA (todas as aulas agendadas nela — é o que a fatura vai
// ter quando a quinzena fechar) e, em `given`, só a parte que já aconteceu até `now`
// (aulas que já começaram). Em quinzenas já encerradas, `given` é igual ao total.
function calcPeriodTotals(db, teacherId, periodStart, periodEnd, now) {
  const nowStr = formatLocalDateTime(now || new Date());
  const rows = db.prepare(
    `SELECT teacher_value, transport_value, start_time, end_time FROM classes
     WHERE teacher_id = ? AND status = 'scheduled' AND start_time >= ? AND start_time <= ?`
  ).all(teacherId, periodStart, periodEnd);

  let totalValue = 0;
  let totalTransport = 0;
  let totalHours = 0;
  const given = { count: 0, totalValue: 0, totalTransport: 0, totalHours: 0 };
  for (const r of rows) {
    const transport = Number(r.transport_value) || 0;
    const value = (Number(r.teacher_value) || 0) + transport;
    const start = new Date(r.start_time.replace(' ', 'T'));
    const end = new Date(r.end_time.replace(' ', 'T'));
    const hours = (end - start) / 3600000;
    totalValue += value;
    totalTransport += transport;
    totalHours += hours;
    if (r.start_time <= nowStr) {
      given.count += 1;
      given.totalValue += value;
      given.totalTransport += transport;
      given.totalHours += hours;
    }
  }
  return {
    totalValue: round2(totalValue), totalTransport: round2(totalTransport), totalHours: round2(totalHours), count: rows.length,
    given: {
      count: given.count, totalValue: round2(given.totalValue),
      totalTransport: round2(given.totalTransport), totalHours: round2(given.totalHours),
    },
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Estado de uma quinzena em relação a "agora": 'open' (em andamento), 'closed' (já
// encerrou e virou fatura) ou 'upcoming' (ainda não começou).
function periodStatus(period, now) {
  const nowStr = formatLocalDateTime(now || new Date());
  if (nowStr > period.end) return 'closed';
  if (nowStr < period.start) return 'upcoming';
  return 'open';
}

// 'YYYY-MM-DD HH:MM:SS' no fuso do servidor (America/Sao_Paulo) — mesmo formato guardado
// no banco, então dá para comparar direto com start_time.
function formatLocalDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  const students = db.prepare('SELECT id FROM students WHERE monthly_payment = 1 AND active = 1').all();
  for (const s of students) {
    const existing = db.prepare(
      'SELECT id FROM monthly_charges WHERE student_id = ? AND month = ? AND year = ?'
    ).get(s.id, month, year);
    if (existing) continue;
    // Este registro só guarda o STATUS (pendente/pago) do mês. O valor mostrado enquanto
    // está pendente é sempre calculado na hora, somando as aulas do aluno naquele mês
    // (ver monthTotalForStudent); o campo `value` só é preenchido quando é marcado como
    // recebido, para guardar exatamente quanto foi recebido.
    db.prepare(
      'INSERT INTO monthly_charges (student_id, month, year, value) VALUES (?, ?, ?, 0)'
    ).run(s.id, month, year);
  }
}

// Soma das aulas (não canceladas) de UM aluno num mês — é o valor da mensalidade dele.
// Conta o mês inteiro, inclusive aulas que ainda vão acontecer.
function monthTotalForStudent(db, studentId, year, month, now) {
  const pad = (n) => String(n).padStart(2, '0');
  const nowStr = formatLocalDateTime(now || new Date());
  const r = db.prepare(`
    SELECT COUNT(*) AS class_count,
           COALESCE(SUM(student_value), 0) AS total,
           COALESCE(SUM(CASE WHEN start_time <= ? THEN 1 ELSE 0 END), 0) AS done_count,
           COALESCE(SUM(CASE WHEN student_value = 0 THEN 1 ELSE 0 END), 0) AS zero_value_count
    FROM classes
    WHERE student_id = ? AND status = 'scheduled' AND start_time LIKE ?
  `).get(nowStr, studentId, `${year}-${pad(month)}-%`);
  return {
    classCount: r.class_count, doneCount: r.done_count,
    total: round2(r.total), zeroValueCount: r.zero_value_count,
  };
}

// Mensalidades PENDENTES dos alunos de pagamento mensal, cada uma com o total das aulas
// do mês somado na hora. Meses sem nenhuma aula não aparecem (não há o que cobrar).
function pendingMonthlyBilling(db, now) {
  const pad = (n) => String(n).padStart(2, '0');
  const charges = db.prepare(`
    SELECT monthly_charges.id, monthly_charges.student_id, monthly_charges.year, monthly_charges.month,
           students.name AS student_name
    FROM monthly_charges
    JOIN students ON students.id = monthly_charges.student_id
    WHERE monthly_charges.status = 'pending' AND students.active = 1 AND students.monthly_payment = 1
    ORDER BY monthly_charges.year DESC, monthly_charges.month DESC, students.name
  `).all();
  const datesStmt = db.prepare(
    `SELECT start_time FROM classes WHERE student_id = ? AND status = 'scheduled' AND start_time LIKE ? ORDER BY start_time`
  );
  const out = [];
  for (const c of charges) {
    const t = monthTotalForStudent(db, c.student_id, c.year, c.month, now);
    if (t.classCount === 0) continue;
    const dates = datesStmt.all(c.student_id, `${c.year}-${pad(c.month)}-%`)
      .map((r) => `${r.start_time.slice(8, 10)}/${r.start_time.slice(5, 7)}`);
    out.push({
      id: c.id, student_id: c.student_id, student_name: c.student_name, year: c.year, month: c.month,
      classCount: t.classCount, doneCount: t.doneCount, total: t.total, zeroValueCount: t.zeroValueCount, dates,
    });
  }
  return out;
}

// Roda todas as verificações periódicas de uma vez (usada no boot e no cron).
function runPeriodicChecks(db) {
  ensureAllInvoicesGenerated(db);
  ensureMonthlyChargesGenerated(db);
  ensureRecurringExpensesGenerated(db);
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

// ---------- Despesas recorrentes (assinaturas mensais etc.) ----------

function clampDayOfMonth(year, month, day) {
  // month aqui é 1-indexado (1=Janeiro). new Date(year, month, 0) dá o último dia do mês "month".
  const lastDay = new Date(year, month, 0).getDate();
  return Math.min(day, lastDay);
}

// Garante que todo gabarito ativo tenha uma despesa gerada para o mês atual.
function ensureRecurringExpensesGenerated(db) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  const monthPrefix = `${year}-${pad(month)}-`;

  const templates = db.prepare('SELECT * FROM recurring_expenses WHERE active = 1').all();
  for (const t of templates) {
    const existing = db.prepare(
      `SELECT id FROM expenses WHERE recurring_expense_id = ? AND due_date LIKE ?`
    ).get(t.id, `${monthPrefix}%`);
    if (existing) continue;
    const day = clampDayOfMonth(year, month, t.day_of_month);
    db.prepare(
      `INSERT INTO expenses (description, value, due_date, recurring_expense_id) VALUES (?, ?, ?, ?)`
    ).run(t.description, t.value, `${monthPrefix}${pad(day)}`, t.id);
  }
}

// Se o gabarito for editado e a despesa deste mês ainda estiver pendente, atualiza ela
// junto — igual ao que já faço com as faturas de professor. Se já tiver sido paga, não mexe.
function syncRecurringExpenseCurrentMonth(db, templateId) {
  const t = db.prepare('SELECT * FROM recurring_expenses WHERE id = ?').get(templateId);
  if (!t) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  const monthPrefix = `${year}-${pad(month)}-`;
  const existing = db.prepare(
    `SELECT * FROM expenses WHERE recurring_expense_id = ? AND due_date LIKE ?`
  ).get(t.id, `${monthPrefix}%`);
  if (!existing || existing.status === 'paid') return;
  const day = clampDayOfMonth(year, month, t.day_of_month);
  db.prepare('UPDATE expenses SET description = ?, value = ?, due_date = ? WHERE id = ?')
    .run(t.description, t.value, `${monthPrefix}${pad(day)}`, existing.id);
}



// Um professor só pode ver/adicionar feedback de alunos com quem ele realmente já teve aula.
function teacherHasStudent(db, teacherId, studentId) {
  const row = db.prepare(
    `SELECT 1 FROM classes WHERE teacher_id = ? AND student_id = ? AND status = 'scheduled' LIMIT 1`
  ).get(teacherId, studentId);
  return !!row;
}

function listFeedback(db, teacherId, studentId) {
  return db.prepare(
    `SELECT * FROM class_feedback WHERE teacher_id = ? AND student_id = ? ORDER BY date DESC, id DESC`
  ).all(teacherId, studentId);
}

function addFeedback(db, teacherId, studentId, date, feedback) {
  const info = db.prepare(
    'INSERT INTO class_feedback (student_id, teacher_id, date, feedback) VALUES (?, ?, ?, ?)'
  ).run(studentId, teacherId, date, feedback);
  return db.prepare('SELECT * FROM class_feedback WHERE id = ?').get(info.lastInsertRowid);
}

function deleteFeedback(db, teacherId, studentId, feedbackId) {
  db.prepare(
    'DELETE FROM class_feedback WHERE id = ? AND teacher_id = ? AND student_id = ?'
  ).run(feedbackId, teacherId, studentId);
}

// ---------- Contas de acesso (e-mail de login) ----------

// Verifica se um e-mail de login já está em uso em QUALQUER tipo de conta
// (admin, professor ou aluno), para que o login por e-mail nunca fique ambíguo.
// exclude: { type: 'teacher'|'student', id } — ignora a própria conta ao editar.
function findLoginEmailConflict(db, email, exclude) {
  if (!email) return null;
  const adminExcludeId = (exclude && exclude.type === 'admin') ? exclude.id : 0;
  const asAdmin = db.prepare('SELECT id FROM admins WHERE email = ? AND id != ?').get(email, adminExcludeId);
  if (asAdmin) return 'admin';
  // Só contas ATIVAS seguram um login. Quem foi deletado (active = 0) é mantido no banco
  // apenas para preservar o histórico de aulas/pagamentos — não pode mais entrar no
  // sistema, então o usuário/e-mail dele precisa ficar livre para ser usado de novo.
  const teacherExcludeId = (exclude && exclude.type === 'teacher') ? exclude.id : 0;
  const asTeacher = db.prepare('SELECT id FROM teachers WHERE login_email = ? AND id != ? AND active = 1').get(email, teacherExcludeId);
  if (asTeacher) return 'teacher';
  const studentExcludeId = (exclude && exclude.type === 'student') ? exclude.id : 0;
  const asStudent = db.prepare('SELECT id FROM students WHERE login_email = ? AND id != ? AND active = 1').get(email, studentExcludeId);
  if (asStudent) return 'student';
  return null;
}

// ---------- Geração de credenciais (usado pelas ferramentas de geração em massa) ----------

const crypto = require('node:crypto');

// Senha fácil de digitar/ditar: só letras e números, sem caracteres parecidos entre si
// (0/O, 1/l/I ficam de fora de propósito).
function generatePassword(length = 5) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// Primeiro nome + último sobrenome, sem acento e só minúsculo — fácil de lembrar.
function slugifyNamePart(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toLowerCase().replace(/[^a-z]/g, ''); // só letras
}

// existingUsernames: um Set com os usuários já em uso (de qualquer tipo de conta) —
// a função adiciona o resultado nesse mesmo Set, para que o próximo nome gerado no
// mesmo lote já veja esse como ocupado também (evita duas pessoas com o mesmo nome
// colidirem entre si dentro do mesmo processamento em massa).
function generateUsername(fullName, existingUsernames) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const first = slugifyNamePart(parts[0]);
  const last = parts.length > 1 ? slugifyNamePart(parts[parts.length - 1]) : '';
  const base = (first + last) || 'usuario';
  let candidate = base;
  let n = 2;
  while (existingUsernames.has(candidate)) {
    candidate = `${base}${n}`;
    n++;
  }
  existingUsernames.add(candidate);
  return candidate;
}

// ---------- Recálculo em massa (ferramenta de uso único) ----------

// Aplica o valor/hora e o transporte ATUAIS de cada professor em TODAS as aulas já
// agendadas (status='scheduled'), usando a modalidade de cada aula para escolher entre
// valor/hora presencial e online. Pensada para ser usada uma única vez, depois de já
// existirem aulas cadastradas antes do valor/hora e do transporte existirem no sistema.
// Faturas já marcadas como pagas continuam protegidas — syncInvoiceForDate nunca mexe nelas.
function recalculateHistoricalValues(db) {
  const classes = db.prepare(
    `SELECT id, teacher_id, modality, start_time, end_time FROM classes WHERE status = 'scheduled'`
  ).all();

  let updated = 0;
  const skippedTeachers = new Set();
  const touched = [];

  const getTeacher = db.prepare('SELECT name, hourly_rate_presencial, hourly_rate_online, transport_value FROM teachers WHERE id = ?');
  const updateClass = db.prepare('UPDATE classes SET teacher_value = ?, transport_value = ? WHERE id = ?');

  for (const c of classes) {
    const teacher = getTeacher.get(c.teacher_id);
    if (!teacher) continue;

    const rate = c.modality === 'online' ? teacher.hourly_rate_online : teacher.hourly_rate_presencial;
    if (rate === null || rate === undefined) {
      skippedTeachers.add(`${teacher.name} (${c.modality})`);
      continue;
    }

    const start = new Date(c.start_time.replace(' ', 'T'));
    const end = new Date(c.end_time.replace(' ', 'T'));
    const hours = (end - start) / 3600000;
    const newTeacherValue = round2(rate * hours);
    const newTransportValue = c.modality === 'presencial' ? round2(teacher.transport_value || 0) : 0;

    updateClass.run(newTeacherValue, newTransportValue, c.id);
    updated++;
    touched.push({ teacherId: c.teacher_id, date: start });
  }

  for (const { teacherId, date } of touched) {
    syncInvoiceForDate(db, teacherId, date);
  }

  return { totalClasses: classes.length, updated, skipped: classes.length - updated, skippedTeachers: Array.from(skippedTeachers) };
}

// ---------- Relatório financeiro ----------

// Receita, custos e lucro de um único mês (ref = qualquer Date dentro do mês desejado).
//
// Tudo aqui é por REGIME DE CAIXA: cada valor é contado no mês em que o dinheiro de
// fato entrou ou saiu (paid_at), não no mês da aula/vencimento. Isso é proposital e
// importante — é o que garante que receita e custo usem a MESMA régua, então o lucro
// sempre "bate" com o que realmente aconteceu financeiramente, e evita o problema de
// uma despesa com vencimento futuro (ex.: dia 30) ficar invisível mesmo já paga antes
// disso (ex.: dia 1). O que ainda não foi marcado como pago/recebido não entra aqui —
// esse lado "a receber/a pagar" já é coberto pela aba Pagamentos.
function monthFinancials(db, ref) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = ref.getFullYear();
  const month = ref.getMonth(); // 0-indexed
  const monthPrefix = `${year}-${pad(month + 1)}-`;
  const like = `${monthPrefix}%`;

  const classRevenue = db.prepare(`
    SELECT COALESCE(SUM(student_value), 0) AS total FROM classes
    WHERE status = 'scheduled' AND student_paid = 1 AND student_paid_at LIKE ?
  `).get(like).total;

  const monthlyRevenue = db.prepare(
    `SELECT COALESCE(SUM(value), 0) AS total FROM monthly_charges WHERE status = 'paid' AND paid_at LIKE ?`
  ).get(like).total;

  const teacherCosts = db.prepare(
    `SELECT COALESCE(SUM(total_value), 0) AS total FROM teacher_invoices WHERE status = 'paid' AND paid_at LIKE ?`
  ).get(like).total;

  const expenseCosts = db.prepare(
    `SELECT COALESCE(SUM(value), 0) AS total FROM expenses WHERE status = 'paid' AND paid_at LIKE ?`
  ).get(like).total;

  const revenue = round2(classRevenue + monthlyRevenue);
  const totalCosts = round2(teacherCosts + expenseCosts);
  return {
    year, month: month + 1,
    revenue, teacherCosts: round2(teacherCosts), expenseCosts: round2(expenseCosts),
    totalCosts, profit: round2(revenue - totalCosts),
  };
}

// Série dos últimos N meses terminando em `endRef` (padrão: o mês atual).
// Mês que ainda não chegou não tem nada pago/recebido (o regime de caixa conta a data do pagamento),
// então para ele a série traz a PREVISÃO pela agenda (monthForecast), marcada com projected: true.
function monthlyFinancialSeries(db, monthsBack, endRef) {
  const now = new Date();
  const end = endRef || now;
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const out = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const ref = new Date(end.getFullYear(), end.getMonth() - i, 1);
    const idx = ref.getFullYear() * 12 + ref.getMonth();
    if (idx > nowIdx) {
      const f = monthForecast(db, ref, now);
      out.push({
        year: f.year, month: f.month, revenue: f.revenue, teacherCosts: f.teacherCosts, expenseCosts: f.expenseCosts,
        totalCosts: f.totalCosts, profit: f.profit, projected: true, isCurrent: false,
      });
    } else {
      out.push({ ...monthFinancials(db, ref), projected: false, isCurrent: idx === nowIdx });
    }
  }
  return out;
}

// PREVISÃO do mês: diferente de monthFinancials (que só conta o que já foi pago/recebido),
// aqui é uma projeção — conta TODAS as aulas agendadas no mês (as que já aconteceram e as
// que ainda vão acontecer), pelos valores registrados em cada aula, mais mensalidades e
// despesas do mês. Responde "quanto vou lucrar este mês se tudo que está agendado
// acontecer e for pago".
//   - Receita: valor que o aluno paga em cada aula agendada. Para alunos de pagamento por aula
//     isso é cobrado aula a aula; para alunos de pagamento mensal é a SOMA das aulas do mês
//     (a mensalidade) — nos dois casos o total é o mesmo cálculo: soma de student_value.
//   - Custos de professor: valor da aula + transporte de cada aula agendada
//   - Despesas: as que vencem no mês (pagas ou não) + as que já foram pagas no mês
// `now` é parâmetro só para poder testar; normalmente é "agora".
function monthForecast(db, ref, now) {
  now = now || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const like = `${year}-${pad(month + 1)}-%`;
  const nowStr = formatLocalDateTime(now);

  const cls = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN classes.start_time <= ? THEN 1 ELSE 0 END), 0) AS done,
      COALESCE(SUM(CASE WHEN students.monthly_payment = 0 THEN classes.student_value ELSE 0 END), 0) AS class_revenue,
      COALESCE(SUM(CASE WHEN students.monthly_payment = 1 THEN classes.student_value ELSE 0 END), 0) AS monthly_revenue,
      COALESCE(SUM(CASE WHEN students.monthly_payment = 1 AND classes.student_value = 0 THEN 1 ELSE 0 END), 0) AS monthly_zero_classes,
      COALESCE(SUM(classes.teacher_value + classes.transport_value), 0) AS teacher_costs
    FROM classes JOIN students ON students.id = classes.student_id
    WHERE classes.status = 'scheduled' AND classes.start_time LIKE ?
  `).get(nowStr, like);

  const existingExpenses = db.prepare(`
    SELECT COALESCE(SUM(value), 0) AS total FROM expenses
    WHERE COALESCE(due_date, substr(created_at, 1, 10)) LIKE ?
       OR (status = 'paid' AND paid_at LIKE ?)
  `).get(like, like).total;

  // Despesas recorrentes só ganham uma despesa "de verdade" no mês atual (ver ensureRecurringExpensesGenerated).
  // Para um mês que ainda não chegou, o gabarito ativo é o que se espera pagar: sem isso a previsão
  // deixaria de fora as contas fixas e o lucro previsto sairia maior do que será.
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const refIdx = year * 12 + month;
  const isFuture = refIdx > nowIdx;
  const recurringProjected = !isFuture ? 0 : db.prepare(`
    SELECT COALESCE(SUM(value), 0) AS total FROM recurring_expenses
    WHERE active = 1 AND NOT EXISTS (
      SELECT 1 FROM expenses e WHERE e.recurring_expense_id = recurring_expenses.id AND e.due_date LIKE ?
    )
  `).get(like).total;
  const expenseCosts = existingExpenses + recurringProjected;

  const revenue = round2(cls.class_revenue + cls.monthly_revenue);
  const teacherCosts = round2(cls.teacher_costs);
  const totalCosts = round2(teacherCosts + expenseCosts);
  const profit = round2(revenue - totalCosts);
  return {
    year, month: month + 1,
    isCurrent: refIdx === nowIdx, isPast: refIdx < nowIdx, isFuture,
    recurringExpenseProjected: round2(recurringProjected),
    classCount: cls.total, doneCount: cls.done, upcomingCount: cls.total - cls.done,
    revenue, classRevenue: round2(cls.class_revenue), monthlyRevenue: round2(cls.monthly_revenue),
    // aulas de alunos mensalistas sem valor definido — deixam a mensalidade (e a previsão) menor do que deveria
    monthlyZeroValueClasses: cls.monthly_zero_classes,
    teacherCosts, expenseCosts: round2(expenseCosts), totalCosts,
    profit, margin: revenue > 0 ? round2(profit / revenue * 100) : 0,
  };
}

// Para um mês específico: faturamento por disciplina e custo por professor — mesmo
// regime de caixa de monthFinancials, pelas mesmas datas de pagamento/recebimento.
function monthBreakdown(db, ref, now) {
  now = now || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const like = `${year}-${pad(month + 1)}-%`;

  // Mês que ainda não chegou: nada foi pago/recebido, então mostra o previsto pela agenda
  // (valor das aulas por disciplina; aula + transporte por professor).
  if (year * 12 + month > now.getFullYear() * 12 + now.getMonth()) {
    const projBySubject = db.prepare(`
      SELECT subjects.name AS label, COALESCE(SUM(classes.student_value), 0) AS value
      FROM classes JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.status = 'scheduled' AND classes.start_time LIKE ?
      GROUP BY subjects.id HAVING value > 0 ORDER BY value DESC LIMIT 8
    `).all(like).map(r => ({ label: r.label, value: round2(r.value) }));
    const projByTeacher = db.prepare(`
      SELECT teachers.name AS label, COALESCE(SUM(classes.teacher_value + classes.transport_value), 0) AS value
      FROM classes JOIN teachers ON teachers.id = classes.teacher_id
      WHERE classes.status = 'scheduled' AND classes.start_time LIKE ?
      GROUP BY teachers.id HAVING value > 0 ORDER BY value DESC LIMIT 8
    `).all(like).map(r => ({ label: r.label, value: round2(r.value) }));
    return { bySubject: projBySubject, byTeacher: projByTeacher, projected: true };
  }

  const bySubject = db.prepare(`
    SELECT subjects.name AS label, COALESCE(SUM(classes.student_value), 0) AS value
    FROM classes
    JOIN subjects ON subjects.id = classes.subject_id
    WHERE classes.status = 'scheduled' AND classes.student_paid = 1 AND classes.student_paid_at LIKE ?
    GROUP BY subjects.id HAVING value > 0 ORDER BY value DESC LIMIT 8
  `).all(like).map(r => ({ label: r.label, value: round2(r.value) }));

  const byTeacher = db.prepare(`
    SELECT teachers.name AS label, COALESCE(SUM(teacher_invoices.total_value), 0) AS value
    FROM teacher_invoices
    JOIN teachers ON teachers.id = teacher_invoices.teacher_id
    WHERE teacher_invoices.status = 'paid' AND teacher_invoices.paid_at LIKE ?
    GROUP BY teachers.id HAVING value > 0 ORDER BY value DESC LIMIT 8
  `).all(like).map(r => ({ label: r.label, value: round2(r.value) }));

  return { bySubject, byTeacher, projected: false };
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
  teacherHasStudent,
  listFeedback,
  addFeedback,
  deleteFeedback,
  findLoginEmailConflict,
  recalculateHistoricalValues,
  monthFinancials,
  monthlyFinancialSeries,
  monthBreakdown,
  monthForecast,
  monthTotalForStudent,
  pendingMonthlyBilling,
  formatLocalDateTime,
  periodStatus,
  clampDayOfMonth,
  ensureRecurringExpensesGenerated,
  syncRecurringExpenseCurrentMonth,
  generatePassword,
  generateUsername,
};
