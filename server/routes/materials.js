// server/routes/materials.js
// Materiais de aula: rotas e, principalmente, TODAS as regras de permissão num lugar só.
//
// Desde a v19, cada material pertence a um TRIO: aluno + professor + disciplina. O trio "existe" enquanto
// houver ao menos uma aula agendada (não cancelada) daquele aluno com aquele professor naquela disciplina,
// com os dois ativos. Assim, um professor que dá Matemática e Física para o mesmo aluno tem duas pastas
// separadas, e um material de uma nunca aparece na outra.
//
//                  ver                                  enviar                         apagar
//   secretaria     tudo                                 (não envia por aqui)           qualquer material
//   professor      só os dos trios dele                 só num trio dele               qualquer um dos trios dele
//   aluno          só os próprios (todas as disciplinas) só num trio dele*              só os que ele mesmo enviou
//
//   * o administrador pode desligar o envio pelos alunos (ajuste "studentUploads").
//
// Materiais antigos sem disciplina (subject_id NULL, de antes da v19) seguem a regra do PAR aluno–professor
// e podem ser movidos para uma disciplina pelo professor do par ou pela secretaria (PUT .../subject).
//
// Quem é o professor/aluno vem SEMPRE do login, nunca de um número enviado pelo navegador:
// o navegador só diz "com qual aluno/professor", e isso é conferido contra as aulas.
// Material que não existe e material que a pessoa não pode ver dão a mesma resposta (404).

const { db } = require('../db');
const { sendJson, httpError } = require('../router');
const { getSessionUser, parseCookies } = require('../auth');
const { requireAuth } = require('./auth');
const mat = require('../materials');

function currentUser(req) {
  const user = getSessionUser(db, parseCookies(req).session);
  if (!user) throw httpError(401, 'Não autenticado');
  return user;
}

function asId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Aluno e professor ativos com ao menos uma aula agendada juntos.
function activePair(studentId, teacherId) {
  const row = db.prepare(`
    SELECT 1 FROM classes c
    JOIN students s ON s.id = c.student_id AND s.active = 1
    JOIN teachers t ON t.id = c.teacher_id AND t.active = 1
    WHERE c.student_id = ? AND c.teacher_id = ? AND c.status = 'scheduled'
    LIMIT 1
  `).get(studentId, teacherId);
  return !!row;
}

// Aluno e professor ativos com ao menos uma aula agendada juntos NAQUELA disciplina.
function activeTrack(studentId, teacherId, subjectId) {
  const row = db.prepare(`
    SELECT 1 FROM classes c
    JOIN students s ON s.id = c.student_id AND s.active = 1
    JOIN teachers t ON t.id = c.teacher_id AND t.active = 1
    WHERE c.student_id = ? AND c.teacher_id = ? AND c.subject_id = ? AND c.status = 'scheduled'
    LIMIT 1
  `).get(studentId, teacherId, subjectId);
  return !!row;
}

// Disciplina pedida pelo navegador: número, ou "none" para os materiais antigos sem disciplina.
// Devolve undefined quando não veio nada.
function parseSubject(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'none') return null;
  const id = asId(value);
  if (!id) throw httpError(400, 'Disciplina inválida.');
  return id;
}

// O material está num trio (ou, se antigo, num par) que este professor ainda acompanha?
function teacherOwns(user, row) {
  if (row.teacher_id !== user.id) return false;
  return row.subject_id ? activeTrack(row.student_id, user.id, row.subject_id) : activePair(row.student_id, user.id);
}

// Para onde um material antigo (sem disciplina) pode ser movido: as disciplinas do par.
// Professor: só as disciplinas que ele ainda dá para o aluno. Secretaria: qualquer disciplina que o par já teve.
function moveOptions(user, row) {
  if (row.subject_id) return [];
  if (user.type !== 'admin' && !(user.type === 'teacher' && row.teacher_id === user.id)) return [];
  return db.prepare(`
    SELECT DISTINCT sub.id, sub.name FROM classes c
    JOIN subjects sub ON sub.id = c.subject_id
    WHERE c.student_id = ? AND c.teacher_id = ? ${user.type === 'admin' ? '' : "AND c.status = 'scheduled'"}
    ORDER BY sub.name
  `).all(row.student_id, row.teacher_id);
}

// ---- Regras ----

// De quem são os materiais que esta pessoa está pedindo para ver?
function resolveListScope(user, query) {
  if (user.type === 'admin') {
    const studentId = asId(query.studentId);
    if (!studentId) throw httpError(400, 'Informe o aluno.');
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId)) throw httpError(404, 'Aluno não encontrado');
    return { studentId, teacherId: asId(query.teacherId) };
  }
  if (user.type === 'teacher') {
    const studentId = asId(query.studentId);
    if (!studentId) throw httpError(400, 'Informe o aluno.');
    const subject = parseSubject(query.subjectId);
    if (subject === undefined) throw httpError(400, 'Escolha a disciplina.');
    if (subject === null) {
      if (!activePair(studentId, user.id)) throw httpError(403, 'Este aluno não está entre os seus');
    } else if (!activeTrack(studentId, user.id, subject)) {
      throw httpError(403, 'Você não tem aulas agendadas com este aluno nesta disciplina');
    }
    return { studentId, teacherId: user.id, subject };
  }
  return { studentId: user.id, teacherId: asId(query.teacherId) };
}

// Em qual par (aluno + professor) esta pessoa está enviando algo?
function resolveWriteScope(user, params) {
  if (user.type === 'admin') {
    throw httpError(403, 'A secretaria não envia materiais por aqui. O envio é feito pelo professor ou pelo aluno.');
  }
  const subjectId = parseSubject(params.subjectId);
  if (!subjectId) throw httpError(400, 'Escolha a disciplina do material.');
  if (user.type === 'teacher') {
    const studentId = asId(params.studentId);
    if (!studentId) throw httpError(400, 'Informe o aluno.');
    if (!activeTrack(studentId, user.id, subjectId)) throw httpError(403, 'Você não tem aulas agendadas com este aluno nesta disciplina');
    return { studentId, teacherId: user.id, subjectId, uploaderType: 'teacher' };
  }
  if (!mat.studentUploadsEnabled()) {
    throw httpError(403, 'O envio de materiais pelos alunos está desligado no momento. Peça ao seu professor para enviar.');
  }
  const teacherId = asId(params.teacherId);
  if (!teacherId) throw httpError(400, 'Escolha o professor.');
  if (!activeTrack(user.id, teacherId, subjectId)) throw httpError(403, 'Você não tem aulas agendadas com este professor nesta disciplina');
  return { studentId: user.id, teacherId, subjectId, uploaderType: 'student' };
}

function canView(user, row) {
  if (user.type === 'admin') return true;
  if (user.type === 'teacher') return teacherOwns(user, row);
  return user.type === 'student' && row.student_id === user.id;
}

function canDelete(user, row) {
  if (user.type === 'admin') return true;
  if (user.type === 'teacher') return teacherOwns(user, row);
  return user.type === 'student' && row.student_id === user.id && row.uploader_type === 'student';
}

function loadViewable(user, id) {
  const row = mat.getMaterial(id);
  if (!row || !canView(user, row)) throw httpError(404, 'Material não encontrado');
  return row;
}

// pairVerified: a listagem já conferiu o par uma vez, então não precisa conferir material por material.
function dtoFor(user, row, pairVerified) {
  let canDel;
  if (user.type === 'admin') canDel = true;
  else if (user.type === 'teacher') canDel = row.teacher_id === user.id && (pairVerified || teacherOwns(user, row));
  else canDel = row.student_id === user.id && row.uploader_type === 'student';
  const dto = { ...mat.toDto(row), can_delete: !!canDel };
  if (!row.subject_id && user.type !== 'student') dto.move_options = moveOptions(user, row);
  return dto;
}

// Título e observação vão em cabeçalhos HTTP (assim não aparecem no endereço), codificados com
// encodeURIComponent pelo navegador.
function decodeHeader(req, name) {
  const raw = req.headers[name];
  if (raw === undefined) return '';
  try {
    return decodeURIComponent(String(raw));
  } catch (e) {
    throw httpError(400, 'Dados do envio inválidos. Atualize a página e tente de novo.');
  }
}

// Se o envio é recusado antes de o arquivo ser lido e o arquivo é enorme, não vale a pena esperar o
// navegador mandar tudo: encerra a conexão depois de responder.
const DRAIN_LIMIT_BYTES = mat.MAX_FILE_BYTES + 1000 * 1000;

// Quando a pessoa clica em "Baixar" e dá erro (arquivo sumiu, sessão expirou), o navegador abre a
// resposta numa aba. Para essa aba mostrar uma página legível em vez de um texto técnico (JSON),
// o erro do download é devolvido como uma página simples quando o pedido veio de um clique.
function isNavigation(req) {
  return req.headers['sec-fetch-mode'] === 'navigate' || /text\/html/.test(req.headers.accept || '');
}

function sendErrorPage(res, status, message) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const action = status === 401
    ? '<p><a href="/login.html">Entrar de novo</a></p>'
    : '<p>Você pode fechar esta aba e voltar ao portal.</p>';
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Não foi possível abrir o arquivo</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#FFFAF0;color:#141414;margin:0;padding:40px 16px}
main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #E9E1CB;border-radius:16px;padding:26px 28px}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 12px;line-height:1.5}a{color:#141414}</style></head>
<body><main><h1>Não foi possível abrir o arquivo</h1><p>${esc(message)}</p>${action}</main></body></html>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  });
  res.end(html);
}

function register(router) {
  // Limites e opções para as telas.
  router.get('/api/materials/config', async (req, res) => {
    const user = currentUser(req);
    const remaining = mat.remainingBytes();
    sendJson(res, 200, {
      maxFileBytes: mat.MAX_FILE_BYTES,
      allowedExtensions: mat.allowedExtensions(),
      studentUploads: mat.studentUploadsEnabled(),
      remainingBytes: remaining,
      storageFull: remaining <= 0,
      canUpload: user.type === 'teacher' || (user.type === 'student' && mat.studentUploadsEnabled()),
    });
  });

  // Para quem a pessoa pode enviar, por disciplina: o aluno vê "professor — disciplina"; o professor vê
  // "aluno — disciplina". O professor também recebe uma linha por aluno com materiais antigos sem disciplina
  // (subject_id null, com a contagem em legacy_count), para poder vê-los e movê-los.
  router.get('/api/materials/targets', async (req, res) => {
    const user = currentUser(req);
    if (user.type === 'student') {
      sendJson(res, 200, db.prepare(`
        SELECT DISTINCT t.id AS teacher_id, t.name AS teacher_name, sub.id AS subject_id, sub.name AS subject_name FROM classes c
        JOIN teachers t ON t.id = c.teacher_id AND t.active = 1
        JOIN students s ON s.id = c.student_id AND s.active = 1
        JOIN subjects sub ON sub.id = c.subject_id
        WHERE c.student_id = ? AND c.status = 'scheduled'
        ORDER BY t.name, sub.name
      `).all(user.id));
      return;
    }
    if (user.type === 'teacher') {
      const tracks = db.prepare(`
        SELECT DISTINCT s.id AS student_id, s.name AS student_name, sub.id AS subject_id, sub.name AS subject_name FROM classes c
        JOIN students s ON s.id = c.student_id AND s.active = 1
        JOIN teachers t ON t.id = c.teacher_id AND t.active = 1
        JOIN subjects sub ON sub.id = c.subject_id
        WHERE c.teacher_id = ? AND c.status = 'scheduled'
        ORDER BY s.name, sub.name
      `).all(user.id);
      const legacy = db.prepare(`
        SELECT m.student_id, COUNT(*) AS n FROM materials m
        WHERE m.teacher_id = ? AND m.subject_id IS NULL GROUP BY m.student_id
      `).all(user.id);
      const out = tracks.slice();
      for (const l of legacy) {
        const first = tracks.find((t) => t.student_id === l.student_id); // só alunos que ele ainda acompanha
        if (first) out.push({ student_id: l.student_id, student_name: first.student_name, subject_id: null, subject_name: null, legacy_count: l.n });
      }
      out.sort((x, y) => x.student_name.localeCompare(y.student_name, 'pt-BR') || (x.subject_id === null) - (y.subject_id === null) || String(x.subject_name).localeCompare(String(y.subject_name), 'pt-BR'));
      sendJson(res, 200, out);
      return;
    }
    sendJson(res, 200, []);
  });

  // Lista de materiais (do aluno; ou do par aluno + professor, para o professor).
  router.get('/api/materials', async (req, res) => {
    const user = currentUser(req);
    const scope = resolveListScope(user, req.query);
    const rows = mat.listForStudent(scope.studentId, scope.teacherId, scope.subject);
    sendJson(res, 200, rows.map((r) => dtoFor(user, r, true)));
  });

  // Envio de arquivo: o próprio arquivo é o corpo da requisição ("raw"). Nome, título e observação
  // vão em cabeçalhos; aluno/professor no endereço. Tudo é conferido ANTES de ler o arquivo.
  router.post('/api/materials/file', async (req, res) => {
    const user = currentUser(req);
    const scope = resolveWriteScope(user, req.query);
    try {
      const row = await mat.receiveFile(req, {
        ...scope,
        rawFileName: decodeHeader(req, 'x-file-name'),
        title: decodeHeader(req, 'x-title'),
        note: decodeHeader(req, 'x-note'),
      });
      sendJson(res, 201, dtoFor(user, row, true));
    } catch (err) {
      const declared = Number(req.headers['content-length']) || 0;
      if (!req.complete && declared > DRAIN_LIMIT_BYTES) res.setHeader('Connection', 'close');
      throw err;
    }
  }, { raw: true });

  // Envio de link.
  router.post('/api/materials/link', async (req, res) => {
    const user = currentUser(req);
    const b = req.body || {};
    const scope = resolveWriteScope(user, b);
    const row = mat.addLink({ ...scope, title: b.title, url: b.url, note: b.note });
    sendJson(res, 201, dtoFor(user, row, true));
  });

  // Download (ou, para imagens, abrir no navegador com ?inline=1).
  router.get('/api/materials/:id/download', async (req, res) => {
    try {
      const user = currentUser(req);
      const row = loadViewable(user, req.params.id);
      if (row.kind !== 'file') throw httpError(400, 'Este material é um link, não um arquivo.');
      await mat.sendFile(req, res, row, { inline: req.query.inline === '1' });
    } catch (err) {
      if (err && err.statusCode && !res.headersSent && isNavigation(req)) { sendErrorPage(res, err.statusCode, err.message); return; }
      throw err;
    }
  });

  // Move um material antigo (sem disciplina) para uma disciplina do par. Professor do par ou secretaria.
  router.put('/api/materials/:id/subject', async (req, res) => {
    const user = currentUser(req);
    if (user.type === 'student') throw httpError(403, 'Só o professor ou a secretaria podem definir a disciplina.');
    const row = loadViewable(user, req.params.id);
    if (row.subject_id) throw httpError(409, 'Este material já tem disciplina.');
    const subjectId = parseSubject((req.body || {}).subjectId);
    if (!subjectId) throw httpError(400, 'Escolha a disciplina.');
    if (!moveOptions(user, row).some((o) => o.id === subjectId)) throw httpError(400, 'Esta disciplina não é de nenhuma aula deste aluno com este professor.');
    sendJson(res, 200, dtoFor(user, mat.setSubject(row.id, subjectId), false));
  });

  router.delete('/api/materials/:id', async (req, res) => {
    const user = currentUser(req);
    const row = loadViewable(user, req.params.id);
    if (!canDelete(user, row)) throw httpError(403, 'Só quem enviou o material (ou a secretaria) pode apagá-lo.');
    mat.removeMaterial(row);
    sendJson(res, 200, { ok: true });
  });

  // ---- Secretaria ----

  // Todos os materiais, com uso do espaço, busca e ordem.
  router.get('/api/admin/materials', async (req, res) => {
    const user = requireAuth(req);
    const q = String(req.query.q || '').trim().slice(0, 100);
    const sort = req.query.sort === 'size' ? 'size' : 'recent';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { items, total } = mat.adminList({ q, sort, limit, offset });
    sendJson(res, 200, {
      usage: mat.getUsage(),
      items: items.map((r) => dtoFor(user, r, true)),
      total,
    });
  });

  // Liga/desliga o envio de materiais pelos alunos.
  router.put('/api/admin/materials/settings', async (req, res) => {
    requireAuth(req);
    const b = req.body || {};
    if (typeof b.studentUploads !== 'boolean') throw httpError(400, 'Valor inválido');
    mat.setStudentUploads(b.studentUploads);
    sendJson(res, 200, { studentUploads: mat.studentUploadsEnabled() });
  });

  // Apaga todos os materiais de um aluno (arquivos e links).
  router.delete('/api/students/:id/materials', async (req, res) => {
    requireAuth(req);
    const studentId = asId(req.params.id);
    if (!studentId || !db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId)) throw httpError(404, 'Aluno não encontrado');
    sendJson(res, 200, { ok: true, ...mat.removeAllForStudent(studentId) });
  });
}

// isNavigation e sendErrorPage também são usados pela rota do manual do aluno (routes/manual.js).
module.exports = { register, isNavigation, sendErrorPage };
