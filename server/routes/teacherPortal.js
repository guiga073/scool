// server/routes/teacherPortal.js
// Rotas para o professor logado ver e editar SOMENTE os próprios dados.
// Nunca aceita um id vindo do cliente — o professor é sempre identificado pela sessão.

const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireTeacherAuth } = require('./auth');
const svc = require('../services');

function getTeacherSubjects(teacherId) {
  return db.prepare(`
    SELECT subjects.id, subjects.name FROM teacher_subjects
    JOIN subjects ON subjects.id = teacher_subjects.subject_id
    WHERE teacher_subjects.teacher_id = ?
    ORDER BY subjects.name
  `).all(teacherId);
}

function register(router) {
  router.get('/api/teacher-portal/me', async (req, res) => {
    const me = requireTeacherAuth(req);
    const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(me.id);
    if (!row) throw httpError(404, 'Professor não encontrado');
    let grid = {};
    try { grid = row.availability_grid ? JSON.parse(row.availability_grid) : {}; } catch (e) { grid = {}; }
    sendJson(res, 200, {
      id: row.id, name: row.name, address: row.address, phone: row.phone, pix: row.pix,
      login_email: row.login_email, subjects: getTeacherSubjects(row.id), availability_grid: grid,
    });
  });

  router.put('/api/teacher-portal/availability', async (req, res) => {
    const me = requireTeacherAuth(req);
    const grid = req.body && req.body.availability_grid;
    if (typeof grid !== 'object' || grid === null) throw httpError(400, 'Formato de disponibilidade inválido');
    db.prepare('UPDATE teachers SET availability_grid = ? WHERE id = ?').run(JSON.stringify(grid), me.id);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/teacher-portal/classes', async (req, res) => {
    const me = requireTeacherAuth(req);
    const { start, end } = req.query;
    let sql = `
      SELECT classes.*, students.name AS student_name, subjects.name AS subject_name
      FROM classes
      JOIN students ON students.id = classes.student_id
      JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.teacher_id = ? AND classes.status = 'scheduled'
    `;
    const params = [me.id];
    if (start) { sql += ' AND classes.start_time >= ?'; params.push(start); }
    if (end) { sql += ' AND classes.start_time <= ?'; params.push(end); }
    sql += ' ORDER BY classes.start_time';
    const rows = db.prepare(sql).all(...params);
    sendJson(res, 200, rows);
  });

  router.get('/api/teacher-portal/earnings', async (req, res) => {
    const me = requireTeacherAuth(req);
    svc.runPeriodicChecks(db);

    const now = new Date();
    const { first, second } = svc.getQuinzenaPeriods(now.getFullYear(), now.getMonth());
    const firstTotals = svc.calcPeriodTotals(db, me.id, first.start, first.end);
    const secondTotals = svc.calcPeriodTotals(db, me.id, second.start, second.end);

    const invoices = db.prepare(
      'SELECT * FROM teacher_invoices WHERE teacher_id = ? ORDER BY period_start DESC'
    ).all(me.id);

    sendJson(res, 200, {
      currentPeriods: { first: { ...first, ...firstTotals }, second: { ...second, ...secondTotals } },
      invoices,
    });
  });
}

module.exports = { register };
