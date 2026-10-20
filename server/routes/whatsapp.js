// server/routes/whatsapp.js
// Página "WhatsApp" da administração (status, ajustes, teste, histórico) e o webhook da Meta.
// Tudo aqui é só da administração, EXCETO o webhook, que é público de propósito (a Meta não tem login)
// e por isso só aceita chamadas com assinatura válida (ver server/whatsapp/webhook.js).

const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { requireAuth } = require('./auth');
const { CLASS_SELECT, classToJson } = require('./classes');
const conf = require('../confirmation');
const config = require('../whatsapp/config');
const client = require('../whatsapp/client');
const T = require('../whatsapp/templates');
const svc = require('../whatsapp/service');
const webhook = require('../whatsapp/webhook');
const { toWaPhone } = require('../whatsapp/phone');

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,100}$/;
const LANGUAGE_RE = /^[a-z]{2}(_[A-Z]{2})?$/;

function webhookUrl(req) {
  const host = String(req.headers.host || 'seu-dominio');
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  return `${local ? 'http' : 'https'}://${host}/api/webhooks/whatsapp`;
}

function sendProblemsCount() {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM classes
    WHERE status = 'scheduled' AND confirmation_status = 'pendente' AND confirm_error IS NOT NULL AND start_time > ?
  `).get(conf.fmtLocal(new Date())).c;
}

function statusPayload(req) {
  const e = config.env();
  return {
    env: {
      token: !!e.token,
      phoneNumberId: !!e.phoneNumberId,
      phoneNumberIdInvalid: !!e.phoneNumberIdRaw && !e.phoneNumberId,
      appSecret: !!e.appSecret,
      verifyToken: !!e.verifyToken,
      wabaId: !!e.wabaId,
      apiVersion: e.apiVersion,
    },
    credentialsReady: config.credentialsReady(),
    active: config.isEnabled(),
    settings: config.settings(),
    lastWebhookAt: config.getSetting('wa.last_webhook_at') || null,
    lastVerifyAt: config.getSetting('wa.last_verify_at') || null,
    webhookUrl: webhookUrl(req),
    sendProblems: sendProblemsCount(),
    rules: { sendBeforeHours: svc.SEND_BEFORE_HOURS, autoConfirmBeforeHours: svc.AUTO_CONFIRM_BEFORE_HOURS },
    templates: {
      confirm: { body: T.CONFIRM_BODY, buttons: T.CONFIRM_BUTTONS, examples: T.CONFIRM_EXAMPLES },
      alert: { body: T.ALERT_BODY, examples: T.ALERT_EXAMPLES },
    },
  };
}

function register(router) {
  // ---- Webhook da Meta (público; protegido por token de verificação e assinatura) ----
  router.get('/api/webhooks/whatsapp', async (req, res) => { webhook.handleVerify(req, res); });
  router.post('/api/webhooks/whatsapp', async (req, res) => { await webhook.handlePost(req, res); }, { raw: true });

  // ---- Administração ----
  router.get('/api/whatsapp/status', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, statusPayload(req));
  });

  router.put('/api/whatsapp/settings', async (req, res) => {
    requireAuth(req);
    const b = req.body || {};
    const updates = {};

    if (b.enabled !== undefined) {
      if (typeof b.enabled !== 'boolean') throw httpError(400, 'Valor inválido em "ligado"');
      if (b.enabled && !config.credentialsReady()) {
        throw httpError(400, 'Antes de ligar, configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID nas variáveis da Railway.');
      }
      updates['wa.enabled'] = b.enabled ? '1' : '0';
    }
    if (b.ack !== undefined) {
      if (typeof b.ack !== 'boolean') throw httpError(400, 'Valor inválido em "resposta automática"');
      updates['wa.ack'] = b.ack ? '1' : '0';
    }
    if (b.admin_phone !== undefined) {
      const text = String(b.admin_phone === null ? '' : b.admin_phone).trim();
      if (text.length > 40) throw httpError(400, 'Telefone muito longo');
      if (text) {
        const p = toWaPhone(text);
        if (!p.ok) throw httpError(400, `Telefone que recebe os alertas inválido: ${p.error}.`);
      }
      updates['wa.admin_phone'] = text;
    }
    for (const [field, key] of [['template_confirm', 'wa.template_confirm'], ['template_alert', 'wa.template_alert']]) {
      if (b[field] === undefined) continue;
      const name = String(b[field] === null ? '' : b[field]).trim();
      if (!TEMPLATE_NAME_RE.test(name)) throw httpError(400, 'Nome do modelo: só letras minúsculas, números e _ (sublinhado), sem espaços.');
      updates[key] = name;
    }
    if (b.language !== undefined) {
      const lang = String(b.language === null ? '' : b.language).trim();
      if (!LANGUAGE_RE.test(lang)) throw httpError(400, 'Idioma do modelo inválido. Exemplo: pt_BR');
      updates['wa.language'] = lang;
    }
    for (const [k, v] of Object.entries(updates)) config.setSetting(k, v);
    sendJson(res, 200, statusPayload(req));
  });

  // "Testar conexão": pergunta à Meta pelo número configurado (e, se houver WHATSAPP_WABA_ID, pela situação dos modelos).
  router.post('/api/whatsapp/test-connection', async (req, res) => {
    requireAuth(req);
    let info;
    try {
      info = await client.getPhoneInfo();
    } catch (err) {
      sendJson(res, 200, { ok: false, error: err.message });
      return;
    }
    const cfg = config.settings();
    let templates = null;
    let templatesError = null;
    if (config.env().wabaId) {
      try {
        templates = [];
        for (const name of [cfg.templateConfirm, cfg.templateAlert]) {
          const found = (await client.listTemplates(name)).filter((t) => t.name === name);
          templates.push({ name, found: found.map((t) => ({ language: t.language, status: t.status, category: t.category })) });
        }
      } catch (err) {
        templates = null;
        templatesError = err.message;
      }
    }
    sendJson(res, 200, {
      ok: true,
      phone: { displayPhoneNumber: info.display_phone_number || null, verifiedName: info.verified_name || null, qualityRating: info.quality_rating || null },
      templates, templatesError,
    });
  });

  // Envia uma mensagem de TESTE (nenhuma aula é alterada). "confirmacao" -> modelo com os botões, para o telefone informado;
  // "alerta" -> modelo de alerta, para o telefone informado (ou o configurado para receber alertas).
  router.post('/api/whatsapp/test-message', async (req, res) => {
    requireAuth(req);
    if (!config.credentialsReady()) throw httpError(400, 'Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID na Railway antes de testar.');
    const b = req.body || {};
    const cfg = config.settings();
    const kind = b.kind;
    if (kind !== 'confirmacao' && kind !== 'alerta') throw httpError(400, 'Tipo de teste inválido');
    const rawPhone = String(b.phone || '').trim() || (kind === 'alerta' ? cfg.adminPhone : '');
    if (!rawPhone) throw httpError(400, 'Informe o telefone que vai receber o teste.');
    const phone = toWaPhone(rawPhone);
    if (!phone.ok) throw httpError(400, `Telefone inválido: ${phone.error}.`);

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    tomorrow.setHours(15, 0, 0, 0);
    const sample = { id: 0, student_name: 'Aluno de Teste', subject_name: 'Matemática', teacher_name: 'Professor de Teste', start_time: conf.fmtLocal(tomorrow) };
    const message = kind === 'confirmacao'
      ? T.confirmationMessage(phone.phone, sample, cfg)
      : T.alertMessage(phone.phone, sample, { name: 'Responsável de Teste', label: 'responsável', phone: phone.phone }, cfg);
    try {
      const wamid = await client.sendMessage(message);
      svc.logMessage({ direction: 'out', kind: 'teste', phone: phone.phone, wamid, status: 'enviada', detail: kind === 'confirmacao' ? 'Teste do modelo de confirmação' : 'Teste do modelo de alerta' });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      svc.logMessage({ direction: 'out', kind: 'teste', phone: phone.phone, status: 'falhou', detail: err.message });
      throw httpError(502, err.message);
    }
  });

  router.get('/api/whatsapp/log', async (req, res) => {
    requireAuth(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const rows = db.prepare(`
      SELECT wa_messages.id, wa_messages.direction, wa_messages.kind, wa_messages.class_id, wa_messages.phone,
             wa_messages.status, wa_messages.detail, wa_messages.created_at, students.name AS student_name
      FROM wa_messages
      LEFT JOIN classes ON classes.id = wa_messages.class_id
      LEFT JOIN students ON students.id = classes.student_id
      ORDER BY wa_messages.id DESC LIMIT ?
    `).all(limit);
    sendJson(res, 200, rows);
  });

  // Libera de novo os avisos que deram erro (depois de consertar o telefone, o token, o modelo...).
  router.post('/api/whatsapp/retry-failed', async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, { released: svc.retryFailed(new Date()) });
  });

  // O que precisa da atenção da administração (usado no Painel): pedidos de cancelamento em aberto e avisos com problema.
  router.get('/api/whatsapp/attention', async (req, res) => {
    requireAuth(req);
    const cancelRequests = db.prepare(`${CLASS_SELECT} WHERE classes.status = 'scheduled' AND classes.confirmation_status = 'pedido_cancelamento' ORDER BY classes.start_time`).all();
    const sendProblems = db.prepare(`${CLASS_SELECT} WHERE classes.status = 'scheduled' AND classes.confirmation_status = 'pendente' AND classes.confirm_error IS NOT NULL AND classes.start_time > ? ORDER BY classes.start_time`)
      .all(conf.fmtLocal(new Date()));
    sendJson(res, 200, { cancelRequests: cancelRequests.map(classToJson), sendProblems: sendProblems.map(classToJson) });
  });
}

module.exports = { register };
