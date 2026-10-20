// server/confirmation.js
// Regras da "confirmação da aula" (campo à parte do status 'scheduled'/'cancelled' da aula).
// Usado pelas rotas de aulas (edição manual pela administração) e pelo módulo do WhatsApp.
//
// IMPORTANTE: "pedido de cancelamento" NÃO tira a aula das contas nem das estatísticas. Quem decide
// é a administração: depois de falar com o responsável, ela exclui a aula (Cancelar aula) ou volta o
// status para "confirmada"/"pendente".

const STATUSES = [
  { key: 'pendente', label: 'Pendente confirmação' },
  { key: 'confirmada', label: 'Aula confirmada' },
  { key: 'pedido_cancelamento', label: 'Pedido de cancelamento' },
];
const STATUS_KEYS = STATUSES.map((s) => s.key);
const SOURCES = ['whatsapp', 'automatico', 'admin'];

// Colunas que só a administração enxerga (professores e alunos nunca recebem isto).
const CONFIRMATION_COLUMNS = [
  'confirmation_status', 'confirmation_source', 'confirmation_updated_at',
  'confirm_sent_at', 'confirm_wamid', 'confirm_error', 'confirm_attempts', 'confirm_last_try_at',
];

function isValidStatus(value) {
  return typeof value === 'string' && STATUS_KEYS.includes(value);
}

function pad(n) { return String(n).padStart(2, '0'); }

// Data/hora local no formato do banco: 'AAAA-MM-DD HH:MM:SS' (o servidor roda sempre em America/Sao_Paulo).
function fmtLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseLocal(s) {
  return new Date(String(s).replace(' ', 'T'));
}

// Muda a confirmação de uma aula. "source" diz quem mudou (admin, whatsapp, automatico).
function setStatus(db, classId, status, source, now) {
  if (!isValidStatus(status)) throw new Error('Status de confirmação inválido');
  return db.prepare(
    'UPDATE classes SET confirmation_status = ?, confirmation_source = ?, confirmation_updated_at = ? WHERE id = ?'
  ).run(status, source, fmtLocal(now || new Date()), classId);
}

// Volta a aula para "pendente" e esquece o aviso anterior (usado quando o horário ou o aluno da aula
// mudam: o aviso antigo não vale mais, e um novo é enviado 24h antes do novo horário).
function resetConfirmation(db, classId, now) {
  return db.prepare(`
    UPDATE classes SET confirmation_status = 'pendente', confirmation_source = NULL, confirmation_updated_at = ?,
      confirm_sent_at = NULL, confirm_wamid = NULL, confirm_error = NULL, confirm_attempts = 0, confirm_last_try_at = NULL
    WHERE id = ?
  `).run(fmtLocal(now || new Date()), classId);
}

// Esquece só o aviso (para reenviar), sem mexer no status.
function resetSend(db, classId) {
  return db.prepare(`
    UPDATE classes SET confirm_sent_at = NULL, confirm_wamid = NULL, confirm_error = NULL, confirm_attempts = 0, confirm_last_try_at = NULL
    WHERE id = ?
  `).run(classId);
}

// Tira de uma aula as colunas de confirmação (para as telas do professor e do aluno).
function stripForPortal(row) {
  const copy = { ...row };
  for (const c of CONFIRMATION_COLUMNS) delete copy[c];
  return copy;
}

module.exports = {
  STATUSES, STATUS_KEYS, SOURCES, CONFIRMATION_COLUMNS,
  isValidStatus, fmtLocal, parseLocal, setStatus, resetConfirmation, resetSend, stripForPortal,
};
