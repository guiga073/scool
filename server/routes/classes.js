// server/routes/classes.js
const crypto = require('node:crypto');
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

const CLASS_SELECT = `
  SELECT classes.*, students.name AS student_name, teachers.name AS teacher_name, subjects.name AS subject_name
  FROM classes
  JOIN students ON students.id = classes.student_id
  JOIN teachers ON teachers.id = classes.teacher_id
  JOIN subjects ON subjects.id = classes.subject_id
`;

function classToJson(row) {
  return { ...row, student_paid: !!row.student_paid };
}

function validateClassBody(b) {
  const required = ['student_id', 'teacher_id', 'subject_id', 'start_time', 'end_time'];
  for (const f of required) {
    if (b[f] === undefined || b[f] === null || b[f] === '') throw httpError(400, `Campo obrigatório faltando: ${f}`);
  }
  if (b.start_time >= b.end_time) throw httpError(400, 'O horário de término deve ser depois do horário de início');
  if (!['online', 'presencial'].includes(b.modality)) throw httpError(400, "Modalidade deve ser 'online' ou 'presencial'");
}

function register(router) {
  // Lista/busca de aulas — usada tanto pela agenda/calendário quanto pela busca
  router.get('/api/classes', async (req, res) => {
    requireAuth(req);
    const { start, end, studentId, teacherId, search, status } = req.query;
    let sql = CLASS_SELECT + " WHERE classes.status = ?";
    const params = [status || 'scheduled'];
    if (start) { sql += ' AND classes.start_time >= ?'; params.push(start); }
    if (end) { sql += ' AND classes.start_time <= ?'; params.push(end); }
    if (studentId) { sql += ' AND classes.student_id = ?'; params.push(studentId); }
    if (teacherId) { sql += ' AND classes.teacher_id = ?'; params.push(teacherId); }
    if (search) {
      sql += ' AND (students.name LIKE ? OR teachers.name LIKE ? OR subjects.name LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY classes.start_time';
    const rows = db.prepare(sql).all(...params);
    sendJson(res, 200, rows.map(classToJson));
  });

  router.post('/api/classes', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    validateClassBody(b);

    const conflicts = svc.findConflicts(db, {
      teacherId: b.teacher_id, studentId: b.student_id, startTime: b.start_time, endTime: b.end_time,
    });

    const info = db.prepare(`
      INSERT INTO classes (student_id, teacher_id, subject_id, modality, start_time, end_time, student_value, teacher_value, meeting_link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.student_id, b.teacher_id, b.subject_id, b.modality, b.start_time, b.end_time,
      Number(b.student_value) || 0, Number(b.teacher_value) || 0, b.meeting_link || null
    );

    svc.syncInvoiceForDate(db, b.teacher_id, new Date(b.start_time.replace(' ', 'T')));

    const row = db.prepare(CLASS_SELECT + ' WHERE classes.id = ?').get(info.lastInsertRowid);
    sendJson(res, 201, { class: classToJson(row), conflicts });
  });

  // Criação de aulas recorrentes (acompanhamento semanal)
  router.post('/api/classes/recurring', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    const required = ['student_id', 'teacher_id', 'subject_id', 'modality', 'day_of_week', 'start_time', 'end_time', 'start_date', 'end_date'];
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || b[f] === '') throw httpError(400, `Campo obrigatório faltando: ${f}`);
    }
    if (b.start_date > b.end_date) throw httpError(400, 'Data final deve ser depois da data inicial');

    const occurrences = svc.buildRecurringOccurrences({
      dayOfWeek: Number(b.day_of_week), startTime: b.start_time, endTime: b.end_time,
      startDate: b.start_date, endDate: b.end_date,
    });

    if (occurrences.length === 0) throw httpError(400, 'Nenhuma aula cairia no período informado');
    if (occurrences.length > 104) throw httpError(400, 'Período muito longo (máximo ~2 anos de recorrência semanal)');

    const groupId = crypto.randomUUID();
    const created = [];
    const conflictsByDate = [];

    const insert = db.prepare(`
      INSERT INTO classes (student_id, teacher_id, subject_id, modality, start_time, end_time, student_value, teacher_value, meeting_link, recurrence_group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const occ of occurrences) {
      const conflicts = svc.findConflicts(db, {
        teacherId: b.teacher_id, studentId: b.student_id, startTime: occ.startTime, endTime: occ.endTime,
      });
      const info = insert.run(
        b.student_id, b.teacher_id, b.subject_id, b.modality, occ.startTime, occ.endTime,
        Number(b.student_value) || 0, Number(b.teacher_value) || 0, b.meeting_link || null, groupId
      );
      created.push(info.lastInsertRowid);
      if (conflicts.length > 0) conflictsByDate.push({ date: occ.startTime, conflicts });
      svc.syncInvoiceForDate(db, b.teacher_id, new Date(occ.startTime.replace(' ', 'T')));
    }

    sendJson(res, 201, { createdCount: created.length, conflicts: conflictsByDate, recurrenceGroupId: groupId });
  });

  router.put('/api/classes/:id', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    const existing = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Aula não encontrada');
    if (existing.status === 'cancelled') throw httpError(400, 'Não é possível editar uma aula cancelada');
    validateClassBody(b);

    const conflicts = svc.findConflicts(db, {
      teacherId: b.teacher_id, studentId: b.student_id, startTime: b.start_time, endTime: b.end_time,
      excludeClassId: req.params.id,
    });

    db.prepare(`
      UPDATE classes SET student_id=?, teacher_id=?, subject_id=?, modality=?, start_time=?, end_time=?,
        student_value=?, teacher_value=?, meeting_link=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      b.student_id, b.teacher_id, b.subject_id, b.modality, b.start_time, b.end_time,
      Number(b.student_value) || 0, Number(b.teacher_value) || 0, b.meeting_link || null, req.params.id
    );

    // Recalcula faturas afetadas: período antigo (se o professor ou a data mudaram) e o período novo
    svc.syncInvoiceForDate(db, existing.teacher_id, new Date(existing.start_time.replace(' ', 'T')));
    svc.syncInvoiceForDate(db, b.teacher_id, new Date(b.start_time.replace(' ', 'T')));

    const row = db.prepare(CLASS_SELECT + ' WHERE classes.id = ?').get(req.params.id);
    sendJson(res, 200, { class: classToJson(row), conflicts });
  });

  // Cancelar aula: some de todos os lugares do sistema (calendários, pagamentos, cálculos),
  // mas fica guardada no banco com status 'cancelled' para fins de auditoria/histórico.
  router.delete('/api/classes/:id', async (req, res) => {
    requireAuth(req);
    const existing = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Aula não encontrada');
    db.prepare("UPDATE classes SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(req.params.id);
    svc.syncInvoiceForDate(db, existing.teacher_id, new Date(existing.start_time.replace(' ', 'T')));
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register };
