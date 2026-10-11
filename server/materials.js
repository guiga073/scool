// server/materials.js
// Materiais de aula (arquivos e links) compartilhados entre um aluno e um professor.
//
// Este arquivo cuida do ARMAZENAMENTO: onde os arquivos ficam, limites de tamanho e de espaço,
// conferência do tipo de arquivo, envio em fluxo (sem carregar o arquivo inteiro na memória),
// download e as consultas ao banco. As regras de QUEM pode ver / enviar / apagar ficam todas em
// routes/materials.js, num lugar só.
//
// Onde ficam os arquivos: DATA_DIR/materiais — a mesma pasta do banco (na Railway, o volume
// montado em /data). Nunca dentro de "public/": os arquivos só saem por uma rota que confere o
// login e a permissão.
//
// Limites (variáveis de ambiente opcionais; 1 MB = 1.000.000 bytes):
//   MATERIALS_MAX_FILE_MB   tamanho máximo de um arquivo           (padrão 50)
//   MATERIALS_MAX_TOTAL_MB  teto de todos os arquivos somados      (padrão 4500 = 4,5 GB)
//   MATERIALS_MIN_FREE_MB   espaço livre que o volume deve manter  (padrão 200; 0 desliga)
// O banco de dados mora no mesmo volume dos arquivos. Por isso, além do teto, o envio é recusado
// se o volume estiver ficando sem espaço livre — materiais nunca podem travar o resto do portal.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { db, DATA_DIR } = require('./db');
const { httpError } = require('./router');
const { normalizeMaterialLink } = require('./links');

// ---------- Configuração ----------

const MB = 1000 * 1000;

function readMb(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const MAX_FILE_BYTES = Math.floor((readMb('MATERIALS_MAX_FILE_MB', 50) || 50) * MB);
const MAX_TOTAL_BYTES = Math.floor((readMb('MATERIALS_MAX_TOTAL_MB', 4500) || 4500) * MB);
const MIN_FREE_BYTES = Math.floor(readMb('MATERIALS_MIN_FREE_MB', 200) * MB);

const FILES_DIR = path.join(DATA_DIR, 'materiais');
const TMP_DIR = path.join(FILES_DIR, 'tmp'); // envios em andamento; limpa sozinho ao iniciar

const MAX_TITLE = 120;
const MAX_NOTE = 500;
const MAX_NAME = 120;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

// ---------- Tipos de arquivo aceitos ----------
// Só tipos de estudo comuns, e SEM nada que o navegador execute (nada de .html, .svg, .js...).
// Cada tipo tem o "tipo MIME" que o servidor devolve no download (nunca o que o cliente disser)
// e uma conferência dos primeiros bytes do arquivo, para pegar um programa renomeado para .pdf.
// Para aceitar mais um tipo, acrescente uma linha aqui — a tela lê a lista pelo servidor.

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}
const MAGIC = {
  pdf: (b) => b.subarray(0, 1024).includes('%PDF-'),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  webp: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  zip: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]), // .docx / .pptx / .xlsx são pacotes ZIP
};

const FILE_TYPES = {
  pdf: { mime: 'application/pdf', check: MAGIC.pdf },
  jpg: { mime: 'image/jpeg', check: MAGIC.jpeg, image: true },
  jpeg: { mime: 'image/jpeg', check: MAGIC.jpeg, image: true },
  png: { mime: 'image/png', check: MAGIC.png, image: true },
  gif: { mime: 'image/gif', check: MAGIC.gif, image: true },
  webp: { mime: 'image/webp', check: MAGIC.webp, image: true },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: MAGIC.zip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: MAGIC.zip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: MAGIC.zip },
};

function allowedExtensions() { return Object.keys(FILE_TYPES); }

const MSG = {
  tipo: 'Este tipo de arquivo não é aceito. Envie PDF, imagem (JPG, PNG, GIF ou WEBP), Word (.docx), PowerPoint (.pptx) ou Excel (.xlsx).',
  cheio: 'Não há espaço suficiente no armazenamento de materiais para este arquivo. Avise a secretaria.',
  vazio: 'O arquivo está vazio.',
  semTamanho: 'Não foi possível enviar: o navegador não informou o tamanho do arquivo.',
  conteudo: 'O conteúdo deste arquivo não confere com o tipo dele. Ele pode estar corrompido ou ter sido renomeado. Abra e salve de novo no formato certo.',
  interrompido: 'O envio foi interrompido. Tente de novo.',
};

// "1,5 MB" — mesma conta da tela (1 MB = 1.000.000 bytes).
function fmtBytes(n) {
  n = Math.max(0, Number(n) || 0);
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const round = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  let v = n / 1000;
  let i = 0;
  while (round(v) >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${String(round(v)).replace('.', ',')} ${units[i]}`;
}

// ---------- Nomes ----------

// Nome do arquivo como a pessoa o conhece (para mostrar e para o download). Nunca é usado como
// caminho no disco: o arquivo é guardado com um nome aleatório (veja STORED_RE).
function cleanFileName(raw) {
  let s = String(raw === undefined || raw === null ? '' : raw);
  try { s = s.normalize('NFC'); } catch (e) { /* mantém como veio */ }
  // Tira caracteres de controle e os invisíveis que servem para disfarçar a extensão
  // (ex.: inversão de direção do texto: "foto\u202Egpj.exe" parece "fotoexe.jpg").
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  s = s.split(/[\\/]/).pop();                  // só o nome do arquivo, sem pasta
  s = s.replace(/[<>:"|?*]/g, '');             // caracteres que nenhum sistema aceita em nome de arquivo
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
  const dot = s.lastIndexOf('.');
  let base = dot > 0 ? s.slice(0, dot) : s;
  const ext = dot > 0 ? s.slice(dot) : '';
  const room = Math.max(1, MAX_NAME - ext.length);
  base = Array.from(base).slice(0, room).join('').trim();
  if (!base && ext) base = 'arquivo';
  return base + ext;
}

function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : null;
}

// Título / observação digitados: sem caracteres de controle e com tamanho limitado.
function cleanText(raw, max, { multiline }) {
  let s = String(raw === undefined || raw === null ? '' : raw);
  s = s.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ');
  if (multiline) s = s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  else s = s.replace(/\s+/g, ' ');
  s = s.trim();
  return Array.from(s).slice(0, max).join('');
}
const cleanTitle = (raw) => cleanText(raw, MAX_TITLE, { multiline: false });
const cleanNote = (raw) => cleanText(raw, MAX_NOTE, { multiline: true });

// Nome com que o arquivo é guardado no disco: 32 letras/números aleatórios + a extensão.
const STORED_RE = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;
function newStoredName(ext) { return `${crypto.randomBytes(16).toString('hex')}.${ext}`; }

function storedPath(storedName) {
  if (!STORED_RE.test(String(storedName || ''))) throw new Error('Nome de arquivo guardado inválido');
  return path.join(FILES_DIR, storedName);
}

// ---------- Espaço usado ----------
// O espaço usado é medido no DISCO (não só pela soma dos registros do banco), porque é o disco
// que enche. A medida fica em memória e é conferida de novo a cada minuto; envios e exclusões
// atualizam o número na hora.

let usedCache = { bytes: 0, at: 0 };
let reservedBytes = 0; // espaço "reservado" por envios em andamento, para dois envios ao mesmo tempo não estourarem o teto

function ensureDirs() { fs.mkdirSync(TMP_DIR, { recursive: true }); }

function scanUsedBytes() {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(FILES_DIR, { withFileTypes: true }); } catch (e) { return 0; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try { total += fs.statSync(path.join(FILES_DIR, entry.name)).size; } catch (e) { /* sumiu no meio do caminho */ }
  }
  return total;
}

function getUsedBytes() {
  if (Date.now() - usedCache.at > 60 * 1000) usedCache = { bytes: scanUsedBytes(), at: Date.now() };
  return usedCache.bytes;
}
function invalidateUsed() { usedCache.at = 0; }

// Espaço do volume onde o portal grava (null quando o sistema não informa).
function diskInfo() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    const bsize = Number(s.bsize);
    if (!(bsize > 0) || !(Number(s.blocks) > 0)) return null;
    return { freeBytes: Number(s.bavail) * bsize, totalBytes: Number(s.blocks) * bsize };
  } catch (e) {
    return null;
  }
}

function remainingBytes() {
  let left = MAX_TOTAL_BYTES - getUsedBytes() - reservedBytes;
  const disk = diskInfo();
  if (disk && MIN_FREE_BYTES > 0) left = Math.min(left, disk.freeBytes - MIN_FREE_BYTES - reservedBytes);
  return Math.max(0, left);
}

function assertSpace(needed) {
  if (needed > remainingBytes()) throw httpError(409, MSG.cheio);
}

// ---------- Ajustes (chave/valor) ----------

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
function studentUploadsEnabled() { return getSetting('materials_student_uploads', '1') !== '0'; }
function setStudentUploads(enabled) { setSetting('materials_student_uploads', enabled ? '1' : '0'); }

// ---------- Início do servidor ----------

function sweepOrphans() {
  const known = new Set(
    db.prepare("SELECT stored_name FROM materials WHERE kind = 'file' AND stored_name IS NOT NULL").all().map((r) => r.stored_name)
  );
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(FILES_DIR, { withFileTypes: true }); } catch (e) { return 0; }
  for (const entry of entries) {
    if (!entry.isFile() || !STORED_RE.test(entry.name) || known.has(entry.name)) continue;
    const full = path.join(FILES_DIR, entry.name);
    try {
      if (fs.statSync(full).mtimeMs > cutoff) continue; // pode ser um envio que acabou de terminar
      fs.unlinkSync(full);
      removed++;
    } catch (e) { /* já foi embora */ }
  }
  if (removed > 0) invalidateUsed();
  return removed;
}

function init() {
  ensureDirs();
  // Qualquer coisa em tmp/ é de um envio que ficou pela metade (o servidor reiniciou no meio).
  let partial = 0;
  for (const name of fs.readdirSync(TMP_DIR)) {
    try { fs.rmSync(path.join(TMP_DIR, name), { force: true, recursive: true }); partial++; } catch (e) { /* ignora */ }
  }
  const orphans = sweepOrphans();
  invalidateUsed();
  const files = db.prepare("SELECT COUNT(*) AS c FROM materials WHERE kind = 'file'").get().c;
  console.log(`[materiais] Pasta ${FILES_DIR}: ${files} arquivo(s), ${fmtBytes(getUsedBytes())} usados de ${fmtBytes(MAX_TOTAL_BYTES)} (máximo por arquivo: ${fmtBytes(MAX_FILE_BYTES)}).`);
  if (partial > 0) console.log(`[materiais] Envios interrompidos descartados: ${partial}.`);
  if (orphans > 0) console.log(`[materiais] Arquivos sem registro apagados: ${orphans}.`);
  const disk = diskInfo();
  if (disk && MIN_FREE_BYTES > 0 && disk.freeBytes < MIN_FREE_BYTES) {
    console.log(`[materiais] ATENÇÃO: só há ${fmtBytes(disk.freeBytes)} livres no volume; novos envios serão recusados até liberar espaço.`);
  }
  // De tempos em tempos, apaga arquivos sem registro (ex.: o servidor caiu entre salvar o arquivo e o registro).
  const timer = setInterval(() => {
    try { sweepOrphans(); } catch (e) { console.error('[materiais] erro ao limpar arquivos sem registro:', e); }
  }, 6 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}

// ---------- Envio de arquivo ----------

function declaredLength(req) {
  const raw = req.headers['content-length'];
  if (!/^\d{1,16}$/.test(String(raw === undefined ? '' : raw)) || req.headers['transfer-encoding']) {
    throw httpError(411, MSG.semTamanho);
  }
  return Number(raw);
}

function abortedError() {
  const err = httpError(400, MSG.interrompido);
  err.aborted = true;
  return err;
}

// Grava o corpo da requisição num arquivo temporário, aos poucos (com controle de fluxo), sem
// nunca segurar o arquivo inteiro na memória. Não destrói a requisição se algo der errado: o
// que faltar chegar é descartado, para o servidor ainda conseguir responder com a mensagem de erro.
function receiveBody(req, tmpPath, expected) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 });
    let received = 0;
    let settled = false;
    let bodyEnded = false;

    function settle(err) {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('close', onClose);
      if (err) {
        ws.destroy();
        req.resume(); // descarta o resto do envio
        reject(err);
      } else {
        resolve(received);
      }
    }
    function onData(chunk) {
      received += chunk.length;
      if (received > expected) { settle(httpError(400, 'O arquivo enviado é maior do que o informado.')); return; }
      if (!ws.write(chunk)) {
        req.pause();
        ws.once('drain', () => { if (!settled) req.resume(); });
      }
    }
    function onEnd() {
      bodyEnded = true;
      if (received !== expected) { settle(abortedError()); return; }
      ws.end((err) => settle(err || null));
    }
    function onClose() { if (!bodyEnded) settle(abortedError()); }

    ws.on('error', (err) => settle(err));
    req.on('error', () => settle(abortedError())); // fica ligado de propósito (evita erro sem tratador)
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('close', onClose);
  });
}

function readHead(file, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// Recebe o arquivo que vem no corpo da requisição e registra o material.
// opts: { studentId, teacherId, uploaderType, rawFileName, title, note }
// Devolve a linha do banco (já com os nomes do aluno e do professor).
async function receiveFile(req, opts) {
  ensureDirs();

  const name = cleanFileName(opts.rawFileName);
  if (!name) throw httpError(400, 'O arquivo precisa ter um nome.');
  const ext = extensionOf(name);
  if (!ext || !FILE_TYPES[ext]) throw httpError(415, MSG.tipo);

  const declared = declaredLength(req);
  if (declared === 0) throw httpError(400, MSG.vazio);
  if (declared > MAX_FILE_BYTES) {
    // (No limite exato os dois tamanhos arredondam igual; aí mostra os bytes para a mensagem não ficar sem sentido.)
    const shown = fmtBytes(declared) === fmtBytes(MAX_FILE_BYTES) ? `${declared.toLocaleString('pt-BR')} bytes` : fmtBytes(declared);
    throw httpError(413, `O arquivo é grande demais (${shown}). O máximo é ${fmtBytes(MAX_FILE_BYTES)}.`);
  }
  assertSpace(declared);

  // Daqui em diante o envio ocupa espaço: reserva (e devolve no "finally").
  reservedBytes += declared;
  const tmpPath = path.join(TMP_DIR, `up-${crypto.randomBytes(12).toString('hex')}.part`);
  const storedName = newStoredName(ext);
  const finalPath = path.join(FILES_DIR, storedName);
  try {
    try {
      await receiveBody(req, tmpPath, declared);
    } catch (err) {
      if (err && err.code === 'ENOSPC') throw httpError(409, MSG.cheio);
      throw err;
    }

    // Confere se o conteúdo bate com o tipo anunciado pela extensão.
    if (!FILE_TYPES[ext].check(readHead(tmpPath, 1024))) throw httpError(400, MSG.conteudo);

    // Tudo certo: move para o lugar definitivo e registra. Sem "await" daqui até o fim, então
    // nenhuma outra tarefa enxerga o arquivo sem o registro.
    fs.renameSync(tmpPath, finalPath);
    usedCache.bytes += declared;
    try {
      const title = cleanTitle(opts.title) || name.replace(/\.[^.]*$/, '').slice(0, MAX_TITLE);
      const info = db.prepare(`
        INSERT INTO materials (student_id, teacher_id, uploader_type, kind, title, note, original_name, stored_name, size)
        VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)
      `).run(opts.studentId, opts.teacherId, opts.uploaderType, title, cleanNote(opts.note) || null, name, storedName, declared);
      return getMaterial(info.lastInsertRowid);
    } catch (err) {
      fs.rmSync(finalPath, { force: true });
      usedCache.bytes = Math.max(0, usedCache.bytes - declared);
      throw err;
    }
  } finally {
    reservedBytes -= declared;
    fs.rmSync(tmpPath, { force: true });
  }
}

// ---------- Links ----------

function addLink(opts) {
  const r = normalizeMaterialLink(opts.url);
  if (!r.ok) throw httpError(400, r.error);
  if (!r.value) throw httpError(400, 'Informe o endereço (link) do material.');
  let title = cleanTitle(opts.title);
  if (!title) {
    try { title = new URL(r.value).hostname.replace(/^www\./, ''); } catch (e) { title = 'Link'; }
  }
  const info = db.prepare(`
    INSERT INTO materials (student_id, teacher_id, uploader_type, kind, title, note, url)
    VALUES (?, ?, ?, 'link', ?, ?, ?)
  `).run(opts.studentId, opts.teacherId, opts.uploaderType, title, cleanNote(opts.note) || null, r.value);
  return getMaterial(info.lastInsertRowid);
}

// ---------- Consultas ----------

const SELECT_BASE = `
  SELECT m.*, s.name AS student_name, t.name AS teacher_name
  FROM materials m
  JOIN students s ON s.id = m.student_id
  JOIN teachers t ON t.id = m.teacher_id`;

function asId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function getMaterial(id) {
  const n = asId(id);
  if (n === null) return null;
  return db.prepare(`${SELECT_BASE} WHERE m.id = ?`).get(n) || null;
}

// Todos os materiais de um aluno (de todos os professores), ou só os de um professor.
function listForStudent(studentId, teacherId) {
  const params = [studentId];
  let where = 'WHERE m.student_id = ?';
  if (teacherId) { where += ' AND m.teacher_id = ?'; params.push(teacherId); }
  return db.prepare(`${SELECT_BASE} ${where} ORDER BY m.created_at DESC, m.id DESC`).all(...params);
}

// Lista da secretaria: todos os materiais, com busca e ordem.
function adminList({ q, sort, limit, offset }) {
  const params = [];
  let where = '';
  if (q) {
    const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
    where = `WHERE (m.title LIKE ? ESCAPE '\\' OR m.original_name LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\')`;
    params.push(like, like, like, like);
  }
  const order = sort === 'size' ? 'm.size DESC, m.id DESC' : 'm.created_at DESC, m.id DESC';
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM materials m
    JOIN students s ON s.id = m.student_id
    JOIN teachers t ON t.id = m.teacher_id ${where}`).get(...params).c;
  const items = db.prepare(`${SELECT_BASE} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { items, total };
}

// Dados para mostrar ao aluno/professor/secretaria (nunca inclui o nome guardado no disco).
function toDto(row) {
  const ext = row.kind === 'file' ? extensionOf(row.original_name) : null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    note: row.note || '',
    student_id: row.student_id,
    student_name: row.student_name,
    teacher_id: row.teacher_id,
    teacher_name: row.teacher_name,
    uploader_type: row.uploader_type,
    uploader_name: row.uploader_type === 'teacher' ? row.teacher_name : row.student_name,
    file_name: row.original_name || null,
    ext,
    image: !!(ext && FILE_TYPES[ext] && FILE_TYPES[ext].image),
    size: row.size || 0,
    url: row.kind === 'link' ? row.url : null,
    created_at: row.created_at,
  };
}

function getUsage() {
  const counts = db.prepare("SELECT SUM(kind = 'file') AS files, SUM(kind = 'link') AS links FROM materials").get();
  const disk = diskInfo();
  return {
    usedBytes: getUsedBytes(),
    reservedBytes,
    capBytes: MAX_TOTAL_BYTES,
    maxFileBytes: MAX_FILE_BYTES,
    remainingBytes: remainingBytes(),
    diskFreeBytes: disk ? disk.freeBytes : null,
    diskTotalBytes: disk ? disk.totalBytes : null,
    fileCount: counts.files || 0,
    linkCount: counts.links || 0,
    studentUploads: studentUploadsEnabled(),
  };
}

// ---------- Apagar ----------

function removeStoredFile(storedName) {
  if (!STORED_RE.test(String(storedName || ''))) return;
  const full = path.join(FILES_DIR, storedName);
  try {
    const size = fs.statSync(full).size;
    fs.unlinkSync(full);
    usedCache.bytes = Math.max(0, usedCache.bytes - size);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[materiais] não foi possível apagar o arquivo', storedName, e.message);
  }
}

// Primeiro o registro (some da lista na hora), depois o arquivo. Se o arquivo não puder ser apagado,
// a limpeza periódica de arquivos sem registro cuida dele.
function removeMaterial(row) {
  db.prepare('DELETE FROM materials WHERE id = ?').run(row.id);
  if (row.kind === 'file') removeStoredFile(row.stored_name);
}

function removeAllForStudent(studentId) {
  const rows = db.prepare('SELECT id, kind, stored_name, size FROM materials WHERE student_id = ?').all(studentId);
  db.prepare('DELETE FROM materials WHERE student_id = ?').run(studentId);
  let files = 0;
  let freedBytes = 0;
  for (const r of rows) {
    if (r.kind !== 'file') continue;
    removeStoredFile(r.stored_name);
    files++;
    freedBytes += r.size || 0;
  }
  return { count: rows.length, files, links: rows.length - files, freedBytes };
}

// ---------- Download ----------

// Content-Disposition seguro para nomes com acento: versão simples (ASCII) + versão UTF-8.
function contentDisposition(type, filename) {
  const fallback = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${utf8}`;
}

// Entrega o arquivo, em fluxo. Só imagens podem abrir direto no navegador (inline); o resto
// sempre baixa. O tipo devolvido vem da extensão aprovada, nunca do que o cliente informou, e
// o navegador é proibido de "adivinhar" outro tipo (nosniff) ou de executar qualquer coisa (sandbox).
async function sendFile(req, res, row, { inline }) {
  const ext = extensionOf(row.original_name);
  const type = ext && FILE_TYPES[ext];
  let full;
  let st;
  try {
    if (!type) throw new Error('tipo desconhecido');
    full = storedPath(row.stored_name);
    st = await fs.promises.stat(full);
    if (!st.isFile()) throw new Error('não é arquivo');
  } catch (e) {
    throw httpError(404, 'Este arquivo não está mais disponível no servidor. Peça para enviarem de novo.');
  }
  const showInline = !!inline && !!type.image;
  res.writeHead(200, {
    'Content-Type': type.mime,
    'Content-Length': st.size,
    'Content-Disposition': contentDisposition(showInline ? 'inline' : 'attachment', row.original_name || `arquivo.${ext}`),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'private, no-store',
  });
  try {
    await pipeline(fs.createReadStream(full), res);
  } catch (e) {
    // Download interrompido (a pessoa fechou a página, internet caiu...): não é um erro do servidor.
    if (!res.destroyed) res.destroy();
  }
}

module.exports = {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  FILE_TYPES,
  allowedExtensions,
  fmtBytes,
  init,
  getUsage,
  remainingBytes,
  receiveFile,
  addLink,
  getMaterial,
  listForStudent,
  adminList,
  toDto,
  removeMaterial,
  removeAllForStudent,
  sendFile,
  studentUploadsEnabled,
  setStudentUploads,
  cleanFileName, // exportados para os testes
  extensionOf,
};
