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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  phone TEXT,
  email TEXT,
  monthly_payment INTEGER NOT NULL DEFAULT 0,
  monthly_value REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  value TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
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
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
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
  meeting_link TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  student_paid INTEGER NOT NULL DEFAULT 0,
  student_paid_at TEXT,
  recurrence_group_id TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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
  generated_at TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, month, year)
);

CREATE TABLE IF NOT EXISTS class_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  feedback TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_teacher_student ON class_feedback(teacher_id, student_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now')),
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

module.exports = { db };
