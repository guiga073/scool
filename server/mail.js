// server/mail.js
// Envio de e-mail pelo Resend (API HTTP, sem pacote externo). Opcional: sem as variáveis, nada é enviado.
//
//   RESEND_API_KEY   chave do Resend (Railway → Variables; nunca no GitHub nem no chat)
//   MAIL_FROM        remetente, de um domínio verificado no Resend. Ex.: OLIMAIS <contato@olimais.com.br>
//   MAIL_REPLY_TO    (opcional) para onde vão as respostas
//   RESEND_API_BASE  (só para os testes automáticos)

function env(name) { const v = process.env[name]; return typeof v === 'string' ? v.trim() : ''; }
function configured() { return !!(env('RESEND_API_KEY') && env('MAIL_FROM')); }
function from() { return env('MAIL_FROM'); }

// Envia; devolve { ok: true } ou { ok: false, error }. Nunca lança erro.
async function send(to, message) {
  if (!configured()) return { ok: false, error: 'E-mail não configurado (faltam RESEND_API_KEY e/ou MAIL_FROM).' };
  const body = { from: env('MAIL_FROM'), to: [to], subject: message.subject, html: message.html, text: message.text };
  if (env('MAIL_REPLY_TO')) body.reply_to = env('MAIL_REPLY_TO');
  try {
    const res = await fetch(`${(env('RESEND_API_BASE') || 'https://api.resend.com').replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true };
    let detail = '';
    try { const d = await res.json(); detail = d && (d.message || d.name) ? `: ${d.message || d.name}` : ''; } catch (e) { /* */ }
    return { ok: false, error: `O Resend recusou o envio (HTTP ${res.status})${detail}` };
  } catch (err) {
    return { ok: false, error: 'Não foi possível falar com o Resend agora.' };
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { configured, from, send, esc };
