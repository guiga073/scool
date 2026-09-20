// server/routes/teachers.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const { hashPassword } = require('../auth');
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

function parseGrid(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function teacherToJson(row) {
  const { password_hash, availability_grid, ...rest } = row;
  return { ...rest, active: !!row.active, has_login: !!row.login_email, availability_grid: parseGrid(availability_grid), subjects: getTeacherSubjects(row.id) };
}

// Garante que o e-mail de acesso não colida com um admin nem com outro professor.
function assertLoginEmailAvailable(email, excludeTeacherId) {
  if (!email) return;
  const asAdmin = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (asAdmin) throw httpError(400, 'Este e-mail já está em uso por uma conta de administração');
  const asTeacher = db.prepare('SELECT id FROM teachers WHERE login_email = ? AND id != ?').get(email, excludeTeacherId || 0);
  if (asTeacher) throw httpError(400, 'Este e-mail já está em uso por outro professor');
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
    const loginEmail = b.login_email ? String(b.login_email).trim().toLowerCase() : null;
    assertLoginEmailAvailable(loginEmail, null);
    if (loginEmail && !b.login_password) throw httpError(400, 'Defina uma senha de acesso para o professor');

    const info = db.prepare(`
      INSERT INTO teachers (name, address, phone, pix, availability, availability_grid, login_email, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.name.trim(), b.address || null, b.phone || null, b.pix || null, b.availability || null,
      b.availability_grid ? JSON.stringify(b.availability_grid) : null,
      loginEmail, b.login_password ? hashPassword(b.login_password) : null
    );
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

    const loginEmail = b.login_email ? String(b.login_email).trim().toLowerCase() : null;
    assertLoginEmailAvailable(loginEmail, existing.id);
    // Mantém a senha atual se nenhuma nova senha for enviada; só exige senha se está
    // ativando o acesso agora (não tinha e-mail de login antes) ou trocando o e-mail.
    let passwordHash = existing.password_hash;
    if (b.login_password) {
      passwordHash = hashPassword(b.login_password);
    } else if (loginEmail && loginEmail !== existing.login_email) {
      throw httpError(400, 'Defina uma senha de acesso para o professor');
    } else if (!loginEmail) {
      passwordHash = null;
    }

    db.prepare(`
      UPDATE teachers SET name=?, address=?, phone=?, pix=?, availability=?, availability_grid=?,
        login_email=?, password_hash=?
      WHERE id=?
    `).run(
      b.name.trim(), b.address || null, b.phone || null, b.pix || null, b.availability || null,
      b.availability_grid ? JSON.stringify(b.availability_grid) : existing.availability_grid,
      loginEmail, passwordHash, req.params.id
    );
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
