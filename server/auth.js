// server/auth.js
// Autenticação simples baseada em sessão, usando apenas node:crypto.

const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// userType: 'admin' ou 'teacher'
function createSession(db, userType, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_type, user_id, expires_at) VALUES (?, ?, ?, ?)').run(token, userType, userId, expiresAt);
  return { token, expiresAt };
}

// Devolve { type: 'admin'|'teacher', id, email, name } ou null.
function getSessionUser(db, token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (session.user_type === 'admin') {
    const row = db.prepare('SELECT id, email, name FROM admins WHERE id = ?').get(session.user_id);
    if (!row) return null;
    return { type: 'admin', id: row.id, email: row.email, name: row.name };
  }
  if (session.user_type === 'teacher') {
    const row = db.prepare('SELECT id, login_email AS email, name FROM teachers WHERE id = ? AND active = 1').get(session.user_id);
    if (!row) return null;
    return { type: 'teacher', id: row.id, email: row.email, name: row.name };
  }
  return null;
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
};
