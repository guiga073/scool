// server/whatsapp/client.js
// Conversa com a API da Meta (Graph API / WhatsApp Cloud API) usando o fetch nativo do Node 22.
// Sem bibliotecas. O token vem da variável de ambiente WHATSAPP_TOKEN e nunca é registrado em log.

const config = require('./config');

// Erros mais comuns da Meta, explicados em português (o código original continua no fim da frase).
const FRIENDLY = {
  190: 'O token de acesso é inválido ou venceu. Gere um token novo e atualize WHATSAPP_TOKEN na Railway.',
  10: 'O token não tem permissão para esta ação (whatsapp_business_messaging / whatsapp_business_management).',
  200: 'O token não tem permissão para esta conta do WhatsApp Business.',
  100: 'A Meta recusou um dado da requisição (confira o ID do número e o nome/idioma do modelo).',
  131030: 'Este telefone não está na lista de destinatários permitidos (a conta ainda está em modo de teste na Meta).',
  131026: 'A mensagem não pôde ser entregue: o número não tem WhatsApp ou não pode receber.',
  131047: 'Passaram mais de 24h desde a última mensagem da pessoa: só é possível enviar modelos aprovados.',
  131042: 'Problema de pagamento na conta do WhatsApp Business (confira a forma de pagamento no Gerenciador do WhatsApp).',
  131009: 'Algum valor enviado no modelo é inválido.',
  133010: 'O número de telefone do WhatsApp Business não está registrado.',
  132000: 'A quantidade de variáveis enviada não bate com a do modelo aprovado na Meta.',
  132001: 'Modelo não encontrado: confira o nome e o idioma na página WhatsApp, e se ele já foi aprovado na Meta.',
  132005: 'A tradução do modelo ficou grande demais ao montar a mensagem.',
  132007: 'O modelo foi reprovado pela política de conteúdo do WhatsApp.',
  132012: 'O formato das variáveis não bate com o modelo aprovado na Meta.',
  132015: 'O modelo está pausado na Meta por baixa qualidade.',
  132016: 'O modelo foi desativado na Meta.',
  130429: 'Limite de velocidade de envio da Meta atingido. O sistema tenta de novo daqui a pouco.',
  131048: 'Limite de envios para este contato atingido (proteção contra spam). O sistema tenta de novo depois.',
  131056: 'Muitas mensagens para o mesmo contato em pouco tempo. O sistema tenta de novo depois.',
  131049: 'A Meta decidiu não entregar esta mensagem (limite de qualidade/engajamento do destinatário).',
  131051: 'Tipo de mensagem não suportado.',
};
const TRANSIENT_CODES = new Set([130429, 131048, 131056, 80007, 4, 17, 32, 613]);

// Texto de um erro da Meta: explicação em português (se conhecida) + o texto/código originais.
function explain(code, detail, subcode) {
  const friendly = FRIENDLY[code] || FRIENDLY[subcode];
  return `${friendly ? friendly + ' ' : ''}(${detail || 'sem detalhe'}${code ? `; código ${code}` : ''})`.replace(/\s+/g, ' ');
}

function waError(status, data) {
  const e = (data && data.error) || {};
  const code = e.code;
  const detail = (e.error_data && e.error_data.details) || e.message || `erro HTTP ${status}`;
  const err = new Error(explain(code, detail, e.error_subcode));
  err.waError = true;
  err.status = status;
  err.code = code;
  // Erro "passageiro" (rede, limite de velocidade, falha da Meta): vale tentar de novo.
  err.transient = status === 429 || status >= 500 || TRANSIENT_CODES.has(code);
  return err;
}

async function graph(method, pathAndQuery, body, timeoutMs) {
  const e = config.env();
  if (!e.token) { const err = new Error('WHATSAPP_TOKEN não está configurado na Railway.'); err.config = true; throw err; }
  const url = `${e.apiBase}/${e.apiVersion}/${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${e.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const out = new Error(`Sem conexão com a Meta (${err.name === 'AbortError' ? 'tempo esgotado' : err.message}).`);
    out.transient = true;
    throw out;
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch (err) { /* resposta sem JSON */ }
  if (!res.ok) throw waError(res.status, data);
  return data;
}

// Envia uma mensagem (modelo ou texto). Devolve o código da mensagem na Meta ("wamid...").
async function sendMessage(payload) {
  const e = config.env();
  if (!e.phoneNumberId) { const err = new Error('WHATSAPP_PHONE_NUMBER_ID não está configurado (ou não é só números).'); err.config = true; throw err; }
  const data = await graph('POST', `${e.phoneNumberId}/messages`, payload);
  const id = data && data.messages && data.messages[0] && data.messages[0].id;
  if (!id) throw new Error('A Meta respondeu sem o código da mensagem.');
  return id;
}

function sendText(to, body) {
  return sendMessage({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } });
}

// Dados do número conectado (serve para "Testar conexão").
async function getPhoneInfo() {
  const e = config.env();
  if (!e.phoneNumberId) { const err = new Error('WHATSAPP_PHONE_NUMBER_ID não está configurado (ou não é só números).'); err.config = true; throw err; }
  return graph('GET', `${e.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
}

// Situação dos modelos na conta (precisa de WHATSAPP_WABA_ID). Devolve [{ name, language, status, category }].
async function listTemplates(name) {
  const e = config.env();
  if (!e.wabaId) return null;
  const q = `${e.wabaId}/message_templates?fields=name,language,status,category&limit=50${name ? '&name=' + encodeURIComponent(name) : ''}`;
  const data = await graph('GET', q);
  return (data && data.data) || [];
}

module.exports = { sendMessage, sendText, getPhoneInfo, listTemplates, explain };
