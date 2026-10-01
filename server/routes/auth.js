// server/routes/auth.js
const { db } = require('../db');
const {
  verifyPassword, createSession, getSessionUser, destroySession,
  parseCookies, setSessionCookie, clearSessionCookie, hashPassword,
} = require('../auth');
const { sendJson, httpError } = require('../router');
const svc = require('../services');

function requireAuth(req) {
  const cookies = parseCookies(req);
  const user = getSessionUser(db, cookies.session);
  if (!user || user.type !== 'admin') throw httpError(401, 'Não autenticado');
  return user;
}

function requireTeacherAuth(req) {
  const cookies = parseCookies(req);
  const user = getSessionUser(db, cookies.session);
  if (!user || user.type !== 'teacher') throw httpError(401, 'Não autenticado');
  return user;
}

function requireStudentAuth(req) {
  const cookies = parseCookies(req);
  const user = getSessionUser(db, cookies.session);
  if (!user || user.type !== 'student') throw httpError(401, 'Não autenticado');
  return user;
}

function register(router) {
  router.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw httpError(400, 'Informe e-mail e senha');
    const normalizedEmail = String(email).trim().toLowerCase();

    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(normalizedEmail);
    if (admin && verifyPassword(password, admin.password_hash)) {
      const { token } = createSession(db, 'admin', admin.id);
      setSessionCookie(res, token);
      sendJson(res, 200, { type: 'admin', id: admin.id, email: admin.email, name: admin.name });
      return;
    }

    const teacher = db.prepare('SELECT * FROM teachers WHERE login_email = ? AND active = 1').get(normalizedEmail);
    if (teacher && teacher.password_hash && verifyPassword(password, teacher.password_hash)) {
      const { token } = createSession(db, 'teacher', teacher.id);
      setSessionCookie(res, token);
      sendJson(res, 200, { type: 'teacher', id: teacher.id, email: teacher.login_email, name: teacher.name });
      return;
    }

    const student = db.prepare('SELECT * FROM students WHERE login_email = ? AND active = 1').get(normalizedEmail);
    if (student && student.password_hash && verifyPassword(password, student.password_hash)) {
      const { token } = createSession(db, 'student', student.id);
      setSessionCookie(res, token);
      sendJson(res, 200, { type: 'student', id: student.id, email: student.login_email, name: student.name });
      return;
    }

    throw httpError(401, 'E-mail ou senha incorretos');
  });

  router.post('/api/auth/logout', async (req, res) => {
    const cookies = parseCookies(req);
    destroySession(db, cookies.session);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/auth/me', async (req, res) => {
    const cookies = parseCookies(req);
    const user = getSessionUser(db, cookies.session);
    sendJson(res, 200, { user });
  });

  // Troca o e-mail de login e/ou a senha do administrador logado. Sempre exige a
  // senha atual para confirmar (mesmo só trocando o e-mail), por segurança.
  router.put('/api/auth/account', async (req, res) => {
    const me = requireAuth(req);
    const { currentPassword, newEmail, newPassword } = req.body || {};
    if (!currentPassword) throw httpError(400, 'Informe sua senha atual para confirmar');
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(me.id);
    if (!verifyPassword(currentPassword, row.password_hash)) throw httpError(401, 'Senha atual incorreta');

    let email = row.email;
    if (newEmail && newEmail.trim()) {
      const normalized = newEmail.trim().toLowerCase();
      if (!normalized.includes('@')) throw httpError(400, 'E-mail inválido');
      if (normalized !== row.email) {
        const conflict = svc.findLoginEmailConflict(db, normalized, { type: 'admin', id: me.id });
        if (conflict) throw httpError(400, 'Este e-mail já está em uso');
      }
      email = normalized;
    }

    let passwordHash = row.password_hash;
    if (newPassword) {
      if (String(newPassword).length < 6) throw httpError(400, 'Nova senha deve ter ao menos 6 caracteres');
      passwordHash = hashPassword(newPassword);
    }

    db.prepare('UPDATE admins SET email = ?, password_hash = ? WHERE id = ?').run(email, passwordHash, me.id);
    sendJson(res, 200, { id: me.id, email, name: row.name });
  });
}

module.exports = { register, requireAuth, requireTeacherAuth, requireStudentAuth };
