// server/routes/backup.js
// Permite que o administrador baixe, a qualquer momento, uma cópia completa e
// consistente do banco de dados — útil como camada extra de segurança independente
// da hospedagem (Railway, etc.), já que os backups nativos da Railway só existem
// no plano Pro.

const { backupBuffer } = require('../db');
const { requireAuth } = require('./auth');

function register(router) {
  router.get('/api/admin/backup', async (req, res) => {
    requireAuth(req);
    const data = backupBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="olimais-backup-${stamp}.db"`,
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

module.exports = { register };
