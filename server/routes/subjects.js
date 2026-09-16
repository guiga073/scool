// server/routes/subjects.js
const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');

function register(router) {
  router.get('/api/subjects', async (req, res) => {
    requireAuth(req);
    const rows = db.prepare('SELECT * FROM subjects ORDER BY name').all();
    sendJson(res, 200, rows);
  });

  router.post('/api/subjects', async (req, res) => {
    requireAuth(req);
    const name = (req.body.name || '').trim();
    if (!name) throw httpError(400, 'Nome da disciplina é obrigatório');
    const existing = db.prepare('SELECT * FROM subjects WHERE name = ?').get(name);
    if (existing) { sendJson(res, 200, existing); return; }
    const info = db.prepare('INSERT INTO subjects (name) VALUES (?)').run(name);
    sendJson(res, 201, { id: info.lastInsertRowid, name });
  });

  router.delete('/api/subjects/:id', async (req, res) => {
    requireAuth(req);
    const inUse = db.prepare('SELECT COUNT(*) c FROM classes WHERE subject_id = ?').get(req.params.id).c;
    if (inUse > 0) throw httpError(400, 'Não é possível excluir: há aulas registradas com esta disciplina');
    db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register };
