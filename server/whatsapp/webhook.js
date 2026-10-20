// server/whatsapp/webhook.js
// Recebe os avisos da Meta (webhook):
//   GET  /api/webhooks/whatsapp  -> a Meta confere o endereço e o "token de verificação" (uma vez, ao cadastrar o webhook);
//   POST /api/webhooks/whatsapp  -> respostas dos botões, mensagens recebidas e estados de entrega.
// Toda chamada POST é conferida pela assinatura (X-Hub-Signature-256, calculada com o "segredo do app"):
// sem assinatura válida nada é processado, então ninguém consegue "confirmar" ou "cancelar" aulas de fora.

const crypto = require('node:crypto');
const { db } = require('../db');
const { httpError, sendJson } = require('../router');
const config = require('./config');
const T = require('./templates');
const conf = require('../confirmation');
const svc = require('./service');
const { toWaPhone, samePhone } = require('./phone');

const MAX_BODY = 2 * 1024 * 1024;

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(httpError(413, 'Corpo da requisição muito grande')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest();
}

// Comparação em tempo constante (não vaza, pelo tempo de resposta, quantas letras do token estavam certas).
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function validSignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(Buffer.from(m[1], 'hex'), expected);
}

// ---- Entender o que a pessoa respondeu ----

function normalizeText(text) {
  return String(text === undefined || text === null ? '' : text)
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const YES = new Set(['sim', 's', 'ss', 'confirmo', 'confirmado', 'confirmada', 'confirma', 'ok', 'okay', 'certo', 'claro']);
const NO = new Set(['nao', 'n', 'nn', 'cancelar', 'cancela', 'cancelo', 'cancelamento', 'reagendar', 'remarcar']);
// Frase solta que fala em não poder / cancelar / remarcar: trata como pedido de cancelamento. Errar para este lado
// é barato (a administração só confere); o contrário (ignorar um "não vai dar") deixaria a aula confirmar sozinha.
const NO_INTENT = /(nao|cancel|remarc|reagend|desmarc|imposs|adiar)/;

function answerFromText(text) {
  const t = normalizeText(text);
  if (!t) return null;
  if (YES.has(t)) return 'S';
  if (NO.has(t)) return 'N';
  if (NO_INTENT.test(t)) return 'N';
  return null;
}

function summarize(m) {
  const clip = (s) => (String(s).length > 160 ? String(s).slice(0, 159) + '…' : String(s));
  if (m.type === 'button' && m.button) return `Botão "${clip(m.button.text || '')}"`;
  if (m.type === 'interactive' && m.interactive && m.interactive.button_reply) return `Botão "${clip(m.interactive.button_reply.title || '')}"`;
  if (m.type === 'text' && m.text) return `Texto: "${clip(m.text.body || '')}"`;
  return `Mensagem do tipo "${m.type || 'desconhecido'}" (o sistema só entende botões e texto)`;
}

// Aulas futuras cujo aviso foi enviado para este número.
function candidatesFor(phone, now) {
  const rows = db.prepare(`${svc.CLASS_SQL} WHERE classes.status = 'scheduled' AND classes.confirm_wamid IS NOT NULL AND classes.start_time > ?`)
    .all(conf.fmtLocal(now));
  return rows.filter((row) => {
    const target = svc.confirmationTarget(row);
    const p = toWaPhone(target.raw);
    return p.ok && samePhone(p.phone, phone);
  });
}

// Trata UMA mensagem recebida. Devolve as tarefas de rede (alerta, resposta) para rodarem DEPOIS de a Meta ser atendida.
function handleInbound(m, now) {
  const tasks = [];
  const from = String(m.from || '');
  const rowId = svc.logMessage({ direction: 'in', kind: 'recebida', phone: from, wamid: m.id, status: 'recebida', detail: summarize(m) });
  if (rowId === null) return tasks; // a Meta repete envios: esta mensagem já foi tratada
  try {
    const finish = (fields) => svc.updateLog(rowId, fields);
    const reply = (text, classId) => { tasks.push(() => svc.sendAck(from, text, classId)); };

    let payload = null;
    let buttonText = null;
    if (m.type === 'button' && m.button) { payload = m.button.payload; buttonText = m.button.text; }
    else if (m.type === 'interactive' && m.interactive && m.interactive.button_reply) { payload = m.interactive.button_reply.id; buttonText = m.interactive.button_reply.title; }
    const textBody = m.type === 'text' && m.text ? m.text.body : null;
    const ctxId = m.context && m.context.id ? String(m.context.id) : null;

    let cls = null;
    let answer = null;
    const parsed = T.parseButtonPayload(payload);

    if (parsed) {
      // Caminho principal: o botão carrega o número da aula e o horário em que o aviso foi gerado.
      if (parsed.classId === 0) {
        finish({ status: 'teste', detail: `Resposta de teste: ${parsed.answer === 'S' ? 'Sim' : 'Não'}` });
        reply('Teste recebido ✅ Os botões estão funcionando. 💛', null);
        return tasks;
      }
      cls = svc.getClass(parsed.classId);
      answer = parsed.answer;
      if (!cls) { finish({ status: 'ignorada', detail: 'A aula não existe mais.' }); return tasks; }
      if (T.startStamp(cls.start_time) !== parsed.stamp) {
        finish({ class_id: cls.id, status: 'ignorada', detail: 'Aviso antigo: o horário da aula mudou depois dele.' });
        reply(T.ACK_STALE, cls.id);
        return tasks;
      }
    } else {
      // Outros caminhos: o botão sem o nosso código, ou alguém que digitou a resposta.
      const supported = m.type === 'button' || m.type === 'interactive' || m.type === 'text';
      answer = supported ? answerFromText(buttonText !== null ? buttonText : (textBody !== null ? textBody : payload)) : null;
      if (!answer) { finish({ status: 'sem_acao', detail: summarize(m) + ' — nenhuma aula foi alterada. Veja e responda por outro canal, se for o caso.' }); return tasks; }
      if (ctxId) cls = db.prepare(`${svc.CLASS_SQL} WHERE classes.confirm_wamid = ?`).get(ctxId) || null;
      if (!cls) {
        const found = candidatesFor(from, now);
        if (found.length === 0) { finish({ status: 'ignorada', detail: 'Nenhuma aula está esperando confirmação deste número.' }); return tasks; }
        if (found.length > 1) {
          finish({ status: 'ignorada', detail: 'Mais de uma aula esperando confirmação deste número: a resposta digitada não diz qual.' });
          reply(T.ACK_AMBIGUOUS, null);
          return tasks;
        }
        cls = found[0];
      }
    }

    if (cls.status !== 'scheduled') { finish({ class_id: cls.id, status: 'ignorada', detail: 'A aula já foi cancelada no sistema.' }); return tasks; }
    if (conf.parseLocal(cls.start_time) <= now) { finish({ class_id: cls.id, status: 'ignorada', detail: 'A aula já começou ou já aconteceu.' }); return tasks; }

    const result = svc.applyAnswer(cls, answer, now);
    finish({
      class_id: cls.id, status: 'aplicada',
      detail: answer === 'S' ? 'Aula confirmada pelo WhatsApp' : 'Pedido de cancelamento pelo WhatsApp',
    });
    if (answer === 'N' && result.changed) tasks.push(() => svc.notifyAdmin(cls, from));
    reply(answer === 'S' ? T.ACK_CONFIRMED : T.ACK_CANCEL, cls.id);
    return tasks;
  } catch (err) {
    // Se algo der errado, esquece o registro para que a Meta (que repete o envio) possa tentar de novo.
    db.prepare('DELETE FROM wa_messages WHERE id = ?').run(rowId);
    throw err;
  }
}

function processEvents(body, now) {
  const tasks = [];
  const e = config.env();
  for (const entry of (body && body.entry) || []) {
    for (const change of (entry && entry.changes) || []) {
      if (!change || change.field !== 'messages') continue;
      const value = change.value || {};
      const phoneId = value.metadata && value.metadata.phone_number_id;
      if (e.phoneNumberId && phoneId && String(phoneId) !== e.phoneNumberId) continue; // evento de outro número
      for (const st of value.statuses || []) svc.applyStatusEvent(st);
      for (const m of value.messages || []) tasks.push(...handleInbound(m, now));
    }
  }
  return tasks;
}

// ---- Rotas ----

function handleVerify(req, res) {
  const q = req.query || {};
  const e = config.env();
  const challenge = String(q['hub.challenge'] || '');
  if (q['hub.mode'] === 'subscribe' && e.verifyToken && typeof q['hub.verify_token'] === 'string'
      && safeEqual(q['hub.verify_token'], e.verifyToken) && /^[\w.-]{1,200}$/.test(challenge)) {
    config.setSetting('wa.last_verify_at', conf.fmtLocal(new Date()));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(challenge);
    return;
  }
  throw httpError(403, 'Token de verificação inválido');
}

async function handlePost(req, res) {
  const raw = await readRaw(req);
  const e = config.env();
  if (!e.appSecret) throw httpError(503, 'WHATSAPP_APP_SECRET não está configurado no servidor.');
  if (!validSignature(raw, req.headers['x-hub-signature-256'], e.appSecret)) throw httpError(401, 'Assinatura inválida');
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch (err) { throw httpError(400, 'JSON inválido'); }
  config.setSetting('wa.last_webhook_at', conf.fmtLocal(new Date()));
  const tasks = processEvents(body, new Date());
  sendJson(res, 200, { ok: true });
  for (const task of tasks) {
    try { await task(); } catch (err) { console.error('[whatsapp] erro ao enviar resposta/alerta:', err.message); }
  }
}

module.exports = { handleVerify, handlePost, processEvents, validSignature, answerFromText, normalizeText };
