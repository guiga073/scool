// server/routes/teachers.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const svc = require('../services');

function getTeacherSubjects(teacherId) {
  return db.prepare(`
    SELECT subjects.id, subjects.name FROM teacher_subjects
    JOIN subjects ON subjects.id = teacher_subjects.subject_id
    WHERE teacher_subjects.teacher_id = ?
    ORDER BY subjects.name
  `).all(teacherId);
}

function setTeacherSubjects(teacherId, subjectIds) {
  db.prepare('DELETE FROM teacher_subjects WHERE teacher_id = ?').run(teacherId);
  const insert = db.prepare('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)');
  for (const sid of subjectIds || []) insert.run(teacherId, sid);
}

function teacherToJson(row) {
  return { ...row, active: !!row.active, subjects: getTeacherSubjects(row.id) };
}

function register(router) {
  router.get('/api/teachers', async (req, res) => {
    requireAuth(req);
    const { subjectId, search } = req.query;
    let rows = db.prepare('SELECT * FROM teachers WHERE active = 1 ORDER BY name').all();
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(String(search).toLowerCase()));
    let out = rows.map(teacherToJson);
    if (subjectId) out = out.filter(t => t.subjects.some(s => String(s.id) === String(subjectId)));
    sendJson(res, 200, out);
  });

  router.post('/api/teachers', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    if (!b.name || !b.name.trim()) throw httpError(400, 'Nome do professor é obrigatório');
    const info = db.prepare(`
      INSERT INTO teachers (name, address, phone, pix, availability) VALUES (?, ?, ?, ?, ?)
    `).run(b.name.trim(), b.address || null, b.phone || null, b.pix || null, b.availability || null);
    setTeacherSubjects(info.lastInsertRowid, b.subject_ids);
    const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(info.lastInsertRowid);
    sendJson(res, 201, teacherToJson(row));
  });

  router.get('/api/teachers/:id', async (req, res) => {
    requireAuth(req);
    const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!row) throw httpError(404, 'Professor não encontrado');

    const classes = db.prepare(`
      SELECT classes.*, students.name AS student_name, subjects.name AS subject_name
      FROM classes
      JOIN students ON students.id = classes.student_id
      JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.teacher_id = ? AND classes.status = 'scheduled'
      ORDER BY classes.start_time
    `).all(req.params.id);

    // Totais das quinzenas do mês atual (ao vivo, além das faturas já geradas/pagas)
    const now = new Date();
    const { first, second } = svc.getQuinzenaPeriods(now.getFullYear(), now.getMonth());
    const firstTotals = svc.calcPeriodTotals(db, req.params.id, first.start, first.end);
    const secondTotals = svc.calcPeriodTotals(db, req.params.id, second.start, second.end);

    const invoices = db.prepare('SELECT * FROM teacher_invoices WHERE teacher_id = ? ORDER BY period_start DESC').all(req.params.id);

    sendJson(res, 200, {
      ...teacherToJson(row),
      classes,
      invoices,
      currentPeriods: {
        first: { ...first, ...firstTotals },
        second: { ...second, ...secondTotals },
      },
    });
  });

  router.put('/api/teachers/:id', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    const existing = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Professor não encontrado');
    if (!b.name || !b.name.trim()) throw httpError(400, 'Nome do professor é obrigatório');
    db.prepare(`
      UPDATE teachers SET name=?, address=?, phone=?, pix=?, availability=? WHERE id=?
    `).run(b.name.trim(), b.address || null, b.phone || null, b.pix || null, b.availability || null, req.params.id);
    setTeacherSubjects(req.params.id, b.subject_ids);
    const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    sendJson(res, 200, teacherToJson(row));
  });

  router.delete('/api/teachers/:id', async (req, res) => {
    requireAuth(req);
    const existing = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Professor não encontrado');
    db.prepare('UPDATE teachers SET active = 0 WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register };
