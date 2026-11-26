// United Academy management app - API + static frontend.
const express = require('express');
const path = require('path');
const {
  db,
  getSetting,
  setSetting,
  getSettingInt,
  todayCairo,
  addMonths,
  currentSub,
  subState,
  DEFAULTS
} = require('./db');
const automation = require('./automation');
const { seedIfEmpty } = require('./seed');
const auth = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

seedIfEmpty();
auth.ensureAdmin();
automation.runDaily(); // renewal drafts on boot; still drafts, nothing sent

// ---------- auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const r = auth.login(username, password);
  if (!r) return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غلط' });
  auth.setSessionCookie(res, r.token);
  res.json({ ok: true, user: r.user });
});
app.post('/api/logout', (req, res) => {
  auth.logout(auth.cookieToken(req));
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const user = auth.userForToken(auth.cookieToken(req));
  if (!user) return res.status(401).json({ error: 'سجل الدخول الأول' });
  res.json(user);
});

// everything below requires a logged-in user
app.use('/api', auth.requireAuth);

const asyncWrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
};

function decoratePlayer(p, today) {
  const sub = currentSub(p.id);
  const st = subState(sub, today);
  return Object.assign({}, p, {
    subscription: sub,
    sub_state: st.state,
    days_left: st.daysLeft
  });
}

// ---------- dashboard ----------
app.get('/api/dashboard', asyncWrap((req, res) => {
  const today = todayCairo();
  const players = db.prepare(`SELECT * FROM players WHERE status='active'`).all();
  const decorated = players.map((p) => decoratePlayer(p, today));
  const activeSubs = decorated.filter((p) => p.sub_state === 'active' || p.sub_state === 'grace');
  const renewals = decorated
    .filter((p) => p.days_left !== null && p.days_left <= 7)
    .sort((a, b) => a.days_left - b.days_left);
  const monthStart = today.slice(0, 8) + '01';
  const collected = db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM subscriptions WHERE start_date >= ?`)
    .get(monthStart);
  const att = db
    .prepare(`SELECT COUNT(*) AS present FROM attendance WHERE date = ? AND present = 1`)
    .get(today);
  const drafts = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE status='draft'`).get();
  res.json({
    today,
    is_training_day: JSON.parse(getSetting('training_days')).includes(new Date(today + 'T12:00:00Z').getUTCDay()),
    players_total: players.length,
    subs_active: activeSubs.length,
    renewals_due: renewals.map((p) => ({
      id: p.id, name: p.name, days_left: p.days_left, sub_state: p.sub_state,
      end_date: p.subscription.end_date
    })),
    collected_month: collected.total,
    payments_month: collected.n,
    present_today: att.present,
    draft_messages: drafts.n
  });
}));

// ---------- players ----------
app.get('/api/players', asyncWrap((req, res) => {
  const today = todayCairo();
  const q = (req.query.search || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(
      `SELECT * FROM players WHERE name LIKE ? OR parent_name LIKE ? OR parent_phone LIKE ? ORDER BY name`
    ).all(`%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare(`SELECT * FROM players ORDER BY name`).all();
  }
  res.json(rows.map((p) => decoratePlayer(p, today)));
}));

app.post('/api/players', asyncWrap((req, res) => {
  const { name, parent_name, parent_phone, age_group, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'اسم اللاعب مطلوب' });
  const info = db.prepare(
    `INSERT INTO players (name, parent_name, parent_phone, age_group, notes) VALUES (?,?,?,?,?)`
  ).run(String(name).trim(), parent_name || null, parent_phone || null, age_group || null, notes || null);
  res.status(201).json(decoratePlayer(db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid), todayCairo()));
}));

app.get('/api/players/:id', asyncWrap((req, res) => {
  const today = todayCairo();
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const subs = db.prepare('SELECT * FROM subscriptions WHERE player_id = ? ORDER BY start_date DESC, id DESC').all(p.id);
  const attendance = db.prepare('SELECT * FROM attendance WHERE player_id = ? ORDER BY date DESC LIMIT 30').all(p.id);
  const messages = db.prepare('SELECT * FROM messages WHERE player_id = ? ORDER BY id DESC LIMIT 30').all(p.id);
  res.json(Object.assign(decoratePlayer(p, today), { subscriptions: subs, attendance, messages }));
}));

app.put('/api/players/:id', asyncWrap((req, res) => {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const { name, parent_name, parent_phone, age_group, notes, status } = req.body || {};
  db.prepare(
    `UPDATE players SET name=?, parent_name=?, parent_phone=?, age_group=?, notes=?, status=? WHERE id=?`
  ).run(
    name !== undefined ? name : p.name,
    parent_name !== undefined ? parent_name : p.parent_name,
    parent_phone !== undefined ? parent_phone : p.parent_phone,
    age_group !== undefined ? age_group : p.age_group,
    notes !== undefined ? notes : p.notes,
    status !== undefined ? status : p.status,
    p.id
  );
  res.json(decoratePlayer(db.prepare('SELECT * FROM players WHERE id=?').get(p.id), todayCairo()));
}));

// ---------- subscriptions ----------
app.post('/api/players/:id/subscriptions', asyncWrap((req, res) => {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const today = todayCairo();
  const start = (req.body && req.body.start_date) || today;
  const months = parseInt((req.body && req.body.months) || getSetting('sub_months'), 10) || 1;
  const amount = Number((req.body && req.body.amount !== undefined ? req.body.amount : getSetting('sub_amount'))) || 0;
  const end = addMonths(start, months);
  const info = db.prepare(
    `INSERT INTO subscriptions (player_id, start_date, months, amount, end_date) VALUES (?,?,?,?,?)`
  ).run(p.id, start, months, amount, end);
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(info.lastInsertRowid);
  automation.confirmationDraft(p.id, sub); // draft only - human sends it
  res.status(201).json(sub);
}));

// ---------- attendance ----------
app.get('/api/attendance', asyncWrap((req, res) => {
  const today = todayCairo();
  const date = req.query.date || today;
  const players = db.prepare(`SELECT * FROM players WHERE status='active' ORDER BY name`).all();
  const rows = db.prepare('SELECT player_id, present FROM attendance WHERE date = ?').all(date);
  const byPlayer = {};
  rows.forEach((r) => (byPlayer[r.player_id] = r.present));
  res.json({
    date,
    is_training_day: JSON.parse(getSetting('training_days')).includes(new Date(date + 'T12:00:00Z').getUTCDay()),
    players: players.map((p) => {
      const d = decoratePlayer(p, today);
      return {
        id: p.id, name: p.name, age_group: p.age_group,
        sub_state: d.sub_state,
        present: byPlayer[p.id] !== undefined ? !!byPlayer[p.id] : null
      };
    })
  });
}));

app.post('/api/attendance', asyncWrap((req, res) => {
  const { player_id, date, present } = req.body || {};
  if (!player_id || !date) return res.status(400).json({ error: 'player_id و date مطلوبين' });
  db.prepare(
    `INSERT INTO attendance (player_id, date, present) VALUES (?,?,?)
     ON CONFLICT(player_id, date) DO UPDATE SET present = excluded.present`
  ).run(player_id, date, present ? 1 : 0);
  res.json({ ok: true });
}));

// Close a training day: create absence drafts for everyone not marked present.
app.post('/api/attendance/close', asyncWrap((req, res) => {
  const date = (req.body && req.body.date) || todayCairo();
  const created = automation.absenceDrafts(date);
  res.json({ date, absence_drafts_created: created });
}));

// ---------- messages ----------
app.get('/api/messages', asyncWrap((req, res) => {
  const status = req.query.status || 'draft';
  const rows = db.prepare(
    `SELECT m.*, p.name AS player_name, p.parent_name, p.parent_phone
     FROM messages m JOIN players p ON p.id = m.player_id
     WHERE m.status = ? ORDER BY m.id DESC LIMIT 200`
  ).all(status);
  res.json(rows.map((m) => Object.assign({}, m, { wa_link: automation.waLink(m, m.body) })));
}));

app.post('/api/messages/generate', asyncWrap((req, res) => {
  const r = automation.runDaily();
  res.json(r);
}));

app.post('/api/messages/:id/sent', asyncWrap((req, res) => {
  const info = db.prepare(
    `UPDATE messages SET status='sent', sent_at=datetime('now') WHERE id=?`
  ).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'الرسالة غير موجودة' });
  res.json({ ok: true });
}));

app.post('/api/messages/:id/dismiss', asyncWrap((req, res) => {
  const info = db.prepare(`UPDATE messages SET status='dismissed' WHERE id=?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'الرسالة غير موجودة' });
  res.json({ ok: true });
}));

// ---------- users ----------
app.get('/api/users', asyncWrap((req, res) => {
  res.json(db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all());
}));
app.post('/api/users', asyncWrap((req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'للمدير فقط' });
  const { username, password, role } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'كلمة السر لازم 6 حروف على الأقل' });
  try {
    const id = auth.createUser(username, password, role === 'admin' ? 'admin' : 'staff');
    res.status(201).json({ id });
  } catch (e) {
    res.status(400).json({ error: 'اسم المستخدم ده موجود قبل كده' });
  }
}));
app.post('/api/password', asyncWrap((req, res) => {
  const { current_password, new_password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u || !auth.verifyPassword(current_password || '', u.pass_hash)) {
    return res.status(400).json({ error: 'كلمة السر الحالية غلط' });
  }
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: 'كلمة السر الجديدة لازم 6 حروف على الأقل' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(new_password), u.id);
  res.json({ ok: true });
}));

// ---------- settings ----------
app.get('/api/settings', asyncWrap((req, res) => {
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => (out[k] = getSetting(k)));
  res.json(out);
}));

app.put('/api/settings', asyncWrap((req, res) => {
  const body = req.body || {};
  Object.keys(DEFAULTS).forEach((k) => {
    if (body[k] !== undefined) setSetting(k, typeof body[k] === 'string' ? body[k] : JSON.stringify(body[k]));
  });
  res.json({ ok: true });
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`United Academy app running: http://localhost:${PORT}`));
