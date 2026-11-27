// Auth: users, scrypt password hashing, SQLite-backed sessions, middleware.
const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

try { db.exec('ALTER TABLE users ADD COLUMN squad TEXT'); } catch (e) {}

const SESSION_COOKIE = 'ua_session';
const SESSION_TTL_DAYS = 30;

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function createUser(username, password, role, squad) {
  const info = db
    .prepare('INSERT INTO users (username, pass_hash, role, squad) VALUES (?,?,?,?)')
    .run(String(username).trim(), hashPassword(password), role || 'staff', squad || null);
  return info.lastInsertRowid;
}

function ensureAdmin() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'admin'").get().n;
  if (n === 0) {
    createUser('admin', process.env.ADMIN_PASSWORD || 'united2026', 'admin');
    console.log('Created default admin user (username: admin).');
  }
}

// Rate limit للدخول: 10 محاولات غلط كحد أقصى لكل اسم مستخدم، وبعدها قفل مؤقت ساعة.
// عداد في الذاكرة (بيتراجع مع ريستارت السيرفر) - بيترصفّر عند أول دخول ناجح.
const LOGIN_MAX_FAILS = 10;
const LOGIN_LOCK_MINUTES = 60;
const loginFails = new Map(); // username -> { fails, lockedUntil }

function loginLockRemainingMs(username) {
  const rec = loginFails.get(String(username || '').trim().toLowerCase());
  if (!rec || !rec.lockedUntil) return 0;
  const left = rec.lockedUntil - Date.now();
  if (left <= 0) { loginFails.delete(String(username || '').trim().toLowerCase()); return 0; }
  return left;
}

function recordLoginFail(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return;
  const rec = loginFails.get(key) || { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= LOGIN_MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60000;
    rec.fails = 0;
  }
  loginFails.set(key, rec);
}

function clearLoginFails(username) {
  loginFails.delete(String(username || '').trim().toLowerCase());
}

function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !verifyPassword(password || '', u.pass_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
  return { token, user: { id: u.id, username: u.username, role: u.role, squad: u.squad } };
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userForToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.squad, s.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  const ageDays = (Date.now() - new Date(row.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000;
  if (ageDays > SESSION_TTL_DAYS) {
    logout(token);
    return null;
  }
  return { id: row.id, username: row.username, role: row.role, squad: row.squad };
}

function cookieToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return v.join('=');
  }
  return null;
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_TTL_DAYS * 86400;
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  );
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Express middleware: everything under /api requires login except /api/login.
function requireAuth(req, res, next) {
  const user = userForToken(cookieToken(req));
  if (!user) return res.status(401).json({ error: 'سجل الدخول الأول' });
  req.user = user;
  next();
}

module.exports = {
  ensureAdmin,
  createUser,
  login,
  logout,
  userForToken,
  cookieToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  hashPassword,
  verifyPassword,
  loginLockRemainingMs,
  recordLoginFail,
  clearLoginFails
};
