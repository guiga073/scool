// server/whatsapp/scheduler.js
// "Relógio" da confirmação de aulas: de minuto em minuto (dentro do próprio servidor, sem cron externo)
//   1. confirma sozinhas as aulas sem resposta até 5h antes;
//   2. envia o aviso das aulas que entraram na janela de 24h;
//   3. uma vez por dia, apaga do histórico do WhatsApp o que tem mais de 90 dias.
// Tudo isso só roda com a integração LIGADA na página WhatsApp (e com token + número configurados).

const { db } = require('../db');
const config = require('./config');
const svc = require('./service');

const KEEP_LOG_DAYS = 90;
let running = false;
let timer = null;
let lastPruneDay = '';

function pruneLog(now) {
  const day = now.toDateString();
  if (day === lastPruneDay) return;
  lastPruneDay = day;
  const r = db.prepare(`DELETE FROM wa_messages WHERE created_at < datetime('now', 'localtime', '-${KEEP_LOG_DAYS} days')`).run();
  if (r.changes > 0) console.log(`[whatsapp] histórico antigo apagado: ${r.changes} linha(s)`);
}

async function tick(now) {
  now = now || new Date();
  pruneLog(now);
  if (!config.isEnabled()) return { skipped: true };
  const released = svc.releaseStaleClaims(now);
  const confirmed = svc.autoConfirm(now);
  if (confirmed > 0) console.log(`[whatsapp] ${confirmed} aula(s) confirmada(s) automaticamente (sem resposta até 5h antes)`);
  const sent = await svc.sendDue(now);
  if (sent.sent > 0) console.log(`[whatsapp] ${sent.sent} aviso(s) de confirmação enviado(s)`);
  return { released, confirmed, ...sent };
}

async function safeTick() {
  if (running) return; // o minuto anterior ainda não terminou
  running = true;
  try { await tick(new Date()); } catch (err) { console.error('[whatsapp] erro no agendador:', err); } finally { running = false; }
}

function start() {
  if (timer) return;
  const seconds = Number(process.env.WA_TICK_SECONDS) > 0 ? Number(process.env.WA_TICK_SECONDS) : 60; // WA_TICK_SECONDS: só para testes
  timer = setInterval(safeTick, seconds * 1000);
  setTimeout(safeTick, Math.min(5000, seconds * 1000)); // primeira rodada logo depois de subir
}

module.exports = { start, tick };
