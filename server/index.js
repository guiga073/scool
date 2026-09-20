// server/index.js
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

// Carregador simples de .env (sem dependências externas), só para desenvolvimento local.
try {
  const fs = require('node:fs');
  const path = require('node:path');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
} catch (e) { /* sem .env, tudo bem — usa variáveis de ambiente do sistema */ }

const http = require('node:http');
const path = require('node:path');
const { db } = require('./db');
const { Router } = require('./router');
const svc = require('./services');

const router = new Router();
require('./routes/auth').register(router);
require('./routes/students').register(router);
require('./routes/teachers').register(router);
require('./routes/subjects').register(router);
require('./routes/classes').register(router);
require('./routes/payments').register(router);
require('./routes/teacherPortal').register(router);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  router.handle(req, res, PUBLIC_DIR);
});

// Roda as verificações periódicas (gerar faturas quinzenais / mensalidades) assim que o
// servidor sobe, e depois a cada 15 minutos. Isso garante que a fatura "apareça sozinha"
// pouco depois do horário-limite (00:00 do dia 16, por exemplo), mesmo sem um cron externo.
svc.runPeriodicChecks(db);
setInterval(() => {
  try { svc.runPeriodicChecks(db); } catch (e) { console.error('[cron] erro ao gerar faturas/mensalidades:', e); }
}, 15 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Sistema de reforço escolar rodando em http://localhost:${PORT}`);
  console.log(`Fuso horário do servidor: ${process.env.TZ}`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
