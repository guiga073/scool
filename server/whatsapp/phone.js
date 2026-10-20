// server/whatsapp/phone.js
// Telefones: o WhatsApp precisa do número completo, só dígitos, com o código do país (55 no Brasil).
// Os cadastros do portal guardam o telefone como foi digitado ("(21) 99999-1234"), então ele é
// normalizado aqui, na hora de enviar.

// DDDs que existem no Brasil.
const VALID_DDD = new Set(('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 ' +
  '61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99').split(' '));

// Devolve { ok: true, phone: '5521999991234' } ou { ok: false, error: '...' }.
function toWaPhone(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw);
  let digits = text.replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'telefone não preenchido' };
  const international = /^\s*\+/.test(text);
  digits = digits.replace(/^0+/, ''); // zero do "021 ..."

  if (international && !digits.startsWith('55')) {
    // Número de outro país, digitado com "+": só confere o tamanho (E.164 tem de 8 a 15 dígitos).
    if (digits.length >= 8 && digits.length <= 15) return { ok: true, phone: digits };
    return { ok: false, error: 'número internacional com tamanho inválido' };
  }

  let national;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) national = digits.slice(2);
  else if (digits.length === 10 || digits.length === 11) national = digits;
  else return { ok: false, error: 'número com quantidade de dígitos inválida (use DDD + telefone)' };

  const ddd = national.slice(0, 2);
  let subscriber = national.slice(2);
  if (!VALID_DDD.has(ddd)) return { ok: false, error: 'DDD inválido' };
  if (subscriber.length === 9) {
    if (subscriber[0] !== '9') return { ok: false, error: 'celular com 9 dígitos precisa começar com 9' };
  } else if (/^[6-9]/.test(subscriber)) {
    subscriber = '9' + subscriber; // celular antigo, escrito sem o 9
  } else {
    return { ok: false, error: 'telefone fixo não recebe WhatsApp' };
  }
  return { ok: true, phone: '55' + ddd + subscriber };
}

// Os números que chegam da Meta às vezes vêm sem o 9 (contas antigas). Para saber se dois números são
// do mesmo aparelho, compara os 8 últimos dígitos.
function samePhone(a, b) {
  const x = String(a || '').replace(/\D/g, '');
  const y = String(b || '').replace(/\D/g, '');
  if (x.length < 8 || y.length < 8) return false;
  return x.slice(-8) === y.slice(-8);
}

// '5521999991234' -> '(21) 99999-1234' (só para mostrar). Outros formatos voltam como vieram.
function formatPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const m = /^55(\d{2})(9\d{4})(\d{4})$/.exec(d);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(phone || '');
}

module.exports = { toWaPhone, samePhone, formatPhone };
