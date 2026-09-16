// server/routes/auth.js
const { db } = require('../db');
const { verifyPassword, createSession, getAdminBySession, destroySession, parseCookies, setSessionCookie, clearSessionCookie } = require('../auth');
const { sendJson, httpError } = require('../router');

function requireAuth(req) {
  const cookies = parseCookies(req);
  const admin = getAdminBySession(db, cookies.session);
  if (!admin) throw httpError(401, 'Não autenticado');
  return admin;
}

function register(router) {
  router.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw httpError(400, 'Informe e-mail e senha');
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(String(email).trim().toLowerCase());
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      throw httpError(401, 'E-mail ou senha incorretos');
    }
    const { token } = createSession(db, admin.id);
    setSessionCookie(res, token);
    sendJson(res, 200, { id: admin.id, email: admin.email, name: admin.name });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const cookies = parseCookies(req);
    destroySession(db, cookies.session);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });

  router.get('/api/auth/me', async (req, res) => {
    const cookies = parseCookies(req);
    const admin = getAdminBySession(db, cookies.session);
    if (!admin) { sendJson(res, 200, { admin: null }); return; }
    sendJson(res, 200, { admin });
  });

  router.post('/api/auth/change-password', async (req, res) => {
    const admin = requireAuth(req);
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) throw httpError(400, 'Nova senha deve ter ao menos 6 caracteres');
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
    if (!verifyPassword(currentPassword, row.password_hash)) throw httpError(401, 'Senha atual incorreta');
    const { hashPassword } = require('../auth');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), admin.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register, requireAuth };
