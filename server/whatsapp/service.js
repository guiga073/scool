// server/whatsapp/service.js
// Regras da confirmação de aulas pelo WhatsApp:
//   - 24h antes da aula, pede a confirmação ao responsável (ou ao aluno, se o cadastro dele diz isso);
//   - "Sim"  -> aula confirmada;   "Não" -> pedido de cancelamento (+ alerta para a administração);
//   - sem resposta até 5h antes da aula -> aula confirmada automaticamente.
// Ver também webhook.js (recebe as respostas) e scheduler.js (roda isto de minuto em minuto).

const { db } = require('../db');
const config = require('./config');
const client = require('./client');
const T = require('./templates');
const { toWaPhone, samePhone } = require('./phone');
const conf = require('../confirmation');

const SEND_BEFORE_HOURS = 24; // o aviso sai quando falta 24h (ou menos) para a aula
const AUTO_CONFIRM_BEFORE_HOURS = 5; // sem resposta até 5h antes: confirma sozinha
const MAX_ATTEMPTS = 5; // tentativas de envio por aula (depois disso, só com o botão "Reenviar")
const RETRY_MINUTES = 10; // espera entre tentativas
const STALE_CLAIM_MINUTES = 10;

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Aula + dados do aluno/professor/disciplina necessários para montar a mensagem.
const CLASS_SQL = `
  SELECT classes.*, students.name AS student_name, students.guardian_name, students.guardian_phone,
         students.phone AS student_phone, students.confirmer, students.active AS student_active,
         teachers.name AS teacher_name, subjects.name AS subject_name
  FROM classes
  JOIN students ON students.id = classes.student_id
  JOIN teachers ON teachers.id = classes.teacher_id
  JOIN subjects ON subjects.id = classes.subject_id
`;

function getClass(id) {
  return db.prepare(CLASS_SQL + ' WHERE classes.id = ?').get(id);
}

// ---- Histórico (tabela wa_messages) ----

function clip(text, max) {
  const s = String(text === undefined || text === null ? '' : text);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Devolve o id da linha criada, ou null se o código da mensagem (wamid) já existia (mensagem repetida).
function logMessage(m) {
  try {
    const info = db.prepare(
      'INSERT INTO wa_messages (direction, kind, class_id, phone, wamid, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(m.direction, m.kind, m.class_id || null, m.phone || null, m.wamid || null, m.status || null, m.detail ? clip(m.detail, 500) : null);
    return Number(info.lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) return null;
    throw err;
  }
}

function updateLog(id, fields) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!['class_id', 'status', 'detail'].includes(k)) continue;
    sets.push(`${k} = ?`);
    params.push(k === 'detail' ? clip(v, 500) : v);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now', 'localtime')");
  db.prepare(`UPDATE wa_messages SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

// ---- Para quem vai o aviso ----

// "responsavel" (padrão) ou "aluno" (casos específicos, escolhidos no cadastro do aluno).
function confirmationTarget(cls) {
  if (cls.confirmer === 'aluno') return { label: 'aluno', name: cls.student_name, raw: cls.student_phone };
  return { label: 'responsável', name: cls.guardian_name, raw: cls.guardian_phone };
}

// ---- Envio do pedido de confirmação ----

// Envia o aviso desta aula agora. Seguro contra envio duplo: antes de falar com a Meta, "reserva" a aula
// (confirm_sent_at) com uma atualização que só vale para UMA chamada; se o envio falhar, devolve a reserva.
async function sendConfirmation(classId, now) {
  now = now || new Date();
  const stamp = conf.fmtLocal(now);
  const claim = db.prepare(`
    UPDATE classes SET confirm_sent_at = ?, confirm_last_try_at = ?
    WHERE id = ? AND status = 'scheduled' AND confirmation_status = 'pendente' AND confirm_sent_at IS NULL
  `).run(stamp, stamp, classId);
  if (claim.changes !== 1) return { ok: false, skipped: true, error: 'A aula não está esperando um aviso (já enviado, cancelada ou com status diferente de pendente).' };

  const cls = getClass(classId);
  const target = confirmationTarget(cls);
  const phone = toWaPhone(target.raw);
  const release = (message, countAttempt) => {
    db.prepare(`
      UPDATE classes SET confirm_sent_at = NULL, confirm_error = ?, confirm_attempts = confirm_attempts + ?
      WHERE id = ? AND confirm_sent_at = ?
    `).run(clip(message, 300), countAttempt ? 1 : 0, classId, stamp);
  };

  if (!phone.ok) {
    const message = `Sem telefone válido ${target.label === 'aluno' ? 'do aluno' : 'do responsável'} no cadastro: ${phone.error}.`;
    release(message, false);
    return { ok: false, error: message };
  }

  try {
    const wamid = await client.sendMessage(T.confirmationMessage(phone.phone, cls, config.settings()));
    db.prepare(`
      UPDATE classes SET confirm_wamid = ?, confirm_error = NULL, confirm_attempts = confirm_attempts + 1
      WHERE id = ? AND confirm_sent_at = ?
    `).run(wamid, classId, stamp);
    logMessage({ direction: 'out', kind: 'confirmacao', class_id: classId, phone: phone.phone, wamid, status: 'enviada', detail: `Para ${target.label}` });
    return { ok: true, wamid };
  } catch (err) {
    release(err.message, true);
    logMessage({ direction: 'out', kind: 'confirmacao', class_id: classId, phone: phone.phone, status: 'falhou', detail: err.message });
    return { ok: false, error: err.message, transient: !!err.transient };
  }
}

// Aulas que já passaram da hora de receber o aviso e ainda não receberam.
async function sendDue(now) {
  const cut24 = conf.fmtLocal(new Date(now.getTime() + SEND_BEFORE_HOURS * HOUR));
  const cut5 = conf.fmtLocal(new Date(now.getTime() + AUTO_CONFIRM_BEFORE_HOURS * HOUR));
  const retryBefore = conf.fmtLocal(new Date(now.getTime() - RETRY_MINUTES * MINUTE));
  const rows = db.prepare(`
    SELECT classes.id FROM classes JOIN students ON students.id = classes.student_id
    WHERE classes.status = 'scheduled' AND classes.confirmation_status = 'pendente'
      AND classes.confirm_sent_at IS NULL AND classes.confirm_attempts < ?
      AND classes.start_time <= ? AND classes.start_time > ?
      AND (classes.confirm_last_try_at IS NULL OR classes.confirm_last_try_at <= ?)
      AND students.active = 1
    ORDER BY classes.start_time LIMIT 25
  `).all(MAX_ATTEMPTS, cut24, cut5, retryBefore);
  let sent = 0;
  for (const row of rows) {
    const result = await sendConfirmation(row.id, now);
    if (result.ok) sent++;
    await sleep(150); // sem pressa: poucos envios por segundo
  }
  return { due: rows.length, sent };
}

// Sem resposta até 5h antes da aula -> confirmada automaticamente. Só vale para aula cujo aviso FOI enviado
// (e antes desse prazo) e não deu erro de entrega: se o aviso nunca chegou, a aula continua "pendente" e
// a administração enxerga o problema, em vez de a aula parecer confirmada sem ninguém ter respondido.
function autoConfirm(now) {
  const cut5 = conf.fmtLocal(new Date(now.getTime() + AUTO_CONFIRM_BEFORE_HOURS * HOUR));
  const rows = db.prepare(`
    SELECT id FROM classes
    WHERE status = 'scheduled' AND confirmation_status = 'pendente'
      AND confirm_wamid IS NOT NULL AND confirm_error IS NULL
      AND start_time <= ? AND confirm_sent_at <= datetime(start_time, '-${AUTO_CONFIRM_BEFORE_HOURS} hours')
  `).all(cut5);
  for (const row of rows) conf.setStatus(db, row.id, 'confirmada', 'automatico', now);
  return rows.length;
}

// Se o servidor caiu no meio de um envio, a "reserva" ficaria presa para sempre: aqui ela é devolvida.
function releaseStaleClaims(now) {
  const before = conf.fmtLocal(new Date(now.getTime() - STALE_CLAIM_MINUTES * MINUTE));
  return db.prepare(`
    UPDATE classes SET confirm_sent_at = NULL
    WHERE confirm_sent_at IS NOT NULL AND confirm_wamid IS NULL AND confirm_error IS NULL AND confirm_sent_at <= ?
  `).run(before).changes;
}

// Libera de novo os avisos que deram erro (para tentar outra vez depois de consertar o problema). Só as aulas
// que ainda têm mais de 5h pela frente: depois disso o sistema não envia mais o aviso sozinho, e apagar o
// erro esconderia o problema da administração.
function retryFailed(now) {
  now = now || new Date();
  const cut5 = conf.fmtLocal(new Date(now.getTime() + AUTO_CONFIRM_BEFORE_HOURS * HOUR));
  return db.prepare(`
    UPDATE classes SET confirm_error = NULL, confirm_attempts = 0, confirm_last_try_at = NULL, confirm_sent_at = NULL, confirm_wamid = NULL
    WHERE status = 'scheduled' AND confirmation_status = 'pendente' AND confirm_error IS NOT NULL AND start_time > ?
  `).run(cut5).changes;
}

// ---- Resposta do responsável ----

// 'S' (sim) ou 'N' (não) -> muda a confirmação da aula. Devolve { status, changed }.
function applyAnswer(cls, answer, now) {
  const next = answer === 'S' ? 'confirmada' : 'pedido_cancelamento';
  const changed = cls.confirmation_status !== next;
  if (changed) conf.setStatus(db, cls.id, next, 'whatsapp', now);
  return { status: next, changed };
}

// Aviso à administração (mensagem para o WhatsApp da Olimais) quando alguém pede cancelamento.
async function notifyAdmin(cls, replierPhone) {
  const cfg = config.settings();
  const target = confirmationTarget(cls);
  const base = { direction: 'out', kind: 'alerta_admin', class_id: cls.id };
  if (!String(cfg.adminPhone || '').trim()) {
    logMessage({ ...base, status: 'falhou', detail: 'O número que recebe os alertas não está configurado (página WhatsApp).' });
    return { ok: false };
  }
  const to = toWaPhone(cfg.adminPhone);
  if (!to.ok) {
    logMessage({ ...base, status: 'falhou', detail: `O número que recebe os alertas é inválido: ${to.error}.` });
    return { ok: false };
  }
  const replier = toWaPhone(replierPhone || target.raw);
  const who = { name: target.name, label: target.label, phone: replier.ok ? replier.phone : String(replierPhone || '').replace(/\D/g, '') };
  try {
    const wamid = await client.sendMessage(T.alertMessage(to.phone, cls, who, cfg));
    logMessage({ ...base, phone: to.phone, wamid, status: 'enviada', detail: 'Alerta de pedido de cancelamento' });
    return { ok: true, wamid };
  } catch (err) {
    logMessage({ ...base, phone: to.phone, status: 'falhou', detail: err.message });
    return { ok: false, error: err.message };
  }
}

// Resposta automática curta ("Obrigado, aula confirmada"). Texto livre: só funciona logo depois de a pessoa
// ter escrito/tocado num botão (janela de 24h), que é exatamente quando isto é chamado.
async function sendAck(to, text, classId) {
  const cfg = config.settings();
  if (!cfg.ack || !config.credentialsReady()) return { ok: false, skipped: true };
  try {
    const wamid = await client.sendText(to, text);
    logMessage({ direction: 'out', kind: 'resposta', class_id: classId || null, phone: to, wamid, status: 'enviada', detail: clip(text, 120) });
    return { ok: true };
  } catch (err) {
    logMessage({ direction: 'out', kind: 'resposta', class_id: classId || null, phone: to, status: 'falhou', detail: err.message });
    return { ok: false, error: err.message };
  }
}

// ---- Estado dos envios (confirmações de entrega que a Meta manda depois) ----

const RANK = { enviada: 1, entregue: 2, lida: 3 };
const STATUS_MAP = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

function applyStatusEvent(st) {
  if (!st || !st.id) return;
  const next = STATUS_MAP[st.status];
  if (!next) return;
  const row = db.prepare("SELECT * FROM wa_messages WHERE wamid = ? AND direction = 'out'").get(st.id);
  if (!row) return; // mensagem que não é deste sistema (ou já apagada do histórico)
  if (next === 'falhou') {
    if (row.status === 'entregue' || row.status === 'lida') return;
    const e = (st.errors && st.errors[0]) || {};
    const detail = client.explain(e.code, (e.error_data && e.error_data.details) || e.message || e.title, e.error_subcode);
    updateLog(row.id, { status: 'falhou', detail });
    if (row.kind === 'confirmacao' && row.class_id) {
      db.prepare('UPDATE classes SET confirm_error = ? WHERE id = ? AND confirm_wamid = ?').run(clip(`Não entregue: ${detail}`, 300), row.class_id, st.id);
    }
    return;
  }
  if ((RANK[row.status] || 0) >= RANK[next]) return; // nunca volta atrás (ex.: "lida" não vira "entregue")
  updateLog(row.id, { status: next });
}

module.exports = {
  SEND_BEFORE_HOURS, AUTO_CONFIRM_BEFORE_HOURS, MAX_ATTEMPTS, CLASS_SQL,
  getClass, logMessage, updateLog, confirmationTarget,
  sendConfirmation, sendDue, autoConfirm, releaseStaleClaims, retryFailed,
  applyAnswer, notifyAdmin, sendAck, applyStatusEvent, samePhone,
};
