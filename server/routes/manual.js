// server/routes/manual.js
// Manual da Área do Aluno (PDF): só o aluno logado consegue abrir.
//
// O arquivo fica em server/assets/ — fora da pasta "public", que é a única entregue sem login — e só
// sai por esta rota, que confere o login a cada pedido:
//
//   aluno logado            -> recebe o PDF
//   ninguém logado          -> 401 (quem clicou no botão vê uma página pedindo para entrar de novo)
//   professor ou secretaria -> 403 (o manual é só para alunos)
//
// Para trocar o manual: substitua server/assets/manual-aluno.pdf e publique de novo (veja o README).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { db } = require('../db');
const { httpError } = require('../router');
const { getSessionUser, parseCookies } = require('../auth');
const { isNavigation, sendErrorPage } = require('./materials');

const MANUAL_FILE = path.join(__dirname, '..', 'assets', 'manual-aluno.pdf');
const MANUAL_URL = '/api/student-portal/manual.pdf';
const DOWNLOAD_NAME = 'Manual-Area-do-Aluno-Olimais.pdf';

// O manual tem ~10 MB. Com um ETag (impressão digital do conteúdo), quem abre de novo recebe só um
// "não mudou" (304) em vez de baixar tudo outra vez; e, se o arquivo for trocado, todos recebem o novo.
// A impressão é calculada uma vez (e de novo só se o arquivo mudar), não a cada pedido.
let etagCache = { key: '', value: '' };

async function manualEtag(st) {
  const key = `${st.size}:${st.mtimeMs}`;
  if (etagCache.key !== key) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(MANUAL_FILE)) hash.update(chunk);
    etagCache = { key, value: `"${hash.digest('hex').slice(0, 32)}"` };
  }
  return etagCache.value;
}

function matchesEtag(req, etag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  const bare = (t) => t.trim().replace(/^W\//, '');
  return String(header).split(',').some((t) => t.trim() === '*' || bare(t) === etag);
}

function requireStudent(req) {
  const user = getSessionUser(db, parseCookies(req).session);
  if (!user) throw httpError(401, 'Entre na Área do Aluno para abrir o manual.');
  if (user.type !== 'student') throw httpError(403, 'O manual da Área do Aluno é exclusivo para alunos.');
  return user;
}

async function sendManual(req, res) {
  let st;
  let etag;
  try {
    st = await fs.promises.stat(MANUAL_FILE);
    if (!st.isFile()) throw new Error('não é arquivo');
    etag = await manualEtag(st);
  } catch (e) {
    throw httpError(404, 'O manual não está disponível no momento. Fale com a Olimais.');
  }
  // "private, no-cache": o navegador guarda o arquivo, mas pergunta ao servidor (que confere o login)
  // antes de reutilizar; assim, quem não é aluno nunca recebe uma cópia guardada por outra pessoa.
  const common = { ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (matchesEtag(req, etag)) {
    res.writeHead(304, common);
    res.end();
    return;
  }
  // Sem "Content-Security-Policy: sandbox": o leitor de PDF do Chrome não abre arquivos assim. Não há
  // risco aqui, porque o arquivo é nosso (não vem de upload de ninguém).
  res.writeHead(200, {
    ...common,
    'Content-Type': 'application/pdf',
    'Content-Length': st.size,
    'Content-Disposition': `inline; filename="${DOWNLOAD_NAME}"`,
  });
  try {
    await pipeline(fs.createReadStream(MANUAL_FILE), res);
  } catch (e) {
    // Download interrompido (a pessoa fechou a aba, a internet caiu...): não é um erro do servidor.
    if (!res.destroyed) res.destroy();
  }
}

function register(router) {
  router.get(MANUAL_URL, async (req, res) => {
    try {
      requireStudent(req);
      await sendManual(req, res);
    } catch (err) {
      // Quando a pessoa clica no botão e dá erro, o navegador mostra a resposta numa aba: nesse caso,
      // uma página legível em vez de texto técnico (JSON).
      if (err && err.statusCode && !res.headersSent && isNavigation(req)) { sendErrorPage(res, err.statusCode, err.message); return; }
      throw err;
    }
  });
}

module.exports = { register, MANUAL_URL };
