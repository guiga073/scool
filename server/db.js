// server/db.js
// Camada de banco de dados usando o módulo nativo node:sqlite (Node.js 22.5+).
// Sem dependências externas — nada para compilar, nada para falhar na instalação.

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'sistema.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  phone TEXT,
  email TEXT,
  login_email TEXT,
  password_hash TEXT,
  monthly_payment INTEGER NOT NULL DEFAULT 0,
  monthly_value REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  value TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  pix TEXT,
  availability TEXT,
  availability_grid TEXT,
  login_email TEXT,
  password_hash TEXT,
  hourly_rate_presencial REAL,
  hourly_rate_online REAL,
  transport_value REAL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  modality TEXT NOT NULL DEFAULT 'presencial',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  student_value REAL NOT NULL DEFAULT 0,
  teacher_value REAL NOT NULL DEFAULT 0,
  transport_value REAL NOT NULL DEFAULT 0,
  meeting_link TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  student_paid INTEGER NOT NULL DEFAULT 0,
  student_paid_at TEXT,
  recurrence_group_id TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id, start_time);
CREATE INDEX IF NOT EXISTS idx_classes_student ON classes(student_id, start_time);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);

CREATE TABLE IF NOT EXISTS teacher_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_value REAL NOT NULL DEFAULT 0,
  total_hours REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  generated_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(teacher_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS monthly_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(student_id, month, year)
);

CREATE TABLE IF NOT EXISTS class_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  feedback TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_teacher_student ON class_feedback(teacher_id, student_id);

-- Materiais de aula (arquivos e links) compartilhados entre um aluno e um professor.
-- O arquivo em si fica em disco (pasta "materiais" dentro de DATA_DIR); aqui só o registro.
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  uploader_type TEXT NOT NULL CHECK (uploader_type IN ('teacher', 'student')),
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  title TEXT NOT NULL,
  note TEXT,
  original_name TEXT,
  stored_name TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_materials_pair ON materials(student_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_materials_created ON materials(created_at);

-- Ajustes simples do sistema (chave/valor). Hoje: se o aluno pode enviar materiais.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Banco de talentos (só a administração vê): pessoas que a Olimais pode querer contratar como
-- professor no futuro. Têm os mesmos dados de um professor, menos o que só vale depois de contratar
-- (login, chave PIX, transporte), mais o currículo e as observações.
CREATE TABLE IF NOT EXISTS talents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  availability_grid TEXT,
  hourly_rate_presencial REAL,
  hourly_rate_online REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS talent_subjects (
  talent_id INTEGER NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (talent_id, subject_id)
);

-- Currículo do talento: um arquivo por talento, guardado DENTRO do banco de dados (e não numa
-- pasta), para entrar no "Baixar backup dos dados" e sumir junto com o talento. O tamanho é
-- limitado em server/talents.js.
CREATE TABLE IF NOT EXISTS talent_cvs (
  talent_id INTEGER PRIMARY KEY REFERENCES talents(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Controle de interessados (só a administração vê): pais e responsáveis que entraram em contato,
-- perguntaram sobre as aulas e ainda não agendaram nada. Ficam guardados para a Olimais retomar o
-- contato mais tarde. As datas são só o dia ("AAAA-MM-DD"); situação, modalidade e origem são
-- códigos conferidos em server/leads.js (por isso sem CHECK aqui: acrescentar uma opção no futuro
-- não exige refazer a tabela).
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  student_name TEXT,
  grade_level TEXT,
  modality TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  contact_date TEXT,
  follow_up_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS lead_subjects (
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, subject_id)
);

-- Histórico das mensagens do WhatsApp (as que o sistema envia e as que chegam). Serve para ligar uma
-- resposta ("Sim"/"Não") à aula certa, evitar processar duas vezes a mesma mensagem e mostrar para a
-- administração o que aconteceu. Guarda telefones (dados pessoais): as linhas com mais de 90 dias são
-- apagadas sozinhas (ver server/whatsapp/scheduler.js).
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  phone TEXT,
  wamid TEXT,
  status TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_wamid ON wa_messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_messages_class ON wa_messages(class_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created ON wa_messages(created_at);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  recurring_expense_id INTEGER REFERENCES recurring_expenses(id),
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
`);

// Migração leve: adiciona colunas novas em bancos que já existiam antes desta versão
// (não apaga nada — só garante que a coluna exista antes de ser usada).
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('teachers', 'availability_grid', 'TEXT');
ensureColumn('teachers', 'login_email', 'TEXT');
ensureColumn('teachers', 'password_hash', 'TEXT');
ensureColumn('students', 'login_email', 'TEXT');
ensureColumn('students', 'password_hash', 'TEXT');
// Série em que o aluno está (texto livre, opcional). Alunos que já existiam ficam sem série (vazio).
// Atenção ao nome: a tabela "grades" guarda as NOTAS; a série é "grade_level".
ensureColumn('students', 'grade_level', 'TEXT');
ensureColumn('teachers', 'hourly_rate_presencial', 'REAL');
ensureColumn('teachers', 'hourly_rate_online', 'REAL');
// Talentos: valor de transporte pretendido (sem padrão: vazio = não informado).
ensureColumn('talents', 'transport_value', 'REAL');
// DEFAULT 10 aqui não é só para professores novos: o SQLite também usa esse valor
// para preencher a coluna em quem já estava cadastrado, então isso já deixa
// R$10 configurado para todo mundo que já existia no banco.
ensureColumn('teachers', 'transport_value', 'REAL DEFAULT 10');
ensureColumn('classes', 'transport_value', 'REAL DEFAULT 0');
ensureColumn('expenses', 'recurring_expense_id', 'INTEGER REFERENCES recurring_expenses(id)');
// Confirmação das aulas pelo WhatsApp (ver server/whatsapp/ e server/confirmation.js).
// "confirmation_status" é um campo À PARTE do "status" da aula ('scheduled'/'cancelled'): um pedido de
// cancelamento NÃO tira a aula das contas e das estatísticas — só avisa a administração, que decide.
//   confirmation_status: 'pendente' (padrão) | 'confirmada' | 'pedido_cancelamento'
//   confirmation_source: quem definiu o valor atual — 'whatsapp' | 'automatico' | 'admin' (vazio = padrão)
//   confirm_sent_at / confirm_wamid: o aviso de confirmação foi enviado (e o código da mensagem na Meta)
//   confirm_error: por que o aviso não foi enviado/entregue (a administração vê isso na aula)
ensureColumn('classes', 'confirmation_status', "TEXT NOT NULL DEFAULT 'pendente'");
ensureColumn('classes', 'confirmation_source', 'TEXT');
ensureColumn('classes', 'confirmation_updated_at', 'TEXT');
ensureColumn('classes', 'confirm_sent_at', 'TEXT');
ensureColumn('classes', 'confirm_wamid', 'TEXT');
ensureColumn('classes', 'confirm_error', 'TEXT');
ensureColumn('classes', 'confirm_attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('classes', 'confirm_last_try_at', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_classes_confirmation ON classes(confirmation_status, start_time)');
// Quem recebe o aviso de confirmação: 'responsavel' (padrão) ou, em casos específicos, o próprio 'aluno'.
ensureColumn('students', 'confirmer', "TEXT NOT NULL DEFAULT 'responsavel'");

// Controle de interessados (v15): "data do último contato" e "motivo de não fechamento" substituem
// situação, 1º contato, retorno, e-mail, série e modalidade (essas colunas antigas continuam no banco, com o que
// já estava gravado, mas o sistema não as mostra nem grava mais). Na primeira vez, a data do último contato
// começa com a data do primeiro contato que já existia (ou o dia do cadastro).
ensureColumn('leads', 'last_contact_date', 'TEXT');
ensureColumn('leads', 'lost_reason', 'TEXT');
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'leads.v15_migrated'").get()) {
  db.exec("UPDATE leads SET last_contact_date = COALESCE(contact_date, substr(created_at, 1, 10)) WHERE last_contact_date IS NULL");
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('leads.v15_migrated', '1')").run();
}


// Links de aula antigos: antes o link era salvo exatamente como digitado, e um link sem
// "https://" (ex.: "meet.google.com/abc") não abre pelo link da aula — o navegador
// o entende como um endereço dentro do próprio portal. Aqui eles são corrigidos de forma
// segura: só completa o "https://" (nunca apaga nem troca o link). Roda a cada início do
// servidor, mas só mexe no que ainda estiver sem https.
{
  const { normalizeMeetingLink } = require('./links');
  const rows = db.prepare("SELECT id, meeting_link FROM classes WHERE meeting_link IS NOT NULL AND TRIM(meeting_link) != ''").all();
  const update = db.prepare('UPDATE classes SET meeting_link = ? WHERE id = ?');
  let fixed = 0;
  let invalid = 0;
  for (const r of rows) {
    const n = normalizeMeetingLink(r.meeting_link);
    if (!n.ok) { invalid++; continue; }
    if (n.value !== r.meeting_link) { update.run(n.value, r.id); fixed++; }
  }
  if (fixed > 0) console.log(`[setup] Links de aula corrigidos para https://: ${fixed}`);
  if (invalid > 0) console.log(`[setup] ATENÇÃO: ${invalid} aula(s) com link inválido (não alterado(s)). Edite a aula para corrigir.`);
}

// A tabela de sessões mudou de "sempre admin" (admin_id) para "admin ou professor"
// (user_type + user_id). Sessões são só tokens de login temporários — se o formato
// antigo for encontrado, é mais simples recriar a tabela (todo mundo só precisa
// entrar de novo uma vez) do que tentar migrar linha por linha.
const sessionCols = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").all();
if (sessionCols.length > 0) {
  const cols = db.prepare('PRAGMA table_info(sessions)').all();
  if (!cols.some((c) => c.name === 'user_type')) {
    db.exec('DROP TABLE sessions');
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  expires_at TEXT NOT NULL
);
`);

// Disciplinas padrão: roda sempre (não só na primeira vez), usando "ignora se já existir",
// para que novas disciplinas adicionadas aqui no futuro apareçam também em instalações
// que já estavam em uso — sem duplicar as que a pessoa já tinha.
{
  const insertSubject = db.prepare('INSERT OR IGNORE INTO subjects (name) VALUES (?)');
  const defaults = [
    'Matemática', 'Português', 'Ciências', 'História', 'Geografia', 'Inglês',
    'Física', 'Química', 'Biologia', 'Redação', 'Artes', 'Literatura',
    'Alemão', 'Espanhol', 'Desenho',
  ];
  for (const s of defaults) insertSubject.run(s);
}

// Seed initial admin from environment variables, only if no admin exists yet
const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
if (adminCount === 0) {
  const email = (process.env.ADMIN_EMAIL || 'admin@escola.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'mudar123';
  const { hashPassword } = require('./auth');
  db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), 'Administrador');
  console.log(`[setup] Conta de administrador criada: ${email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('[setup] ATENÇÃO: usando senha padrão "mudar123". Defina ADMIN_PASSWORD nas variáveis de ambiente e reinicie para mudar.');
  }
}

// Gera uma cópia consistente do banco de dados inteiro, pronta para download.
// O "checkpoint" obriga o SQLite a gravar tudo que ainda estava só no arquivo
// -wal (mudanças recentes, em modo WAL) dentro do arquivo principal antes de
// copiá-lo — sem isso, uma cópia simples do arquivo poderia sair incompleta.
function backupBuffer() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  return fs.readFileSync(DB_PATH);
}

module.exports = { db, backupBuffer, DATA_DIR };
