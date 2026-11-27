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
CREATE TABLE IF NOT EXISTS subscription_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  variable INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES subscription_items(id),
  label TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contact_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'أخرى',
  note TEXT,
  staff_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  commitment INTEGER,
  skill INTEGER,
  fitness INTEGER,
  behavior INTEGER,
  notes TEXT,
  coach_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(player_id, month)
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  details TEXT,
  event_date TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// أعمدة بتتضاف بالترقية من غير كسر القواعد القديمة
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
}
ensureColumn('players', 'membership_no', 'membership_no TEXT'); // رقم عضوية نادي المستقبل
ensureColumn('subscriptions', 'kind', "kind TEXT NOT NULL DEFAULT 'academy'"); // academy | mustaqbal

const DEFAULTS = {
  training_days: '[0,2,4]', // Sunday, Tuesday, Thursday
  grace_days: '7',
  plan_1_price: '700',
  plan_3_price: '1890',
  plan_6_price: '3570',
  plan_12_price: '6720',
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
    'أهلًا {parent}، اشتراك {player} في {academy} منتهي من {days} أيام ولسه داخل فترة السماح. ياريت التجديد في أقرب وقت عشان مايتوقفش تدريبه.',
  tpl_birthday:
    'أهلًا {parent}، كل سنة و{player} طيب 🎂🎈 عيد ميلاد سعيد من كل فريق {academy}، ونتمناله سنة مليانة نجاح وأهداف ⚽'
};

try { db.exec('ALTER TABLE players ADD COLUMN squad TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE players ADD COLUMN birth_date TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE staff ADD COLUMN user_id INTEGER'); } catch (e) {}
try { db.exec('ALTER TABLE staff_attendance ADD COLUMN late_minutes INTEGER NOT NULL DEFAULT 0'); } catch (e) {}

// بنود الاشتراك الإضافية (الأسعار بتتعدل من الإعدادات من غير كود)
const seedItems = db.prepare(
  'INSERT OR IGNORE INTO subscription_items (item_key, label, amount, variable, sort) VALUES (?,?,?,?,?)'
);
[
  ['kit', 'اشتراك الزي', 490, 0, 1],
  ['winter', 'اشتراك طقم شتوي', 550, 0, 2],
  ['league', 'اشتراك دوري', 1500, 0, 3],
  ['trip', 'اشتراك سفرية', 0, 1, 4],
  ['fitness', 'اشتراك فتنس', 400, 0, 5],
  ['private', 'اشتراك برايفت', 2000, 0, 6]
].forEach((r) => seedItems.run(...r));

const PLANS = {
  '1': { months: 1, label: 'شهري', amount: 700 },
  '3': { months: 3, label: '3 شهور', amount: 1890 },
  '6': { months: 6, label: '6 شهور', amount: 3570 },
  '12': { months: 12, label: 'سنوي', amount: 6720 }
};

// أسعار الخطط بتتعدل من الإعدادات (settings plan_X_price) مع الرجوع للقيم الافتراضية
function getPlans() {
  const out = {};
  Object.entries(PLANS).forEach(([k, v]) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('plan_' + k + '_price');
    const n = row ? parseInt(row.value, 10) : NaN;
    out[k] = { months: v.months, label: v.label, amount: Number.isFinite(n) ? n : v.amount };
  });
  return out;
}

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
  getPlans,
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
