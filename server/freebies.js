// server/freebies.js
// Materiais gratuitos com cadastro (hoje: o Manual do ENEM).
//
// Fluxo:
//   1. a página do site (olimais.com.br/manual-do-enem.html) envia nome, e-mail, celular, os aceites e a origem
//      para POST /api/gratis/<material> (portal);
//   2. o portal guarda a pessoa (uma linha por e-mail em free_leads) e o pedido (free_downloads, com um token),
//      e devolve o link de download; se o e-mail estiver configurado, manda o mesmo link por e-mail;
//   3. o PDF só sai por /api/gratis/baixar/<token>, com limite de downloads e validade.
// O painel "Downloads (Manual)" mostra os números e as pessoas, para a equipe entrar em contato depois.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, DATA_DIR } = require('./db');
const { httpError } = require('./router');
const { toWaPhone, formatPhone } = require('./whatsapp/phone');
const mail = require('./mail');
const leads = require('./leads');

const FILES_DIR = path.join(DATA_DIR, 'gratis');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUS = [
  { key: 'novo', label: 'Novo' },
  { key: 'contatado', label: 'Contatado' },
  { key: 'virou_aluno', label: 'Virou aluno' },
  { key: 'sem_interesse', label: 'Sem interesse' },
];
const STATUS_LABEL = new Map(STATUS.map((s) => [s.key, s.label]));

// UF de cada DDD (para o painel mostrar de onde vêm as pessoas).
const DDD_UF = {};
[['SP', '11 12 13 14 15 16 17 18 19'], ['RJ', '21 22 24'], ['ES', '27 28'], ['MG', '31 32 33 34 35 37 38'], ['PR', '41 42 43 44 45 46'],
  ['SC', '47 48 49'], ['RS', '51 53 54 55'], ['DF', '61'], ['GO', '62 64'], ['TO', '63'], ['MT', '65 66'], ['MS', '67'], ['AC', '68'], ['RO', '69'],
  ['BA', '71 73 74 75 77'], ['SE', '79'], ['PE', '81 87'], ['AL', '82'], ['PB', '83'], ['RN', '84'], ['CE', '85 88'], ['PI', '86 89'],
  ['PA', '91 93 94'], ['AM', '92 97'], ['RR', '95'], ['AP', '96'], ['MA', '98 99']]
  .forEach(([uf, list]) => list.split(' ').forEach((d) => { DDD_UF[d] = uf; }));

function maxFileBytes() {
  const n = Number(process.env.FREE_MAX_FILE_MB);
  return Math.floor((Number.isFinite(n) && n > 0 ? n : 50) * 1000 * 1000);
}
function publicUrl() { return String(process.env.PORTAL_PUBLIC_URL || 'https://portal.olimais.com.br').trim().replace(/\/+$/, ''); }
// Sites que podem enviar o formulário (CORS). Padrão: o site da OLIMAIS.
function allowedOrigins() {
  const raw = String(process.env.SITE_ORIGINS || 'https://olimais.com.br,https://www.olimais.com.br');
  return raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}
function sitePageUrl(slug) { return `${allowedOrigins()[0] || 'https://olimais.com.br'}/${slug === 'manual-enem' ? 'manual-do-enem.html' : ''}`; }

// ---------- utilidades ----------

function pad(n) { return String(n).padStart(2, '0'); }
function dbTime(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function parseDb(s) { return s ? new Date(String(s).replace(' ', 'T')) : null; }
function brDate(s) { const d = parseDb(s); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ''; }
function asId(v) { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function cleanInt(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, `${label}: de ${min} a ${max}.`);
  return n;
}
function fileNameFor(m) {
  const base = String(m.name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'material'}-OLIMAIS.pdf`;
}

// Origem do download: vem do site (?origem=…, utm_source ou o site de onde a pessoa veio). Só letras, números, - _ .
function cleanSource(v) {
  const s = fold(typeof v === 'string' ? v : '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'direto';
}

// ---------- materiais ----------

function materialRow(id) { return db.prepare('SELECT * FROM free_materials WHERE id = ?').get(id) || null; }
function materialBySlug(slug) { return db.prepare('SELECT * FROM free_materials WHERE slug = ?').get(String(slug || '')) || null; }
function materialFile(m) {
  if (!m || !m.file_stored_name) return null;
  const full = path.join(FILES_DIR, path.basename(m.file_stored_name));
  return fs.existsSync(full) ? full : null;
}
function materialDto(m) {
  return { id: m.id, slug: m.slug, name: m.name, active: !!m.active, has_file: !!materialFile(m), file_name: m.file_original_name || null,
    file_size: m.file_size || 0, max_downloads: m.max_downloads, link_days: m.link_days, site_url: sitePageUrl(m.slug), updated_at: m.updated_at };
}
function listMaterials() { return db.prepare('SELECT * FROM free_materials ORDER BY id').all().map(materialDto); }

function seed() {
  if (!db.prepare('SELECT 1 FROM free_materials').get()) {
    db.prepare("INSERT INTO free_materials (slug, name, active) VALUES ('manual-enem', 'Manual do ENEM', 0)").run();
  }
}

function updateMaterial(id, body) {
  const m = materialRow(id);
  if (!m) throw httpError(404, 'Material não encontrado.');
  const b = body || {};
  const sets = [];
  const vals = [];
  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 120) throw httpError(400, 'Nome: de 1 a 120 caracteres.');
    sets.push('name = ?'); vals.push(name);
  }
  if (b.max_downloads !== undefined) { sets.push('max_downloads = ?'); vals.push(cleanInt(b.max_downloads, 1, 20, 'Downloads por cadastro')); }
  if (b.link_days !== undefined) { sets.push('link_days = ?'); vals.push(cleanInt(b.link_days, 1, 90, 'Validade do link (dias)')); }
  if (b.active !== undefined) {
    if (b.active && !materialFile(m)) throw httpError(400, 'Envie o PDF antes de liberar os downloads.');
    sets.push('active = ?'); vals.push(b.active ? 1 : 0);
  }
  if (sets.length) db.prepare(`UPDATE free_materials SET ${sets.join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(...vals, id);
  return materialDto(materialRow(id));
}

// Recebe o PDF (corpo cru da requisição), confere que é PDF e troca o arquivo.
async function saveMaterialFile(id, req, rawName) {
  const m = materialRow(id);
  if (!m) throw httpError(404, 'Material não encontrado.');
  const declared = Number(req.headers['content-length']);
  const max = maxFileBytes();
  if (!Number.isFinite(declared) || declared <= 0) throw httpError(400, 'Arquivo vazio.');
  if (declared > max) throw httpError(413, `O PDF é grande demais. O máximo é ${Math.round(max / 1e6)} MB.`);
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const stored = `${crypto.randomBytes(16).toString('hex')}.pdf`;
  const tmp = path.join(FILES_DIR, `${stored}.part`);
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
    let got = 0;
    let done = false;
    const fail = (err) => { if (done) return; done = true; ws.destroy(); req.resume(); fs.rmSync(tmp, { force: true }); reject(err); };
    req.on('data', (chunk) => {
      got += chunk.length;
      if (got > declared) { fail(httpError(400, 'O arquivo enviado é maior do que o informado.')); return; }
      if (!ws.write(chunk)) { req.pause(); ws.once('drain', () => { if (!done) req.resume(); }); }
    });
    req.on('end', () => {
      if (done) return;
      if (got !== declared) { fail(httpError(400, 'O envio foi interrompido. Tente de novo.')); return; }
      ws.end((err) => { if (err) fail(err); else { done = true; resolve(); } });
    });
    req.on('error', () => fail(httpError(400, 'O envio foi interrompido. Tente de novo.')));
    ws.on('error', fail);
  });
  const fd = fs.openSync(tmp, 'r');
  const head = Buffer.alloc(5);
  fs.readSync(fd, head, 0, 5, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== '%PDF-') {
    fs.rmSync(tmp, { force: true });
    throw httpError(400, 'Este arquivo não é um PDF. Exporte o manual como PDF e envie de novo.');
  }
  fs.renameSync(tmp, path.join(FILES_DIR, stored));
  const name = String(rawName || 'manual.pdf').replace(/[\r\n"]/g, '').trim().slice(0, 200) || 'manual.pdf';
  db.prepare(`UPDATE free_materials SET file_stored_name = ?, file_original_name = ?, file_size = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
    .run(stored, name, declared, id);
  if (m.file_stored_name) fs.rmSync(path.join(FILES_DIR, path.basename(m.file_stored_name)), { force: true });
  return materialDto(materialRow(id));
}

// Para a página do site: o material está disponível?
function publicMaterial(slug) {
  const m = materialBySlug(slug);
  if (!m) throw httpError(404, 'Material não encontrado.');
  const available = !!m.active && !!materialFile(m);
  return { slug: m.slug, name: m.name, available, link_days: m.link_days, max_downloads: m.max_downloads };
}

// ---------- cadastro e download ----------

const recent = new Map(); // ip → horários
function rateLimit(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= 10) throw httpError(429, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.');
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
}

function downloadEmail(person, material, link, expires, max) {
  const first = String(person.name).split(/\s+/)[0];
  const subject = `Seu ${material.name} — OLIMAIS`;
  const text = [`Olá, ${first}!`, '', `Aqui está o link para baixar o ${material.name}: ${link}`, '',
    `O link vale até ${expires} e permite até ${max} downloads.`, '',
    'Bons estudos! Qualquer dúvida, fale com a gente pelo WhatsApp (21) 97700-3208.', '', 'Equipe OLIMAIS'].join('\n');
  const e = mail.esc;
  const html = `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#FFFAF0;font-family:Arial,Helvetica,sans-serif;color:#141414">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E9E1CB;border-radius:16px;padding:28px">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8A6A1F;font-weight:bold">OLIMAIS</p>
<h1 style="margin:0 0 16px;font-size:22px">Olá, ${e(first)}!</h1>
<p style="margin:0 0 12px;line-height:1.5">Aqui está o seu <strong>${e(material.name)}</strong>.</p>
<p style="margin:24px 0"><a href="${e(link)}" style="display:inline-block;background:#FCB400;color:#141414;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:999px">Baixar o ${e(material.name)}</a></p>
<p style="margin:0 0 12px;line-height:1.5;font-size:14px;color:#555">O link vale até <strong>${e(expires)}</strong> e permite até <strong>${e(max)} downloads</strong>.</p>
<p style="margin:0 0 4px;line-height:1.5;font-size:14px;color:#555">Se o botão não abrir, copie este endereço:<br><span style="word-break:break-all">${e(link)}</span></p>
<p style="margin:20px 0 0;line-height:1.5;font-size:14px">Bons estudos! Qualquer dúvida, fale com a gente pelo WhatsApp (21) 97700-3208.<br>Equipe OLIMAIS</p>
</div></body></html>`;
  return { subject, text, html };
}

// Recebe o cadastro do site. Devolve { download_url, email_sent }.
async function register(slug, body, ip) {
  const b = body || {};
  // Armadilha para robôs: o campo "website" fica escondido na página; pessoa de verdade não preenche.
  if (typeof b.website === 'string' && b.website.trim()) throw httpError(400, 'Não foi possível enviar. Atualize a página e tente de novo.');
  const m = materialBySlug(slug);
  if (!m || !m.active || !materialFile(m)) throw httpError(409, 'O download está indisponível no momento. Fale com a gente pelo WhatsApp (21) 97700-3208.');
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 5 || name.split(' ').length < 2 || name.length > 120) throw httpError(400, 'Informe o seu nome completo (nome e sobrenome).');
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 160) throw httpError(400, 'Confira o e-mail: ele parece incompleto (ex.: nome@gmail.com).');
  const ph = toWaPhone(b.phone);
  if (!ph.ok) throw httpError(400, `Confira o celular: ${ph.error}. Use o DDD + número, por exemplo (21) 99999-1234.`);
  if (b.privacy !== true) throw httpError(400, 'Para baixar, aceite a Política de Privacidade.');
  const consent = b.contact === true;
  const source = cleanSource(b.source);
  rateLimit(ip || '?');

  const existing = db.prepare('SELECT * FROM free_leads WHERE email = ?').get(email);
  let personId;
  if (existing) {
    personId = existing.id;
    db.prepare(`UPDATE free_leads SET name = ?, phone = ?, contact_consent = ?, consent_at = CASE WHEN ? = 1 THEN datetime('now', 'localtime') ELSE consent_at END,
        privacy_accepted_at = datetime('now', 'localtime'), requests = requests + 1, last_request_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
      WHERE id = ?`).run(name, ph.phone, consent ? 1 : 0, consent ? 1 : 0, personId);
  } else {
    const info = db.prepare(`INSERT INTO free_leads (email, name, phone, contact_consent, consent_at, privacy_accepted_at, first_source, requests, last_request_at)
      VALUES (?, ?, ?, ?, ${consent ? "datetime('now', 'localtime')" : 'NULL'}, datetime('now', 'localtime'), ?, 1, datetime('now', 'localtime'))`)
      .run(email, name, ph.phone, consent ? 1 : 0, source);
    personId = Number(info.lastInsertRowid);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = dbTime(new Date(Date.now() + m.link_days * 86400000));
  const info = db.prepare(`INSERT INTO free_downloads (person_id, material_id, token, source, expires_at, max_downloads) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(personId, m.id, token, source, expires, m.max_downloads);
  const link = `${publicUrl()}/api/gratis/baixar/${token}`;
  let emailSent = false;
  if (mail.configured()) {
    const person = db.prepare('SELECT * FROM free_leads WHERE id = ?').get(personId);
    const r = await mail.send(email, downloadEmail(person, m, link, brDate(expires), m.max_downloads));
    emailSent = r.ok;
    db.prepare(`UPDATE free_downloads SET ${r.ok ? "email_sent_at = datetime('now', 'localtime'), email_error = NULL" : 'email_error = ?'} WHERE id = ?`)
      .run(...(r.ok ? [] : [r.error]), Number(info.lastInsertRowid));
  }
  return { download_url: link, email_sent: emailSent, link_days: m.link_days, max_downloads: m.max_downloads };
}

function downloadFile(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw httpError(404, 'Link inválido. Confira se o endereço está completo.');
  const d = db.prepare('SELECT * FROM free_downloads WHERE token = ?').get(token);
  if (!d) throw httpError(404, 'Link inválido ou já removido. Peça o material de novo no site da OLIMAIS.');
  const exp = parseDb(d.expires_at);
  if (exp && Date.now() > exp.getTime()) throw httpError(403, 'Este link venceu. Peça o material de novo no site da OLIMAIS (é grátis).');
  const m = materialRow(d.material_id);
  const file = materialFile(m);
  if (!m || !m.active || !file) throw httpError(410, 'O material está indisponível no momento. Fale com a OLIMAIS pelo WhatsApp (21) 97700-3208.');
  const r = db.prepare(`UPDATE free_downloads SET download_count = download_count + 1, first_download_at = coalesce(first_download_at, datetime('now', 'localtime')),
    last_download_at = datetime('now', 'localtime') WHERE id = ? AND download_count < max_downloads`).run(d.id);
  if (r.changes !== 1) throw httpError(403, 'O limite de downloads deste link foi atingido. Peça o material de novo no site da OLIMAIS (é grátis).');
  return { file, fileName: fileNameFor(m) };
}

// ---------- painel ----------

function personDto(p) {
  const ddd = String(p.phone || '').replace(/^55/, '').slice(0, 2);
  return {
    id: p.id, name: p.name, email: p.email, phone: p.phone, phone_display: formatPhone(p.phone), uf: DDD_UF[ddd] || null,
    contact_consent: !!p.contact_consent, consent_at: p.consent_at, first_source: p.first_source, status: p.status,
    status_label: STATUS_LABEL.get(p.status) || p.status, notes: p.notes || '', lead_id: p.lead_id || null,
    requests: p.requests, downloads: p.downloads || 0, last_request_at: p.last_request_at, created_at: p.created_at,
  };
}

const PERSON_SELECT = `SELECT l.*, (SELECT COALESCE(SUM(download_count), 0) FROM free_downloads d WHERE d.person_id = l.id) AS downloads FROM free_leads l`;

function listPeople(q) {
  q = q || {};
  const where = [];
  const params = [];
  if (q.status && STATUS_LABEL.has(q.status)) { where.push('l.status = ?'); params.push(q.status); }
  if (q.consent === 'sim') where.push('l.contact_consent = 1');
  else if (q.consent === 'nao') where.push('l.contact_consent = 0');
  if (q.source) { where.push('l.first_source = ?'); params.push(cleanSource(q.source)); }
  let rows = db.prepare(`${PERSON_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.created_at DESC, l.id DESC`).all(...params);
  const raw = String(q.q || '').trim().slice(0, 100);
  const s = fold(raw);
  const digits = raw.replace(/\D/g, '');
  if (s) rows = rows.filter((p) => fold(`${p.name} ${p.email} ${p.notes || ''}`).includes(s) || (digits.length >= 4 && String(p.phone).includes(digits)));
  const limit = Math.min(1000, Math.max(1, parseInt(q.limit, 10) || 300));
  return { total: rows.length, items: rows.slice(0, limit).map(personDto) };
}

function getPerson(id) {
  const p = db.prepare(`${PERSON_SELECT} WHERE l.id = ?`).get(id);
  if (!p) throw httpError(404, 'Pessoa não encontrada.');
  const history = db.prepare(`SELECT d.created_at, d.source, d.download_count, d.max_downloads, d.first_download_at, d.expires_at, d.email_sent_at, d.email_error, m.name AS material
    FROM free_downloads d JOIN free_materials m ON m.id = d.material_id WHERE d.person_id = ? ORDER BY d.id DESC`).all(id);
  return { ...personDto(p), history };
}

function updatePerson(id, body) {
  if (!db.prepare('SELECT 1 FROM free_leads WHERE id = ?').get(id)) throw httpError(404, 'Pessoa não encontrada.');
  const b = body || {};
  if (b.status !== undefined) {
    if (!STATUS_LABEL.has(b.status)) throw httpError(400, 'Situação inválida.');
    db.prepare(`UPDATE free_leads SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(b.status, id);
  }
  if (b.notes !== undefined) {
    const n = typeof b.notes === 'string' ? b.notes.replace(/\r\n?/g, '\n').trim() : '';
    if (n.length > 2000) throw httpError(400, 'Observações: até 2.000 caracteres.');
    db.prepare(`UPDATE free_leads SET notes = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(n || null, id);
  }
  return getPerson(id);
}

// Copia a pessoa para o Controle de interessados (origem "Site"), para acompanhar junto com os outros contatos.
function addToLeads(id) {
  const p = db.prepare('SELECT * FROM free_leads WHERE id = ?').get(id);
  if (!p) throw httpError(404, 'Pessoa não encontrada.');
  if (p.lead_id && db.prepare('SELECT 1 FROM leads WHERE id = ?').get(p.lead_id)) throw httpError(409, 'Esta pessoa já está nos Interessados.');
  const first = db.prepare('SELECT MIN(created_at) AS t FROM free_downloads WHERE person_id = ?').get(id).t || p.created_at;
  const lead = leads.create({
    name: p.name,
    phone: formatPhone(p.phone),
    source: 'site',
    last_contact_date: String(p.last_request_at || first).slice(0, 10),
    notes: `Baixou o material gratuito do site em ${brDate(first)}. E-mail: ${p.email}. ${p.contact_consent ? 'Autorizou contato da OLIMAIS.' : 'NÃO autorizou contato de divulgação.'}`,
  });
  db.prepare(`UPDATE free_leads SET lead_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(lead.id, id);
  return getPerson(id);
}

// Apaga a pessoa e o histórico de downloads dela (ex.: pedido de exclusão pela LGPD).
function removePerson(id) {
  const r = db.prepare('DELETE FROM free_leads WHERE id = ?').run(id);
  if (!r.changes) throw httpError(404, 'Pessoa não encontrada.');
  db.prepare('DELETE FROM free_downloads WHERE person_id = ?').run(id);
}

function monthKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

function summary() {
  const now = new Date();
  const thisMonth = monthKey(now);
  const prevMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const people = one('SELECT COUNT(*) AS n, COALESCE(SUM(contact_consent), 0) AS consent FROM free_leads');
  const peopleMonth = one('SELECT COUNT(*) AS n FROM free_leads WHERE substr(created_at, 1, 7) = ?', thisMonth).n;
  const peoplePrev = one('SELECT COUNT(*) AS n FROM free_leads WHERE substr(created_at, 1, 7) = ?', prevMonth).n;
  const req = one('SELECT COUNT(*) AS n, COALESCE(SUM(download_count), 0) AS files, COALESCE(SUM(download_count > 0), 0) AS used FROM free_downloads');
  const reqMonth = one('SELECT COUNT(*) AS n, COALESCE(SUM(download_count), 0) AS files FROM free_downloads WHERE substr(created_at, 1, 7) = ?', thisMonth);
  const byStatus = {};
  for (const s of STATUS) byStatus[s.key] = 0;
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM free_leads GROUP BY status').all()) byStatus[r.status] = r.n;
  const toContact = one("SELECT COUNT(*) AS n FROM free_leads WHERE status = 'novo' AND contact_consent = 1").n;
  const sources = db.prepare('SELECT first_source AS source, COUNT(*) AS n FROM free_leads GROUP BY first_source ORDER BY n DESC LIMIT 8').all();
  const ufCount = {};
  for (const r of db.prepare('SELECT phone FROM free_leads').all()) {
    const uf = DDD_UF[String(r.phone).replace(/^55/, '').slice(0, 2)] || 'outro';
    ufCount[uf] = (ufCount[uf] || 0) + 1;
  }
  const states = Object.entries(ufCount).map(([uf, n]) => ({ uf, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  // Novas pessoas por semana (8 semanas, de segunda a domingo).
  const weeks = [];
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  for (let i = 7; i >= 0; i--) {
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - i * 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const n = one('SELECT COUNT(*) AS n FROM free_leads WHERE created_at >= ? AND created_at < ?', dbTime(start), dbTime(end)).n;
    weeks.push({ start: dbTime(start).slice(0, 10), n });
  }
  return {
    people: people.n, people_this_month: peopleMonth, people_prev_month: peoplePrev,
    consent: people.consent, consent_rate: people.n ? people.consent / people.n : 0,
    requests: req.n, files_downloaded: req.files, requests_used: req.used, requests_this_month: reqMonth.n, files_this_month: reqMonth.files,
    by_status: byStatus, to_contact: toContact, conversion_rate: people.n ? byStatus.virou_aluno / people.n : 0,
    sources, states, weeks, materials: listMaterials(), email_configured: mail.configured(), email_from: mail.from() || null,
    recent: listPeople({ limit: 8 }).items,
  };
}

function csv() {
  const rows = db.prepare(`${PERSON_SELECT} ORDER BY l.created_at DESC, l.id DESC`).all();
  const head = ['Cadastro em', 'Nome', 'E-mail', 'Celular', 'UF (pelo DDD)', 'Autorizou contato', 'Origem', 'Pedidos', 'Downloads', 'Situação', 'Observações'];
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(';')];
  for (const r of rows) {
    const p = personDto(r);
    lines.push([p.created_at, p.name, p.email, p.phone_display, p.uf || '', p.contact_consent ? 'sim' : 'não', p.first_source || '', p.requests, p.downloads, p.status_label, p.notes].map(cell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  STATUS, seed, listMaterials, materialRow, materialFile, updateMaterial, saveMaterialFile, publicMaterial, fileNameFor,
  register, downloadFile, listPeople, getPerson, updatePerson, addToLeads, removePerson, summary, csv, allowedOrigins, asId,
};
