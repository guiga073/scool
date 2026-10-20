// server/whatsapp/templates.js
// Os dois modelos de mensagem ("templates") usados pelo sistema e a montagem do que é enviado à Meta.
//
// Mensagens que a EMPRESA começa (aviso 24h antes, alerta para a administração) só podem ser enviadas
// com um MODELO aprovado previamente pela Meta. O texto abaixo é exatamente o que deve ser cadastrado
// no Gerenciador do WhatsApp (a página "WhatsApp" do portal mostra os dois textos prontos para copiar).
// As partes que mudam em cada envio são as variáveis {{1}}, {{2}}...; trocar o texto aqui NÃO muda o que
// a Meta envia: o texto de verdade é o do modelo aprovado lá. Por isso, se mudar o texto, edite/crie o
// modelo na Meta também (e, se mudar a quantidade de variáveis, ajuste as funções mais abaixo).

const { fmtLocal } = require('../confirmation');

// ---- Modelo 1: pedido de confirmação ao responsável (ou ao aluno) — 24h antes da aula ----
const CONFIRM_BODY = `Olá! 💛

Passando para confirmar a aula de {{1}}, agendada para {{2}}, às {{3}}.

Por favor, confirme se está tudo certinho para a realização da aula! 😊

✅ SIM — Confirmar a aula.
🔄 NÃO — Solicitar cancelamento ou reagendamento.

Lembramos que cancelamentos e reagendamentos podem ser solicitados com até 5 horas de antecedência, sem cobrança.

Caso não recebamos uma resposta até esse prazo, a aula será considerada confirmada e o horário permanecerá reservado para o aluno, com a cobrança prevista em caso de ausência.

Agradecemos pela compreensão e parceria! 💛

Equipe OLIMAIS`;
const CONFIRM_BUTTONS = ['Sim', 'Não'];
const CONFIRM_EXAMPLES = ['Pedro Silva', 'segunda-feira, 26/10/2026', '15:00'];

// ---- Modelo 2: alerta para a administração quando o responsável pede cancelamento ----
const ALERT_BODY = `⚠️ Pedido de cancelamento ou reagendamento recebido pelo WhatsApp.

Aluno: {{1}}
Aula: {{2}}
Disciplina e professor: {{3}}
Quem respondeu: {{4}}

Entre em contato para verificar a situação. A aula continua valendo no sistema até você excluí-la ou confirmá-la no portal.`;
const ALERT_EXAMPLES = ['Pedro Silva', 'segunda-feira, 26/10/2026, às 15:00', 'Matemática com Marcos Teixeira', 'Maria Silva (responsável) — https://wa.me/5521999991234'];

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// A Meta recusa variável vazia, com quebra de linha/tab ou com mais de 4 espaços seguidos.
function cleanParam(value, max) {
  let text = String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) text = '-';
  const chars = [...text];
  if (chars.length > (max || 150)) text = chars.slice(0, (max || 150) - 1).join('') + '…';
  return text;
}

function pad(n) { return String(n).padStart(2, '0'); }

function dateText(startTime) {
  const d = new Date(String(startTime).replace(' ', 'T'));
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function timeText(startTime) {
  const d = new Date(String(startTime).replace(' ', 'T'));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Carimbo do horário dentro do botão: se a aula mudar de horário, os botões de um aviso ANTIGO deixam de valer.
function startStamp(startTime) {
  return String(startTime).replace(/\D/g, '').slice(0, 12);
}

// O que o botão devolve quando é tocado: OLI|<id da aula>|S ou N|<carimbo do horário>
function buttonPayload(classId, answer, startTime) {
  return `OLI|${classId}|${answer}|${startStamp(startTime)}`;
}

function parseButtonPayload(payload) {
  const m = /^OLI\|(\d+)\|([SN])\|(\d{0,12})$/.exec(String(payload || ''));
  if (!m) return null;
  return { classId: Number(m[1]), answer: m[2], stamp: m[3] };
}

function templateMessage(to, name, language, bodyParams, buttons) {
  const components = [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }];
  (buttons || []).forEach((payload, index) => {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] });
  });
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name, language: { code: language }, components },
  };
}

// cls: aula com student_name, start_time. classId 0 = mensagem de teste (nenhuma aula é alterada).
function confirmationMessage(to, cls, cfg) {
  const params = [cleanParam(cls.student_name, 100), cleanParam(dateText(cls.start_time), 60), cleanParam(timeText(cls.start_time), 10)];
  const id = cls.id || 0;
  const buttons = [buttonPayload(id, 'S', cls.start_time), buttonPayload(id, 'N', cls.start_time)];
  return templateMessage(to, cfg.templateConfirm, cfg.language, params, buttons);
}

// who: { name, label ('responsável' | 'aluno'), phone }
function alertMessage(to, cls, who, cfg) {
  const person = `${who.name || (who.label === 'aluno' ? 'Aluno' : 'Responsável')} (${who.label}) — https://wa.me/${who.phone}`;
  const params = [
    cleanParam(cls.student_name, 100),
    cleanParam(`${dateText(cls.start_time)}, às ${timeText(cls.start_time)}`, 80),
    cleanParam(`${cls.subject_name} com ${cls.teacher_name}`, 120),
    cleanParam(person, 200),
  ];
  return templateMessage(to, cfg.templateAlert, cfg.language, params, []);
}

// Respostas automáticas (texto livre; só podem ser enviadas logo depois de o responsável tocar no botão).
const ACK_CONFIRMED = 'Obrigado! Aula confirmada ✅ Até lá! 💛';
const ACK_CANCEL = 'Recebemos o seu pedido. 💛 Nossa equipe vai entrar em contato em breve para combinar o cancelamento ou o reagendamento da aula.';
const ACK_AMBIGUOUS = 'Você tem mais de uma aula para confirmar. 💛 Use os botões "Sim" e "Não" da mensagem de cada aula, por favor.';
const ACK_STALE = 'Esse aviso é de um horário que foi alterado. 💛 Vamos enviar uma nova confirmação antes da aula.';

module.exports = {
  CONFIRM_BODY, CONFIRM_BUTTONS, CONFIRM_EXAMPLES, ALERT_BODY, ALERT_EXAMPLES,
  ACK_CONFIRMED, ACK_CANCEL, ACK_STALE, ACK_AMBIGUOUS,
  cleanParam, dateText, timeText, startStamp, buttonPayload, parseButtonPayload,
  confirmationMessage, alertMessage, fmtLocal,
};
