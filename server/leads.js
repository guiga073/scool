// server/leads.js
// Controle de interessados: pais e responsáveis que entraram em contato, perguntaram sobre as aulas e
// ainda não agendaram nada. Ficam guardados para a administração retomar o contato mais tarde.
//
// Este arquivo cuida dos DADOS: conferência de cada campo, consultas e gravação. As regras de QUEM pode
// acessar (só a administração) ficam todas em routes/leads.js, num lugar só.
// A conferência de textos e disciplinas e a busca (sem diferença de acento ou maiúscula) são as mesmas
// do Banco de talentos (server/talents.js).

const { db } = require('./db');
const { httpError } = require('./router');
const { cleanLine, cleanNotes, cleanSubjectIds, fold, inTransaction, asId } = require('./talents');

const LIMITS = { name: 120, phone: 40, studentName: 120 };
const MAX_SEARCH = 100;

// ---------- Opções fixas ----------
// A tela lê estas listas em GET /api/leads/config, e assim os nomes que a pessoa vê ficam num lugar só.

// Por que o interessado não fechou (opcional; vazio = ainda não informado).
const LOST_REASONS = [
  { key: 'valor', label: 'Valor' },
  { key: 'interno', label: 'Interno da Olimais' },
  { key: 'outros', label: 'Outros' },
];

const SOURCES = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'site', label: 'Site' },
  { key: 'google', label: 'Google' },
  { key: 'indicacao', label: 'Indicação' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'outro', label: 'Outro' },
];

const labelOf = (options) => new Map(options.map((o) => [o.key, o.label]));
const REASON_LABEL = labelOf(LOST_REASONS);
const SOURCE_LABEL = labelOf(SOURCES);

const MSG = { naoEncontrado: 'Interessado não encontrado' };

function config() {
  return {
    lostReasons: LOST_REASONS,
    sources: SOURCES,
  };
}

function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

// Hoje, como "AAAA-MM-DD", no fuso do servidor (o sistema todo roda em America/Sao_Paulo; veja server/index.js).
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Conferência dos campos ----------

// Escolha entre opções fixas: vazio = não informado (null); qualquer outra coisa precisa ser um dos códigos.
function cleanChoice(value, options, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, `${label} inválida`);
  const v = value.trim();
  if (v === '') return null;
  if (!options.some((o) => o.key === v)) throw httpError(400, `${label} inválida`);
  return v;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Só o dia, "AAAA-MM-DD", e um dia que existe de verdade (30/02 não passa). Vazio = sem data (null).
function cleanDate(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, `${label} inválida`);
  const s = value.trim();
  if (s === '') return null;
  const m = DATE_RE.exec(s);
  if (!m) throw httpError(400, `${label} inválida`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) {
    throw httpError(400, `${label} inválida`);
  }
  return s;
}

// Confere os campos recebidos e devolve os valores prontos para gravar. Em "partial" (edição), só os
// campos que vieram no pedido são conferidos e devolvidos — o resto fica como está. Isso protege contra
// uma tela antiga aberta que não conhece algum campo e, sem querer, o apagaria.
function parseInput(body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Dados inválidos');
  const want = (key) => !partial || has(body, key);
  const out = {};
  if (want('name')) {
    const name = cleanLine(body.name, LIMITS.name, 'O nome');
    if (!name) throw httpError(400, 'Nome do responsável é obrigatório');
    out.name = name;
  }
  if (want('phone')) out.phone = cleanLine(body.phone, LIMITS.phone, 'O telefone', { number: true });
  if (want('student_name')) out.student_name = cleanLine(body.student_name, LIMITS.studentName, 'O nome do aluno');
  if (want('source')) out.source = cleanChoice(body.source, SOURCES, 'Origem');
  if (want('lost_reason')) out.lost_reason = cleanChoice(body.lost_reason, LOST_REASONS, 'Motivo de não fechamento');
  if (want('last_contact_date')) {
    // Cadastro novo sem a data: vale hoje. Data apagada de propósito (vazia) fica sem data.
    out.last_contact_date = !partial && body.last_contact_date === undefined ? todayIso() : cleanDate(body.last_contact_date, 'Data do último contato');
  }
  if (want('notes')) out.notes = cleanNotes(body.notes);
  if (want('subject_ids')) out.subject_ids = cleanSubjectIds(body.subject_ids);
  return out;
}

// ---------- Consultas ----------

function subjectsOf(leadId) {
  return db.prepare(`
    SELECT s.id, s.name FROM lead_subjects ls
    JOIN subjects s ON s.id = ls.subject_id
    WHERE ls.lead_id = ?
    ORDER BY s.name
  `).all(leadId);
}

function subjectsByLead() {
  const map = new Map();
  const rows = db.prepare(`
    SELECT ls.lead_id, s.id, s.name FROM lead_subjects ls
    JOIN subjects s ON s.id = ls.subject_id
    ORDER BY s.name
  `).all();
  for (const r of rows) {
    if (!map.has(r.lead_id)) map.set(r.lead_id, []);
    map.get(r.lead_id).push({ id: r.id, name: r.name });
  }
  return map;
}

// full: com observações (ficha); sem: só o necessário para a lista.
function toJson(row, subjects, full) {
  const out = {
    id: row.id,
    name: row.name,
    phone: row.phone,
    student_name: row.student_name,
    source: row.source,
    last_contact_date: row.last_contact_date,
    lost_reason: row.lost_reason,
    has_notes: !!row.notes,
    subjects,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (full) out.notes = row.notes || '';
  return out;
}

function get(id) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  return row ? toJson(row, subjectsOf(row.id), true) : null;
}

const onlyDigits = (s) => String(s === undefined || s === null ? '' : s).replace(/\D/g, '');
const PHONE_QUERY_RE = /^[\d\s()+.-]+$/;

// Lista, do último contato mais recente para o mais antigo (sem data de contato, no fim). Filtros:
//   search     nome, telefone, aluno, observações, disciplinas, motivo e origem
//              (sem diferença de acento/maiúscula; um telefone digitado só com números também acha)
//   reason     só aquele motivo de não fechamento (ou "nenhum": quem ainda não tem motivo)
//   subjectId  só quem tem aquela disciplina de interesse
function list(query) {
  const q = query || {};
  const rawSearch = typeof q.search === 'string' ? q.search.trim().slice(0, MAX_SEARCH) : '';
  const search = fold(rawSearch);
  const searchDigits = onlyDigits(rawSearch);
  const phoneSearch = searchDigits.length >= 4 && PHONE_QUERY_RE.test(rawSearch);
  let subjectId = null;
  if (q.subjectId !== undefined && q.subjectId !== '') {
    subjectId = asId(q.subjectId);
    if (subjectId === null) throw httpError(400, 'Disciplina inválida');
  }
  let reason = null;
  if (q.reason !== undefined && q.reason !== '') {
    if (typeof q.reason !== 'string' || (q.reason !== 'nenhum' && !REASON_LABEL.has(q.reason))) throw httpError(400, 'Motivo inválido');
    reason = q.reason;
  }
  const bySubject = subjectsByLead();
  let rows = db.prepare('SELECT * FROM leads ORDER BY (last_contact_date IS NULL), last_contact_date DESC, id DESC').all();
  if (reason !== null) rows = rows.filter((r) => (reason === 'nenhum' ? !r.lost_reason : r.lost_reason === reason));
  if (subjectId !== null) rows = rows.filter((r) => (bySubject.get(r.id) || []).some((s) => s.id === subjectId));
  if (search) {
    rows = rows.filter((r) => {
      const hay = fold([
        r.name, r.phone, r.student_name, r.notes,
        (bySubject.get(r.id) || []).map((s) => s.name).join(' '),
        REASON_LABEL.get(r.lost_reason), SOURCE_LABEL.get(r.source),
      ].join(' \n '));
      return hay.includes(search) || (phoneSearch && onlyDigits(r.phone).includes(searchDigits));
    });
  }
  return rows.map((r) => toJson(r, bySubject.get(r.id) || [], false));
}

// ---------- Gravação ----------

function setSubjects(leadId, subjectIds) {
  db.prepare('DELETE FROM lead_subjects WHERE lead_id = ?').run(leadId);
  const insert = db.prepare('INSERT OR IGNORE INTO lead_subjects (lead_id, subject_id) VALUES (?, ?)');
  for (const sid of subjectIds) insert.run(leadId, sid);
}

function create(body) {
  const v = parseInput(body, false);
  const id = inTransaction(() => {
    const info = db.prepare(`
      INSERT INTO leads (name, phone, student_name, source, last_contact_date, lost_reason, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(v.name, v.phone, v.student_name, v.source, v.last_contact_date, v.lost_reason, v.notes);
    const newId = Number(info.lastInsertRowid);
    setSubjects(newId, v.subject_ids);
    return newId;
  });
  return get(id);
}

const COLUMNS = ['name', 'phone', 'student_name', 'source', 'last_contact_date', 'lost_reason', 'notes'];

function update(id, body) {
  if (!db.prepare('SELECT 1 FROM leads WHERE id = ?').get(id)) throw httpError(404, MSG.naoEncontrado);
  const v = parseInput(body, true);
  const cols = COLUMNS.filter((c) => has(v, c)); // nomes de coluna vêm desta lista fixa, nunca do pedido
  inTransaction(() => {
    if (cols.length > 0 || has(v, 'subject_ids')) {
      const sets = [...cols.map((c) => `${c} = ?`), "updated_at = datetime('now', 'localtime')"];
      db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), id);
    }
    if (has(v, 'subject_ids')) setSubjects(id, v.subject_ids);
  });
  return get(id);
}

// Apaga o interessado de vez (não há histórico a preservar). As disciplinas dele vão junto.
function remove(id) {
  const info = db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  if (!info.changes) throw httpError(404, MSG.naoEncontrado);
}

module.exports = { config, list, get, create, update, remove, asId, LOST_REASONS };
