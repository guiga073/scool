// server/routes/studentPortal.js
// Rotas para o aluno logado ver SOMENTE os próprios dados. Nunca aceita um id vindo
// do cliente — o aluno é sempre identificado pela sessão. Tudo aqui é somente leitura:
// o aluno não edita nada, só consulta suas aulas e o feedback que recebeu.

const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireStudentAuth } = require('./auth');

function register(router) {
  router.get('/api/student-portal/me', async (req, res) => {
    const me = requireStudentAuth(req);
    const row = db.prepare('SELECT id, name, login_email FROM students WHERE id = ?').get(me.id);
    if (!row) throw httpError(404, 'Aluno não encontrado');
    sendJson(res, 200, row);
  });

  router.get('/api/student-portal/classes', async (req, res) => {
    const me = requireStudentAuth(req);
    const { start, end } = req.query;
    let sql = `
      SELECT classes.*, teachers.name AS teacher_name, subjects.name AS subject_name
      FROM classes
      JOIN teachers ON teachers.id = classes.teacher_id
      JOIN subjects ON subjects.id = classes.subject_id
      WHERE classes.student_id = ? AND classes.status = 'scheduled'
    `;
    const params = [me.id];
    if (start) { sql += ' AND classes.start_time >= ?'; params.push(start); }
    if (end) { sql += ' AND classes.start_time <= ?'; params.push(end); }
    sql += ' ORDER BY classes.start_time';
    sendJson(res, 200, db.prepare(sql).all(...params));
  });

  router.get('/api/student-portal/feedback', async (req, res) => {
    const me = requireStudentAuth(req);
    const rows = db.prepare(`
      SELECT class_feedback.*, teachers.name AS teacher_name
      FROM class_feedback
      JOIN teachers ON teachers.id = class_feedback.teacher_id
      WHERE class_feedback.student_id = ?
      ORDER BY class_feedback.date DESC, class_feedback.id DESC
    `).all(me.id);
    sendJson(res, 200, rows);
  });
}

module.exports = { register };
