// server/talents.js
// Banco de talentos: potenciais professores que a administração quer guardar para o futuro.
//
// Este arquivo cuida dos DADOS: conferência de cada campo, consultas e o currículo (conferência do
// tipo de arquivo, recebimento, gravação e download). As regras de QUEM pode acessar (só a
// administração) ficam todas em routes/talents.js, num lugar só.
//
// O currículo (um por talento) é guardado DENTRO do banco de dados (tabela talent_cvs), e não numa
// pasta. Assim ele entra no "Baixar backup dos dados", é apagado junto com o talento e nunca sobra
// solto no disco. Em troca, os tamanhos são limitados (variáveis de ambiente opcionais;
// 1 MB = 1.000.000 bytes, como nos Materiais):
//   TALENTS_CV_MAX_MB     tamanho máximo de um currículo         (padrão 5)
//   TALENTS_CV_TOTAL_MB   teto de todos os currículos somados    (padrão 200)

const { db } = require('./db');
const { httpError } = require('./router');
const mat = require('./materials');

const { cleanFileName, extensionOf, fmtBytes, readMb, MAGIC, startsWith, contentDisposition, declaredLength, abortedError } = mat;

// ---------- Configuração ----------

const MAX_CV_BYTES = Math.floor((readMb('TALENTS_CV_MAX_MB', 5) || 5) * mat.MB);
const MAX_CV_TOTAL_BYTES = Math.floor((readMb('TALENTS_CV_TOTAL_MB', 200) || 200) * mat.MB);

const LIMITS = { name: 120, phone: 40, email: 120, address: 200, notes: 5000 };
const MAX_RATE = 100000;
const MAX_SEARCH = 100;
const MAX_SUBJECTS = 100;

// ---------- Tipos de currículo aceitos ----------
// Os formatos que candidatos costumam mandar. Nada que o navegador execute (nada de .html, .svg...).
// Cada tipo tem o "tipo MIME" devolvido no download (nunca o que o cliente disser) e uma conferência
// dos primeiros bytes do arquivo, para pegar um programa renomeado para .pdf.
// "inline": pode abrir direto no navegador (PDF e imagens); o resto sempre baixa.

const OLE_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // Word antigo (.doc)
const RTF_HEADER = [0x7b, 0x5c, 0x72, 0x74, 0x66]; // "{\rtf"

const CV_TYPES = {
  pdf: { mime: 'application/pdf', check: MAGIC.pdf, inline: true },
  doc: { mime: 'application/msword', check: (b) => startsWith(b, OLE_HEADER) },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: MAGIC.zip },
  odt: { mime: 'application/vnd.oasis.opendocument.text', check: MAGIC.zip },
  rtf: { mime: 'application/rtf', check: (b) => startsWith(b, RTF_HEADER) },
  jpg: { mime: 'image/jpeg', check: MAGIC.jpeg, inline: true, image: true },
  jpeg: { mime: 'image/jpeg', check: MAGIC.jpeg, inline: true, image: true },
  png: { mime: 'image/png', check: MAGIC.png, inline: true, image: true },
  webp: { mime: 'image/webp', check: MAGIC.webp, inline: true, image: true },
};

const MSG = {
  naoEncontrado: 'Talento não encontrado',
  tipo: 'Este tipo de arquivo não é aceito para o currículo. Envie PDF, Word (.doc ou .docx), .odt, .rtf ou uma imagem (JPG, PNG ou WEBP).',
  vazio: 'O arquivo está vazio.',
  conteudo: 'O conteúdo deste arquivo não confere com o tipo dele. Ele pode estar corrompido ou ter sido renomeado. Abra e salve de novo no formato certo.',
  semCurriculo: 'Este talento não tem currículo anexado.',
  indisponivel: 'Este currículo não está disponível. Envie o arquivo de novo.',
};

function config() {
  return { maxCvBytes: MAX_CV_BYTES, allowedExtensions: Object.keys(CV_TYPES) };
}

// ---------- Textos ----------
// Escritos com números (e não com sequências \u) de propósito: assim a lista do que é removido
// fica legível e nenhum caractere invisível fica escondido no código.

// Caracteres de controle.
function isControl(cp) { return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f); }

// Caracteres invisíveis e de direção do texto, que servem para disfarçar o que está escrito.
function isInvisible(cp) {
  return (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;
}

// Limpa um texto digitado. Em texto de uma linha só, tudo vira espaço simples. Em texto de várias
// linhas (observações), as quebras de linha ficam (no máximo uma linha em branco seguida).
// Os "ligadores" invisíveis (ZWNJ/ZWJ) ficam nas observações para não quebrar emojis compostos.
function cleanText(raw, multiline) {
  let s = String(raw);
  try { s = s.normalize('NFC'); } catch (e) { /* mantém como veio */ }
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (isInvisible(cp)) {
      if (multiline && (cp === 0x200c || cp === 0x200d)) out += ch;
      continue;
    }
    if (cp === 0x2028 || cp === 0x2029) { out += multiline ? '\n' : ' '; continue; }
    if (isControl(cp)) {
      out += multiline && (cp === 0x0a || cp === 0x0d) ? ch : ' ';
      continue;
    }
    out += ch;
  }
  if (multiline) out = out.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  else out = out.replace(/\s+/g, ' ');
  return out.trim();
}

function length(text) { return Array.from(text).length; }

// Campo de uma linha, opcional: vazio vira null; grande demais é recusado (nunca cortado em silêncio).
// "number": aceita também um número (um telefone mandado sem aspas).
function cleanLine(value, max, label, { number = false } = {}) {
  if (value === undefined || value === null) return null;
  if (number && typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') throw httpError(400, `${label} não está num formato válido`);
  const text = cleanText(value, false);
  if (!text) return null;
  if (length(text) > max) throw httpError(400, `${label} pode ter até ${max} caracteres`);
  return text;
}

function cleanNotes(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, 'Observações inválidas');
  const text = cleanText(value, true);
  if (!text) return null;
  if (length(text) > LIMITS.notes) throw httpError(400, `As observações podem ter até ${LIMITS.notes} caracteres`);
  return text;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valor por hora é opcional; se vier preenchido, precisa ser um número válido, de zero para cima.
// O mesmo vale para o valor de transporte (label muda só a mensagem de erro).
function cleanRate(value, label) {
  const msg = (label || 'Valor por hora') + ' inválido';
  if (value === undefined || value === null) return null;
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return null;
    if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s)) throw httpError(400, msg); // "50", "50,5", "50.5", ".5"
    n = Number(s.replace(',', '.'));
  } else throw httpError(400, msg);
  if (!Number.isFinite(n) || n < 0 || n > MAX_RATE) throw httpError(400, msg);
  return Math.round(n * 100) / 100;
}

// Disponibilidade: { "0".."6": [horas] }, o mesmo formato dos professores. Só guarda os dias que
// têm alguma hora marcada; sem nenhuma hora marcada, guarda "nada informado" (null).
function cleanGrid(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Disponibilidade inválida');
  const out = {};
  let any = false;
  for (const key of Object.keys(value)) {
    if (!/^[0-6]$/.test(key)) throw httpError(400, 'Disponibilidade inválida');
    const hours = value[key];
    if (!Array.isArray(hours) || hours.length > 24) throw httpError(400, 'Disponibilidade inválida');
    const set = new Set();
    for (const h of hours) {
      if (!Number.isInteger(h) || h < 0 || h > 23) throw httpError(400, 'Disponibilidade inválida');
      set.add(h);
    }
    if (set.size > 0) { out[key] = Array.from(set).sort((a, b) => a - b); any = true; }
  }
  return any ? out : null;
}

function parseGrid(raw) {
  if (!raw) return {};
  try {
    const g = JSON.parse(raw);
    return g && typeof g === 'object' && !Array.isArray(g) ? g : {};
  } catch (e) {
    return {};
  }
}

// Código numérico válido (inteiro positivo) vindo do endereço ou do corpo; senão null.
function asId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

// Disciplinas: lista de códigos, todos existentes. Vazia/nula = nenhuma disciplina.
function cleanSubjectIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SUBJECTS) throw httpError(400, 'Disciplinas inválidas');
  const ids = [];
  for (const v of value) {
    const n = asId(v);
    if (n === null) throw httpError(400, 'Disciplinas inválidas');
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length > 0) {
    const found = db.prepare(`SELECT COUNT(*) AS c FROM subjects WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids).c;
    if (found !== ids.length) throw httpError(400, 'Disciplina não encontrada. Atualize a página e tente de novo.');
  }
  return ids;
}

function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

// Confere os campos recebidos e devolve os valores prontos para gravar. Em "partial" (edição), só os
// campos que vieram no pedido são conferidos e devolvidos — o resto fica como está. Isso protege contra
// uma tela antiga aberta que não conhece algum campo e, sem querer, o apagaria.
function parseInput(body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Dados inválidos');
  const want = (key) => !partial || has(body, key);
  const out = {};
  if (want('name')) {
    const name = cleanLine(body.name, LIMITS.name, 'O nome');
    if (!name) throw httpError(400, 'Nome do talento é obrigatório');
    out.name = name;
  }
  if (want('phone')) out.phone = cleanLine(body.phone, LIMITS.phone, 'O telefone', { number: true });
  if (want('email')) {
    const email = cleanLine(body.email, LIMITS.email, 'O e-mail');
    if (email && !EMAIL_RE.test(email)) throw httpError(400, 'E-mail inválido');
    out.email = email;
  }
  if (want('address')) out.address = cleanLine(body.address, LIMITS.address, 'O endereço');
  if (want('hourly_rate_presencial')) out.hourly_rate_presencial = cleanRate(body.hourly_rate_presencial);
  if (want('hourly_rate_online')) out.hourly_rate_online = cleanRate(body.hourly_rate_online);
  if (want('transport_value')) out.transport_value = cleanRate(body.transport_value, 'Valor de transporte');
  if (want('availability_grid')) {
    const grid = cleanGrid(body.availability_grid);
    out.availability_grid = grid ? JSON.stringify(grid) : null;
  }
  if (want('notes')) out.notes = cleanNotes(body.notes);
  if (want('subject_ids')) out.subject_ids = cleanSubjectIds(body.subject_ids);
  return out;
}

// ---------- Consultas ----------

// Os dados do currículo (nome, tamanho, data) vêm junto, mas NUNCA o conteúdo do arquivo (data):
// ele só é lido no download.
const SELECT_BASE = `
  SELECT t.*, c.file_name AS cv_file_name, c.size AS cv_size, c.uploaded_at AS cv_uploaded_at
  FROM talents t
  LEFT JOIN talent_cvs c ON c.talent_id = t.id`;

function subjectsOf(talentId) {
  return db.prepare(`
    SELECT s.id, s.name FROM talent_subjects ts
    JOIN subjects s ON s.id = ts.subject_id
    WHERE ts.talent_id = ?
    ORDER BY s.name
  `).all(talentId);
}

function subjectsByTalent() {
  const map = new Map();
  const rows = db.prepare(`
    SELECT ts.talent_id, s.id, s.name FROM talent_subjects ts
    JOIN subjects s ON s.id = ts.subject_id
    ORDER BY s.name
  `).all();
  for (const r of rows) {
    if (!map.has(r.talent_id)) map.set(r.talent_id, []);
    map.get(r.talent_id).push({ id: r.id, name: r.name });
  }
  return map;
}

// full: com observações e disponibilidade (ficha); sem: só o necessário para a lista.
function toJson(row, subjects, full) {
  const ext = row.cv_file_name ? extensionOf(row.cv_file_name) : null;
  const type = ext ? CV_TYPES[ext] : null;
  const out = {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    hourly_rate_presencial: row.hourly_rate_presencial,
    hourly_rate_online: row.hourly_rate_online,
    transport_value: row.transport_value,
    has_notes: !!row.notes,
    has_availability: !!row.availability_grid,
    subjects,
    cv: row.cv_file_name
      ? {
        file_name: row.cv_file_name,
        size: row.cv_size,
        ext,
        image: !!(type && type.image),
        inline_ok: !!(type && type.inline),
        uploaded_at: row.cv_uploaded_at,
      }
      : null,
    created_at: row.created_at,
  };
  if (full) {
    out.notes = row.notes || '';
    out.availability_grid = parseGrid(row.availability_grid);
  }
  return out;
}

function get(id) {
  const row = db.prepare(`${SELECT_BASE} WHERE t.id = ?`).get(id);
  return row ? toJson(row, subjectsOf(row.id), true) : null;
}

// Para a busca: sem diferença entre maiúsculas/minúsculas nem acentos ("joao" acha "João").
function fold(s) {
  return String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

// Lista (em ordem de nome). Filtros: search (nome, contatos, endereço, observações, disciplinas e nome
// do arquivo do currículo) e subjectId (só quem tem aquela disciplina).
function list(query) {
  const q = query || {};
  const search = fold(typeof q.search === 'string' ? q.search.trim().slice(0, MAX_SEARCH) : '');
  let subjectId = null;
  if (q.subjectId !== undefined && q.subjectId !== '') {
    subjectId = asId(q.subjectId);
    if (subjectId === null) throw httpError(400, 'Disciplina inválida');
  }
  const bySubject = subjectsByTalent();
  let rows = db.prepare(SELECT_BASE).all();
  rows.sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
  if (subjectId !== null) rows = rows.filter((r) => (bySubject.get(r.id) || []).some((s) => s.id === subjectId));
  if (search) {
    rows = rows.filter((r) => {
      const hay = fold([
        r.name, r.email, r.phone, r.address, r.notes, r.cv_file_name,
        (bySubject.get(r.id) || []).map((s) => s.name).join(' '),
      ].join(' \n '));
      return hay.includes(search);
    });
  }
  return rows.map((r) => toJson(r, bySubject.get(r.id) || [], false));
}

// ---------- Gravação ----------

// Várias gravações juntas: ou entram todas, ou nenhuma. Sem "await" dentro, então nenhuma outra
// requisição se mistura no meio.
function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) { /* já desfeito */ }
    throw err;
  }
}

function setSubjects(talentId, subjectIds) {
  db.prepare('DELETE FROM talent_subjects WHERE talent_id = ?').run(talentId);
  const insert = db.prepare('INSERT OR IGNORE INTO talent_subjects (talent_id, subject_id) VALUES (?, ?)');
  for (const sid of subjectIds) insert.run(talentId, sid);
}

function create(body) {
  const v = parseInput(body, false);
  const id = inTransaction(() => {
    const info = db.prepare(`
      INSERT INTO talents (name, phone, email, address, availability_grid, hourly_rate_presencial, hourly_rate_online, transport_value, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(v.name, v.phone, v.email, v.address, v.availability_grid, v.hourly_rate_presencial, v.hourly_rate_online, v.transport_value, v.notes);
    const newId = Number(info.lastInsertRowid);
    setSubjects(newId, v.subject_ids);
    return newId;
  });
  return get(id);
}

const COLUMNS = ['name', 'phone', 'email', 'address', 'availability_grid', 'hourly_rate_presencial', 'hourly_rate_online', 'transport_value', 'notes'];

function update(id, body) {
  if (!db.prepare('SELECT 1 FROM talents WHERE id = ?').get(id)) throw httpError(404, MSG.naoEncontrado);
  const v = parseInput(body, true);
  const cols = COLUMNS.filter((c) => has(v, c)); // nomes de coluna vêm desta lista fixa, nunca do pedido
  inTransaction(() => {
    if (cols.length > 0) {
      db.prepare(`UPDATE talents SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), id);
    }
    if (has(v, 'subject_ids')) setSubjects(id, v.subject_ids);
  });
  return get(id);
}

// Apaga o talento de vez (sem histórico a preservar). O currículo e as disciplinas dele vão junto.
function remove(id) {
  const info = db.prepare('DELETE FROM talents WHERE id = ?').run(id);
  if (!info.changes) throw httpError(404, MSG.naoEncontrado);
}

// ---------- Currículo ----------

// Espaço já ocupado pelos currículos de todos os OUTROS talentos (o do próprio talento, se houver, será trocado).
function usedBytesExcept(talentId) {
  return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM talent_cvs WHERE talent_id != ?').get(talentId).n;
}

function assertRoom(talentId, bytes) {
  if (usedBytesExcept(talentId) + bytes > MAX_CV_TOTAL_BYTES) {
    throw httpError(409, `O espaço reservado aos currículos (${fmtBytes(MAX_CV_TOTAL_BYTES)}) está cheio. Remova currículos que não usa mais e tente de novo.`);
  }
}

// Junta o corpo da requisição na memória (no máximo MAX_CV_BYTES, já conferido antes). Não destrói a
// requisição se algo der errado: o que faltar chegar é descartado, para o servidor ainda conseguir
// responder com a mensagem de erro.
function receiveBuffer(req, expected) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    let bodyEnded = false;

    function settle(err, buf) {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('close', onClose);
      if (err) {
        chunks.length = 0;
        req.resume(); // descarta o resto do envio
        reject(err);
      } else {
        resolve(buf);
      }
    }
    function onData(chunk) {
      received += chunk.length;
      if (received > expected) { settle(httpError(400, 'O arquivo enviado é maior do que o informado.')); return; }
      chunks.push(chunk);
    }
    function onEnd() {
      bodyEnded = true;
      if (received !== expected) { settle(abortedError()); return; }
      settle(null, Buffer.concat(chunks, received));
    }
    function onClose() { if (!bodyEnded) settle(abortedError()); }

    req.on('error', () => settle(abortedError())); // fica ligado de propósito (evita erro sem tratador)
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('close', onClose);
  });
}

// Recebe o arquivo que vem no corpo da requisição e grava como currículo do talento (trocando o
// anterior, se houver). Tudo que dá para conferir sem ler o arquivo é conferido ANTES de lê-lo.
async function receiveCv(req, talentId, rawFileName) {
  if (!db.prepare('SELECT 1 FROM talents WHERE id = ?').get(talentId)) throw httpError(404, MSG.naoEncontrado);

  const name = cleanFileName(rawFileName);
  if (!name) throw httpError(400, 'O arquivo precisa ter um nome.');
  const ext = extensionOf(name);
  if (!ext || !CV_TYPES[ext]) throw httpError(415, MSG.tipo);

  const declared = declaredLength(req);
  if (declared === 0) throw httpError(400, MSG.vazio);
  if (declared > MAX_CV_BYTES) {
    // (No limite exato os dois tamanhos arredondam igual; aí mostra os bytes para a mensagem não ficar sem sentido.)
    const shown = fmtBytes(declared) === fmtBytes(MAX_CV_BYTES) ? `${declared.toLocaleString('pt-BR')} bytes` : fmtBytes(declared);
    throw httpError(413, `O currículo é grande demais (${shown}). O máximo é ${fmtBytes(MAX_CV_BYTES)}.`);
  }
  assertRoom(talentId, declared);

  const buf = await receiveBuffer(req, declared);
  if (!CV_TYPES[ext].check(buf)) throw httpError(400, MSG.conteudo);

  // Daqui até o fim não há "await": nenhuma outra requisição enxerga o meio do caminho. Por isso a
  // existência do talento e o espaço são conferidos de novo (podem ter mudado durante o envio).
  if (!db.prepare('SELECT 1 FROM talents WHERE id = ?').get(talentId)) throw httpError(404, MSG.naoEncontrado);
  assertRoom(talentId, buf.length);
  db.prepare(`
    INSERT INTO talent_cvs (talent_id, file_name, size, data, uploaded_at)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(talent_id) DO UPDATE SET
      file_name = excluded.file_name, size = excluded.size, data = excluded.data, uploaded_at = excluded.uploaded_at
  `).run(talentId, name, buf.length, buf);
  return get(talentId);
}

function removeCv(talentId) {
  if (!db.prepare('SELECT 1 FROM talents WHERE id = ?').get(talentId)) throw httpError(404, MSG.naoEncontrado);
  const info = db.prepare('DELETE FROM talent_cvs WHERE talent_id = ?').run(talentId);
  if (!info.changes) throw httpError(404, MSG.semCurriculo);
  return get(talentId);
}

// Entrega o currículo. Só PDF e imagens podem abrir direto no navegador (inline); o resto sempre
// baixa. O tipo devolvido vem da extensão aprovada, nunca do que o cliente informou, e o navegador é
// proibido de "adivinhar" outro tipo (nosniff).
function sendCv(res, talentId, { inline }) {
  const row = db.prepare('SELECT file_name, data FROM talent_cvs WHERE talent_id = ?').get(talentId);
  if (!row) {
    if (!db.prepare('SELECT 1 FROM talents WHERE id = ?').get(talentId)) throw httpError(404, MSG.naoEncontrado);
    throw httpError(404, MSG.semCurriculo);
  }
  const ext = extensionOf(row.file_name);
  const type = ext ? CV_TYPES[ext] : null;
  if (!type) throw httpError(404, MSG.indisponivel);
  const showInline = !!inline && !!type.inline;
  const data = Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength);
  const headers = {
    'Content-Type': type.mime,
    'Content-Length': data.length,
    'Content-Disposition': contentDisposition(showInline ? 'inline' : 'attachment', row.file_name),
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'private, no-store',
  };
  // O leitor de PDF do Chrome não abre arquivos com "sandbox"; um PDF não executa nada na página
  // (e o tipo é fixado acima), então só ele fica sem. Tudo o mais vai com sandbox.
  if (!(showInline && ext === 'pdf')) headers['Content-Security-Policy'] = 'sandbox';
  res.writeHead(200, headers);
  res.end(data);
}

module.exports = {
  MAX_CV_BYTES,
  MAX_CV_TOTAL_BYTES,
  CV_TYPES,
  config,
  list,
  get,
  create,
  update,
  remove,
  receiveCv,
  removeCv,
  sendCv,
  asId,
  cleanText, // exportado para os testes
  // Conferência de textos, disciplinas e busca: usados também pelo Controle de interessados (server/leads.js).
  cleanLine,
  cleanNotes,
  cleanSubjectIds,
  fold,
  inTransaction,
  EMAIL_RE,
};
