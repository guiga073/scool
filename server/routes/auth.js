// server/routes/auth.js
const { db } = require('../db');
const {
  verifyPassword, createSession, getSessionUser, destroySession,
  parseCookies, setSessionCookie, clearSessionCookie, hashPassword,
} = require('../auth');
const { sendJson, httpError } = require('../router');

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

  router.post('/api/auth/change-password', async (req, res) => {
    const admin = requireAuth(req);
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) throw httpError(400, 'Nova senha deve ter ao menos 6 caracteres');
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
    if (!verifyPassword(currentPassword, row.password_hash)) throw httpError(401, 'Senha atual incorreta');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), admin.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register, requireAuth, requireTeacherAuth };
