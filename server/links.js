// server/links.js
// Link da aula online: o sistema só guarda endereços que começam com "https://".
//
// Por que isso importa: um link salvo como "meet.google.com/abc-defg-hij" (sem https://)
// é entendido pelo navegador como um endereço DENTRO do próprio portal; então o botão
// o link da aula leva a uma página que não existe, em vez de abrir o Meet.
//
// Regras (a mesma lógica existe no navegador, em public/js/api.js, para avisar na hora):
//   vazio                          -> tudo bem: aula sem link
//   "https://meet.google.com/abc"  -> tudo bem, fica como está
//   "meet.google.com/abc"          -> completa: "https://meet.google.com/abc"
//   "http://meet.google.com/abc"   -> troca para "https://meet.google.com/abc"
//   "javascript:...", "ftp://..."  -> recusa (não é um endereço de aula online)
//   com espaços ou sem domínio     -> recusa, explicando o motivo
//
// Retorna { ok: true, value, changed } ou { ok: false, error }.
//   value   = o link já pronto para salvar (ou null, se não há link)
//   changed = true quando o texto digitado foi ajustado (ex.: ganhou o https://)

const MAX_LENGTH = 1000;

const MSG = {
  espacos: 'O link da aula não pode ter espaços. Copie e cole o endereço completo.',
  esquema: 'O link da aula precisa ser um endereço da internet, como https://meet.google.com/...',
  invalido: 'O link da aula não parece um endereço válido. Confira se copiou o link inteiro.',
  longo: 'O link da aula é grande demais.',
};

function normalizeMeetingLink(input) {
  if (input === undefined || input === null) return { ok: true, value: null, changed: false };
  const raw = String(input).trim();
  if (raw === '') return { ok: true, value: null, changed: false };
  if (raw.length > MAX_LENGTH) return { ok: false, error: MSG.longo };
  if (/\s/.test(raw)) return { ok: false, error: MSG.espacos };

  let candidate;
  const web = raw.match(/^https?:\/*(.*)$/i); // https://x   http://x   https:/x   https:x
  if (web) {
    candidate = 'https://' + web[1];
  } else if (raw.startsWith('//')) {
    candidate = 'https:' + raw; // //meet.google.com/x
  } else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) {
    // outro tipo de endereço (javascript:, ftp:, mailto:, data:, file:...). O "(?!\d)" deixa
    // passar "meet.google.com:443/x", em que depois dos dois pontos vem a porta.
    return { ok: false, error: MSG.esquema };
  } else {
    candidate = 'https://' + raw; // meet.google.com/x
  }

  let url;
  try {
    url = new URL(candidate);
  } catch (e) {
    return { ok: false, error: MSG.invalido };
  }
  const dominioOk = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname);
  if (url.protocol !== 'https:' || !dominioOk || url.username || url.password) {
    return { ok: false, error: MSG.invalido };
  }
  return { ok: true, value: candidate, changed: candidate !== raw };
}

module.exports = { normalizeMeetingLink };
