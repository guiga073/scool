// server/routes/students.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const { hashPassword } = require('../auth');
const svc = require('../services');

function studentToJson(row) {
  const { password_hash, ...rest } = row;
  return { ...rest, monthly_payment: !!row.monthly_payment, active: !!row.active, has_login: !!row.login_email };
}

// Garante que o e-mail de acesso não colida com um admin, um professor, ou outro aluno.
function assertLoginEmailAvailable(email, excludeStudentId) {
  const conflict = svc.findLoginEmailConflict(db, email, excludeStudentId ? { type: 'student', id: excludeStudentId } : null);
  if (conflict === 'admin') throw httpError(400, 'Este e-mail já está em uso por uma conta de administração');
  if (conflict === 'teacher') throw httpError(400, 'Este e-mail já está em uso por um professor');
  if (conflict === 'student') throw httpError(400, 'Este e-mail já está em uso por outro aluno');
}

function register(router) {
  router.get('/api/students', async (req, res) => {
    requireAuth(req);
    const { search } = req.query;
    let rows;
    if (search) {
      rows = db.prepare('SELECT * FROM students WHERE active = 1 AND name LIKE ? ORDER BY name').all(`%${search}%`);
    } else {
      rows = db.prepare('SELECT * FROM students WHERE active = 1 ORDER BY name').all();
    }
    sendJson(res, 200, rows.map(studentToJson));
  });

  router.post('/api/students', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    if (!b.name || !b.name.trim()) throw httpError(400, 'Nome do aluno é obrigatório');
    const loginEmail = b.login_email ? String(b.login_email).trim().toLowerCase() : null;
    assertLoginEmailAvailable(loginEmail, null);
    if (loginEmail && !b.login_password) throw httpError(400, 'Defina uma senha de acesso para o aluno');

    const info = db.prepare(`
      INSERT INTO students (name, address, guardian_name, guardian_phone, phone, email, monthly_payment, login_email, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.name.trim(), b.address || null, b.guardian_name || null, b.guardian_phone || null,
      b.phone || null, b.email || null, b.monthly_payment ? 1 : 0,
      loginEmail, b.login_password ? hashPassword(b.login_password) : null
    );
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid);
    sendJson(res, 201, studentToJson(row));
  });

  router.get('/api/students/:id', async (req, res) => {
    requireAuth(req);
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!row) throw httpError(404, 'Aluno não encontrado');

    const classes = db.prepare(`
      SELECT classes.*, teachers.name AS teacher_name, subjects.name AS subject_name
      FROM classes
      JOIN teachers ON teachers.id = classes.teacher_id
      JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.student_id = ? AND classes.status = 'scheduled'
      ORDER BY classes.start_time
    `).all(req.params.id);

    const grades = db.prepare('SELECT * FROM grades WHERE student_id = ? ORDER BY date DESC, id DESC').all(req.params.id);
    const observations = db.prepare('SELECT * FROM observations WHERE student_id = ? ORDER BY date DESC, id DESC').all(req.params.id);

    sendJson(res, 200, { ...studentToJson(row), classes, grades, observations });
  });

  router.put('/api/students/:id', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Aluno não encontrado');
    if (!b.name || !b.name.trim()) throw httpError(400, 'Nome do aluno é obrigatório');

    const loginEmail = b.login_email ? String(b.login_email).trim().toLowerCase() : null;
    assertLoginEmailAvailable(loginEmail, existing.id);
    let passwordHash = existing.password_hash;
    if (b.login_password) {
      passwordHash = hashPassword(b.login_password);
    } else if (loginEmail && loginEmail !== existing.login_email) {
      throw httpError(400, 'Defina uma senha de acesso para o aluno');
    } else if (!loginEmail) {
      passwordHash = null;
    }

    db.prepare(`
      UPDATE students SET name=?, address=?, guardian_name=?, guardian_phone=?, phone=?, email=?, monthly_payment=?,
        login_email=?, password_hash=?
      WHERE id=?
    `).run(
      b.name.trim(), b.address || null, b.guardian_name || null, b.guardian_phone || null,
      b.phone || null, b.email || null, b.monthly_payment ? 1 : 0,
      loginEmail, passwordHash,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    sendJson(res, 200, studentToJson(row));
  });

  router.delete('/api/students/:id', async (req, res) => {
    requireAuth(req);
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!existing) throw httpError(404, 'Aluno não encontrado');
    // Inativa em vez de apagar de vez, para preservar o histórico de aulas/pagamentos já registrados.
    db.prepare('UPDATE students SET active = 0 WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  // ---- Notas (grade history) ----
  router.post('/api/students/:id/grades', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    if (!b.subject || !b.value) throw httpError(400, 'Disciplina e nota são obrigatórias');
    const info = db.prepare('INSERT INTO grades (student_id, subject, value, date) VALUES (?, ?, ?, COALESCE(?, date(\'now\')))')
      .run(req.params.id, b.subject, String(b.value), b.date || null);
    const row = db.prepare('SELECT * FROM grades WHERE id = ?').get(info.lastInsertRowid);
    sendJson(res, 201, row);
  });

  router.delete('/api/students/:studentId/grades/:id', async (req, res) => {
    requireAuth(req);
    db.prepare('DELETE FROM grades WHERE id = ? AND student_id = ?').run(req.params.id, req.params.studentId);
    sendJson(res, 200, { ok: true });
  });

  // ---- Observações ----
  router.post('/api/students/:id/observations', async (req, res) => {
    requireAuth(req);
    const b = req.body;
    if (!b.text || !b.text.trim()) throw httpError(400, 'Texto da observação é obrigatório');
    const info = db.prepare('INSERT INTO observations (student_id, text, date) VALUES (?, ?, COALESCE(?, date(\'now\')))')
      .run(req.params.id, b.text.trim(), b.date || null);
    const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(info.lastInsertRowid);
    sendJson(res, 201, row);
  });

  router.delete('/api/students/:studentId/observations/:id', async (req, res) => {
    requireAuth(req);
    db.prepare('DELETE FROM observations WHERE id = ? AND student_id = ?').run(req.params.id, req.params.studentId);
    sendJson(res, 200, { ok: true });
  });

  // Todo o feedback já dado a este aluno, de qualquer professor (para a tela
  // "Feedbacks" do administrador, no modo "por aluno").
  router.get('/api/students/:id/feedback', async (req, res) => {
    requireAuth(req);
    const rows = db.prepare(`
      SELECT class_feedback.*, teachers.name AS teacher_name
      FROM class_feedback
      JOIN teachers ON teachers.id = class_feedback.teacher_id
      WHERE class_feedback.student_id = ?
      ORDER BY class_feedback.date DESC, class_feedback.id DESC
    `).all(req.params.id);
    sendJson(res, 200, rows);
  });
}

module.exports = { register };
