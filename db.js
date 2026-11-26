// Database layer: SQLite schema, settings, and shared helpers.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'academy.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_name TEXT,
  parent_phone TEXT,
  age_group TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  months INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL DEFAULT 0,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  present INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(player_id, date)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'أخرى',
  amount REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'مدرب',
  squad TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(staff_id, date)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const DEFAULTS = {
  training_days: '[0,2,4]', // Sunday, Tuesday, Thursday
  grace_days: '7',
  sub_months: '1',
  sub_amount: '700',
  academy_name: 'يونايتد أكاديمي',
  tpl_payment:
    'أهلًا {parent}، تم استلام اشتراك {player} في {academy} بقيمة {amount} جنيه. الاشتراك ساري حتى {end_date}. شكرًا لثقتكم.',
  tpl_absence:
    'أهلًا {parent}، لاحظنا غياب {player} عن تدريب النهاردة. نتمنى يكون بخير، ومستنيينه في التدريب الجاي.',
  tpl_reminder_7d:
    'أهلًا {parent}، اشتراك {player} في {academy} بينتهي يوم {end_date} (فاضل {days} أيام). عشان يفضل متسجل، ياريت التجديد قبل الانتهاء.',
  tpl_due:
    'أهلًا {parent}، اشتراك {player} في {academy} انتهى النهاردة. للتجديد رد علينا هنا. في فترة سماح {grace} أيام.',
  tpl_overdue:
    'أهلًا {parent}، اشتراك {player} في {academy} منتهي من {days} أيام ولسه داخل فترة السماح. ياريت التجديد في أقرب وقت عشان مايتوقفش تدريبه.'
};

try { db.exec('ALTER TABLE players ADD COLUMN squad TEXT'); } catch (e) {}

const PLANS = {
  '1': { months: 1, label: 'شهري', amount: 700 },
  '3': { months: 3, label: '3 شهور', amount: 1890 },
  '6': { months: 6, label: '6 شهور', amount: 3570 },
  '12': { months: 12, label: 'سنوي', amount: 6720 }
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key) {
  const row = getSettingStmt.get(key);
  if (row) return row.value;
  return DEFAULTS[key] !== undefined ? DEFAULTS[key] : null;
}
function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}
function getSettingInt(key, fallback) {
  const v = parseInt(getSetting(key), 10);
  return Number.isFinite(v) ? v : fallback;
}

// --- date helpers (Africa/Cairo) ---
function todayCairo() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const dt = parseDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmtDate(dt);
}
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  // clamp overflow (e.g. Jan 31 + 1 month)
  if (dt.getUTCDate() !== d) dt.setUTCDate(0);
  return fmtDate(dt);
}
function diffDays(from, to) {
  // whole days from `from` to `to` (to - from)
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

// --- domain helpers ---
const currentSubStmt = db.prepare(
  'SELECT * FROM subscriptions WHERE player_id = ? ORDER BY end_date DESC, id DESC LIMIT 1'
);
function currentSub(playerId) {
  return currentSubStmt.get(playerId) || null;
}

// Returns {state: 'active'|'grace'|'expired'|'none', daysLeft}
function subState(sub, today) {
  if (!sub) return { state: 'none', daysLeft: null };
  today = today || todayCairo();
  const grace = getSettingInt('grace_days', 7);
  const daysLeft = diffDays(today, sub.end_date);
  if (daysLeft >= 0) return { state: 'active', daysLeft };
  if (daysLeft >= -grace) return { state: 'grace', daysLeft };
  return { state: 'expired', daysLeft };
}

function normalizePhone(p) {
  if (!p) return null;
  let digits = String(p).replace(/\D/g, '');
  if (digits.startsWith('0020')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = '20' + digits.slice(1);
  if (digits.length === 10 && digits.startsWith('1')) digits = '20' + digits;
  return digits;
}

module.exports = {
  db,
  PLANS,
  DEFAULTS,
  getSetting,
  setSetting,
  getSettingInt,
  todayCairo,
  addDays,
  addMonths,
  diffDays,
  currentSub,
  subState,
  normalizePhone
};
