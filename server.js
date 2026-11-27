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
  addDays,
  diffDays,
  currentSub,
  subState,
  DEFAULTS,
  PLANS
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

function requireFull(req, res) {
  if (req.user.role === 'admin' || req.user.role === 'manager') return true;
  res.status(403).json({ error: 'مش مسموح' });
  return false;
}
function coachSquad(req) {
  return req.user.role === 'coach' ? (req.user.squad || '\\u2063none') : null;
}

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
  const squad = coachSquad(req);
  const players = squad
    ? db.prepare(`SELECT * FROM players WHERE status='active' AND squad = ?`).all(squad)
    : db.prepare(`SELECT * FROM players WHERE status='active'`).all();
  const decorated = players.map((p) => decoratePlayer(p, today));
  const activeSubs = decorated.filter((p) => p.sub_state === 'active' || p.sub_state === 'grace');
  const renewals = decorated
    .filter((p) => p.days_left !== null && p.days_left <= 7)
    .sort((a, b) => a.days_left - b.days_left);
  const monthStart = today.slice(0, 8) + '01';
  const collected = db
    .prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM subscriptions WHERE start_date >= ?`)
    .get(monthStart);
  const att = squad
    ? db.prepare(`SELECT COUNT(*) AS present FROM attendance a JOIN players p ON p.id=a.player_id WHERE a.date = ? AND a.present = 1 AND p.squad = ?`).get(today, squad)
    : db.prepare(`SELECT COUNT(*) AS present FROM attendance WHERE date = ? AND present = 1`).get(today);
  const absentToday = squad
    ? db.prepare(`SELECT COUNT(*) AS n FROM attendance a JOIN players p ON p.id=a.player_id WHERE a.date = ? AND a.present = 0 AND p.squad = ?`).get(today, squad).n
    : db.prepare(`SELECT COUNT(*) AS n FROM attendance WHERE date = ? AND present = 0`).get(today).n;
  const drafts = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE status='draft'`).get();
  const isCoach = req.user.role === 'coach';
  // Dropout counts (admin/manager): last recorded presence 14+ days ago.
  let dropoutMonth = 0;
  let dropoutYear = 0;
  if (!isCoach) {
    const lastRows = db.prepare(
      `SELECT p.id, MAX(a.date) AS last_present FROM players p
       JOIN attendance a ON a.player_id = p.id AND a.present = 1
       WHERE p.status = 'active' GROUP BY p.id`
    ).all();
    lastRows.forEach((r) => {
      const since = diffDays(r.last_present, today);
      if (since >= 14 && since <= 90) { // المنقطع: غايب من أسبوعين لـ 3 شهور
        dropoutYear++;
        if (since <= 30) dropoutMonth++;
      }
    });
  }
  // Per-squad attendance breakdown for today (who saved what).
  const squadRows = squad ? [] : db.prepare(
    `SELECT p.squad,
            SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.present = 0 THEN 1 ELSE 0 END) AS absent
     FROM attendance a JOIN players p ON p.id = a.player_id
     WHERE a.date = ? GROUP BY p.squad ORDER BY p.squad`
  ).all(today);
  const staffBySquad = {};
  const squadTotals = {};
  if (!squad) {
    db.prepare(`SELECT name, squad FROM staff WHERE squad IS NOT NULL AND (role LIKE '%مدرب%' OR role LIKE '%حراس%')`).all()
      .forEach((c) => { (staffBySquad[c.squad] = staffBySquad[c.squad] || []).push(c.name); });
    db.prepare(`SELECT squad, COUNT(*) AS n FROM players WHERE status='active' GROUP BY squad`).all()
      .forEach((r) => (squadTotals[r.squad] = r.n));
  }
  // At-risk subscriptions (admin/manager): expiring/expired subs and heavy recent absences.
  let atRisk = [];
  if (!isCoach) {
    const tdaysSet = JSON.parse(getSetting('training_days'));
    const lastTrainingDays = [];
    for (let i = 0; lastTrainingDays.length < 6 && i < 30; i++) {
      const d = addDays(today, -i);
      if (tdaysSet.includes(new Date(d + 'T12:00:00Z').getUTCDay())) lastTrainingDays.push(d);
    }
    const ph = lastTrainingDays.map(() => '?').join(',');
    const absRows = db.prepare(
      `SELECT player_id, COUNT(*) AS n FROM attendance WHERE present = 0 AND date IN (${ph}) GROUP BY player_id`
    ).all(...lastTrainingDays);
    const absMap = {};
    absRows.forEach((r) => { absMap[r.player_id] = r.n; });
    atRisk = decorated.map((p) => {
      const reasons = [];
      const abs = absMap[p.id] || 0;
      if (p.sub_state === 'expired') reasons.push(`اشتراكه منتهي من ${-p.days_left} يوم وماجددش`);
      else if (p.sub_state === 'grace') reasons.push('اشتراكه خلص ولسه في فترة السماح');
      if (abs >= 3) reasons.push(`غاب ${abs} من آخر ${lastTrainingDays.length} تمرينات`);
      else if (abs >= 2 && p.days_left !== null && p.days_left <= 7) reasons.push('اشتراكه قرب يخلص وغيابه كتير');
      return { id: p.id, name: p.name, squad: p.squad, parent_phone: p.parent_phone, reasons };
    }).filter((p) => p.reasons.length > 0)
      .sort((a, b) => b.reasons.length - a.reasons.length)
      .slice(0, 50);
  }
  // Players with a birthday in the coming 7 days (coaches see their own squad only).
  let birthdaysWeek = [];
  {
    const window7 = [];
    for (let i = 0; i < 8; i++) window7.push(addDays(today, i).slice(5)); // MM-DD list
    birthdaysWeek = decorated
      .filter((p) => p.birth_date && window7.includes(p.birth_date.slice(5)))
      .map((p) => {
        const md = p.birth_date.slice(5);
        const turnYear = Number(today.slice(0, 4)) + (md < today.slice(5) ? 1 : 0);
        return {
          id: p.id,
          name: p.name,
          squad: p.squad,
          birth_date: p.birth_date,
          turns: turnYear - Number(p.birth_date.slice(0, 4)),
          date_this_year: turnYear + '-' + md
        };
      })
      .sort((a, b) => a.birth_date.slice(5).localeCompare(b.birth_date.slice(5)));
  }
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 10').all();
  res.json({
    today,
    at_risk: atRisk,
    birthdays_week: birthdaysWeek,
    announcements,
    is_training_day: JSON.parse(getSetting('training_days')).includes(new Date(today + 'T12:00:00Z').getUTCDay()),
    players_total: players.length,
    subs_active: isCoach ? null : activeSubs.length,
    renewals_due: isCoach ? [] : renewals.map((p) => ({
      id: p.id, name: p.name, days_left: p.days_left, sub_state: p.sub_state,
      end_date: p.subscription.end_date
    })),
    collected_month: isCoach ? null : collected.total,
    payments_month: isCoach ? null : collected.n,
    present_today: att.present,
    absent_today: absentToday,
    dropout_month: isCoach ? null : dropoutMonth,
    dropout_year: isCoach ? null : dropoutYear,
    squad_attendance: Object.keys(squadTotals).sort().map((sq) => {
      const r = squadRows.find((x) => x.squad === sq);
      return {
        squad: sq,
        present: r ? r.present : 0,
        absent: r ? r.absent : 0,
        total: squadTotals[sq] || 0,
        coaches: staffBySquad[sq] || []
      };
    }),
    draft_messages: isCoach ? null : drafts.n
  });
}));

// ---------- players ----------
app.get('/api/players', asyncWrap((req, res) => {
  const today = todayCairo();
  const q = (req.query.search || '').trim();
  const squad = coachSquad(req);
  let rows;
  if (squad) {
    if (q) {
      rows = db.prepare(`SELECT * FROM players WHERE squad = ? AND (name LIKE ? OR parent_name LIKE ? OR parent_phone LIKE ?) ORDER BY name`).all(squad, `%${q}%`, `%${q}%`, `%${q}%`);
    } else {
      rows = db.prepare(`SELECT * FROM players WHERE squad = ? ORDER BY name`).all(squad);
    }
  } else if (q) {
    rows = db.prepare(
      `SELECT * FROM players WHERE name LIKE ? OR parent_name LIKE ? OR parent_phone LIKE ? ORDER BY name`
    ).all(`%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare(`SELECT * FROM players ORDER BY name`).all();
  }
  res.json(rows.map((p) => decoratePlayer(p, today)));
}));

app.post('/api/players', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const { name, parent_name, parent_phone, age_group, notes, birth_date, squad } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'اسم اللاعب مطلوب' });
  const info = db.prepare(
    `INSERT INTO players (name, parent_name, parent_phone, age_group, notes, birth_date, squad) VALUES (?,?,?,?,?,?,?)`
  ).run(String(name).trim(), parent_name || null, parent_phone || null, age_group || null, notes || null,
    /^\d{4}-\d{2}-\d{2}$/.test(String(birth_date || '')) ? birth_date : null, squad || null);
  res.status(201).json(decoratePlayer(db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid), todayCairo()));
}));

app.get('/api/players/:id', asyncWrap((req, res) => {
  const today = todayCairo();
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const squad = coachSquad(req);
  if (squad && p.squad !== squad) return res.status(403).json({ error: 'مش من مجموعتك' });
  const isCoach = req.user.role === 'coach';
  let subs = db.prepare('SELECT * FROM subscriptions WHERE player_id = ? ORDER BY start_date DESC, id DESC').all(p.id);
  if (isCoach) subs = subs.map((s) => Object.assign({}, s, { amount: null })); // المبالغ للإدارة بس
  const attendance = db.prepare('SELECT * FROM attendance WHERE player_id = ? ORDER BY date DESC LIMIT 30').all(p.id);
  const messages = db.prepare('SELECT * FROM messages WHERE player_id = ? ORDER BY id DESC LIMIT 30').all(p.id);
  const contact_log = db.prepare('SELECT * FROM contact_log WHERE player_id = ? ORDER BY id DESC LIMIT 50').all(p.id);
  const evaluations = db.prepare('SELECT * FROM evaluations WHERE player_id = ? ORDER BY month DESC LIMIT 12').all(p.id);
  const out = Object.assign(decoratePlayer(p, today), { subscriptions: subs, attendance, messages, contact_log, evaluations });
  if (isCoach && out.subscription) out.subscription = Object.assign({}, out.subscription, { amount: null });
  res.json(out);
}));

// Monthly player evaluation (upsert): full roles for any player, coach for his squad only.
app.post('/api/players/:id/evaluation', asyncWrap((req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({ error: 'مش مسموح' });
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const squad = coachSquad(req);
  if (squad && p.squad !== squad) return res.status(403).json({ error: 'مش من مجموعتك' });
  const month = /^\d{4}-\d{2}$/.test(String((req.body && req.body.month) || ''))
    ? req.body.month : todayCairo().slice(0, 7);
  const score = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
  const commitment = score(req.body && req.body.commitment);
  const skill = score(req.body && req.body.skill);
  const fitness = score(req.body && req.body.fitness);
  const behavior = score(req.body && req.body.behavior);
  const notes = String((req.body && req.body.notes) || '').trim().slice(0, 500);
  if ([commitment, skill, fitness, behavior].every((v) => v === null) && !notes) {
    return res.status(400).json({ error: 'حط تقييم واحد على الأقل' });
  }
  const staffRow = db.prepare('SELECT name FROM staff WHERE user_id = ?').get(req.user.id);
  const coachName = staffRow ? staffRow.name : req.user.username;
  db.prepare(
    `INSERT INTO evaluations (player_id, month, commitment, skill, fitness, behavior, notes, coach_name)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(player_id, month) DO UPDATE SET
       commitment=excluded.commitment, skill=excluded.skill, fitness=excluded.fitness,
       behavior=excluded.behavior, notes=excluded.notes, coach_name=excluded.coach_name, created_at=datetime('now')`
  ).run(p.id, month, commitment, skill, fitness, behavior, notes, coachName);
  res.json(db.prepare('SELECT * FROM evaluations WHERE player_id=? AND month=?').get(p.id, month));
}));

// Parent contact log: full roles for any player, coach for his squad only.
app.post('/api/players/:id/contact', asyncWrap((req, res) => {
  if (req.user.role === 'staff') return res.status(403).json({ error: 'مش مسموح' });
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const squad = coachSquad(req);
  if (squad && p.squad !== squad) return res.status(403).json({ error: 'مش من مجموعتك' });
  const type = String((req.body && req.body.type) || 'أخرى').slice(0, 30);
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
  if (!note) return res.status(400).json({ error: 'اكتب ملاحظة التواصل' });
  const staffRow = db.prepare('SELECT name FROM staff WHERE user_id = ?').get(req.user.id);
  const staffName = staffRow ? staffRow.name : req.user.username;
  const info = db.prepare(
    'INSERT INTO contact_log (player_id, type, note, staff_name) VALUES (?,?,?,?)'
  ).run(p.id, type, note, staffName);
  res.status(201).json(db.prepare('SELECT * FROM contact_log WHERE id=?').get(info.lastInsertRowid));
}));

app.put('/api/players/:id', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const { name, parent_name, parent_phone, age_group, notes, status, birth_date } = req.body || {};
  db.prepare(
    `UPDATE players SET name=?, parent_name=?, parent_phone=?, age_group=?, notes=?, status=?, birth_date=? WHERE id=?`
  ).run(
    name !== undefined ? name : p.name,
    parent_name !== undefined ? parent_name : p.parent_name,
    parent_phone !== undefined ? parent_phone : p.parent_phone,
    age_group !== undefined ? age_group : p.age_group,
    notes !== undefined ? notes : p.notes,
    status !== undefined ? status : p.status,
    birth_date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(String(birth_date)) ? birth_date : null) : p.birth_date,
    p.id
  );
  res.json(decoratePlayer(db.prepare('SELECT * FROM players WHERE id=?').get(p.id), todayCairo()));
}));

// ---------- subscriptions ----------
app.get('/api/plans', asyncWrap((req, res) => res.json(PLANS)));
app.post('/api/players/:id/subscriptions', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  const today = todayCairo();
  const start = (req.body && req.body.start_date) || today;
  const planKey = req.body && req.body.plan;
  const plan = PLANS[String(planKey)];
  const months = plan ? plan.months : (parseInt((req.body && req.body.months) || getSetting('sub_months'), 10) || 1);
  const amount = plan ? plan.amount : (Number((req.body && req.body.amount !== undefined ? req.body.amount : getSetting('sub_amount'))) || 0);
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
  const squad = coachSquad(req);
  const players = squad
    ? db.prepare(`SELECT * FROM players WHERE status='active' AND squad = ? ORDER BY name`).all(squad)
    : db.prepare(`SELECT * FROM players WHERE status='active' ORDER BY name`).all();
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
  const squad = coachSquad(req);
  if (squad) {
    const p = db.prepare('SELECT squad FROM players WHERE id = ?').get(player_id);
    if (!p || p.squad !== squad) return res.status(403).json({ error: 'مش من مجموعتك' });
  }
  if (present === null) {
    db.prepare('DELETE FROM attendance WHERE player_id = ? AND date = ?').run(player_id, date);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(
    `INSERT INTO attendance (player_id, date, present) VALUES (?,?,?)
     ON CONFLICT(player_id, date) DO UPDATE SET present = excluded.present`
  ).run(player_id, date, present ? 1 : 0);
  res.json({ ok: true });
}));

// Bulk save attendance marks for a date (coach flow: mark all, confirm, save the day).
app.post('/api/attendance/bulk', asyncWrap((req, res) => {
  const { date, marks } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'التاريخ مطلوب' });
  if (!Array.isArray(marks)) return res.status(400).json({ error: 'marks مطلوبة' });
  const squad = coachSquad(req);
  const squadStmt = db.prepare('SELECT squad FROM players WHERE id = ?');
  const upsert = db.prepare(
    `INSERT INTO attendance (player_id, date, present) VALUES (?,?,?)
     ON CONFLICT(player_id, date) DO UPDATE SET present = excluded.present`
  );
  const del = db.prepare('DELETE FROM attendance WHERE player_id = ? AND date = ?');
  let saved = 0;
  let presentCount = 0;
  let absentCount = 0;
  db.transaction(() => {
    for (const mk of marks.slice(0, 500)) {
      const pid = parseInt(mk.player_id, 10);
      if (!Number.isFinite(pid)) continue;
      if (squad) {
        const p = squadStmt.get(pid);
        if (!p || p.squad !== squad) continue;
      }
      if (mk.present === null) {
        del.run(pid, date);
      } else {
        upsert.run(pid, date, mk.present ? 1 : 0);
        if (mk.present) presentCount++; else absentCount++;
      }
      saved++;
    }
  })();
  res.json({ ok: true, saved, present: presentCount, absent: absentCount });
}));

// Monthly attendance summary: training days with per-day counts, per-player days, absentees list.
app.get('/api/attendance/month', asyncWrap((req, res) => {
  const today = todayCairo();
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today.slice(0, 7);
  const trainingDays = JSON.parse(getSetting('training_days'));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const squad = coachSquad(req);
  const params = squad ? [month + '-01', lastDay, squad] : [month + '-01', lastDay];
  const attRows = db.prepare(
    `SELECT a.date, a.player_id, a.present FROM attendance a JOIN players p ON p.id = a.player_id
     WHERE a.date >= ? AND a.date <= ? ${squad ? 'AND p.squad = ?' : ''}`
  ).all(...params);
  const players = squad
    ? db.prepare(`SELECT * FROM players WHERE status='active' AND squad = ? ORDER BY name`).all(squad)
    : db.prepare(`SELECT * FROM players WHERE status='active' ORDER BY name`).all();
  const byDate = {};
  const byPlayer = {};
  attRows.forEach((r) => {
    byDate[r.date] = byDate[r.date] || { present: 0, absent: 0 };
    byDate[r.date][r.present ? 'present' : 'absent']++;
    byPlayer[r.player_id] = byPlayer[r.player_id] || { present_days: 0, absent_days: 0 };
    byPlayer[r.player_id][r.present ? 'present_days' : 'absent_days']++;
  });
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const wd = new Date(ds + 'T12:00:00Z').getUTCDay();
    if (!trainingDays.includes(wd)) continue;
    const c = byDate[ds];
    days.push({
      date: ds,
      weekday: wd,
      future: ds > today,
      recorded: !!c,
      present: c ? c.present : 0,
      absent: c ? c.absent : 0
    });
  }
  const playerInfo = {};
  players.forEach((p) => (playerInfo[p.id] = p));
  const perPlayer = players.map((p) => {
    const c = byPlayer[p.id] || { present_days: 0, absent_days: 0 };
    return { id: p.id, name: p.name, present_days: c.present_days, absent_days: c.absent_days };
  });
  // Dropouts: active players whose last recorded presence is >= 14 days ago.
  // "month" = last presence 14-30 days ago; "year" (the headline count) = 14-90 days (3 months), includes month.
  const lastRows = db.prepare(
    `SELECT p.id, MAX(a.date) AS last_present FROM players p
     JOIN attendance a ON a.player_id = p.id AND a.present = 1
     WHERE p.status = 'active' ${squad ? 'AND p.squad = ?' : ''} GROUP BY p.id`
  ).all(...(squad ? [squad] : []));
  let dropoutMonth = 0;
  let dropoutYear = 0;
  const dropoutDetail = [];
  lastRows.forEach((r) => {
    const since = diffDays(r.last_present, today);
    if (since >= 14 && since <= 90) { // المنقطع: غايب من أسبوعين لـ 3 شهور
      dropoutYear++;
      if (since <= 30) dropoutMonth++;
      const info = playerInfo[r.id] || {};
      dropoutDetail.push({
        id: r.id,
        name: info.name || '',
        birth_date: info.birth_date || null,
        parent_name: info.parent_name || null,
        parent_phone: info.parent_phone || null,
        squad: info.squad || null,
        last_present: r.last_present,
        since_days: since
      });
    }
  });
  dropoutDetail.sort((a, b) => b.since_days - a.since_days);
  res.json({
    month,
    training_days: days,
    players: perPlayer,
    absentees: perPlayer.filter((p) => p.absent_days > 0).sort((a, b) => b.absent_days - a.absent_days || a.name.localeCompare(b.name, 'ar')),
    top_attendees: perPlayer.filter((p) => p.present_days > 0).sort((a, b) => b.present_days - a.present_days || a.name.localeCompare(b.name, 'ar')).slice(0, 5),
    dropout_month: dropoutMonth,
    dropout_year: dropoutYear,
    dropouts: squad ? [] : dropoutDetail // التفاصيل للإدارة بس، المدرب يشوف الأعداد بس
  });
}));

// Close a training day: create absence drafts for everyone not marked present.
app.post('/api/attendance/close', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const date = (req.body && req.body.date) || todayCairo();
  const created = automation.absenceDrafts(date);
  res.json({ date, absence_drafts_created: created });
}));

// ---------- messages ----------
app.get('/api/messages', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const status = req.query.status || 'draft';
  const rows = db.prepare(
    `SELECT m.*, p.name AS player_name, p.parent_name, p.parent_phone
     FROM messages m JOIN players p ON p.id = m.player_id
     WHERE m.status = ? ORDER BY m.id DESC LIMIT 200`
  ).all(status);
  res.json(rows.map((m) => Object.assign({}, m, { wa_link: automation.waLink(m, m.body) })));
}));

app.post('/api/messages/generate', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const r = automation.runDaily();
  res.json(r);
}));

// Training announcements (e.g. session change/cancel): admin/manager create; everyone reads.
const ANN_KINDS = ['إلغاء تمرين', 'تغيير ميعاد', 'تغيير ملعب', 'مباراة ودية', 'تجمع', 'بطولة', 'أخرى'];
app.post('/api/announcements', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const kind = ANN_KINDS.includes(req.body && req.body.kind) ? req.body.kind : 'أخرى';
  const details = String((req.body && req.body.details) || '').trim().slice(0, 500);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String((req.body && req.body.event_date) || ''))
    ? req.body.event_date : null;
  if (!details) return res.status(400).json({ error: 'اكتب تفاصيل الإعلان' });
  const staffRow = db.prepare('SELECT name FROM staff WHERE user_id = ?').get(req.user.id);
  const by = staffRow ? staffRow.name : req.user.username;
  const r = db.prepare('INSERT INTO announcements (kind, details, event_date, created_by) VALUES (?,?,?,?)')
    .run(kind, details, eventDate, by);
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(r.lastInsertRowid));
}));

// Birthday greeting: creates a draft only - a human sends it from Messages.
app.post('/api/messages/birthday/:playerId', asyncWrap((req, res) => {
  // الإدارة لأي لاعب، والمدرب للاعبين مجموعته بس - المسودة بتتفتح في واتساب والإرسال يدوي
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.playerId);
  if (!p) return res.status(404).json({ error: 'اللاعب غير موجود' });
  if (req.user.role === 'staff') return res.status(403).json({ error: 'مش مسموح' });
  const squad = coachSquad(req);
  if (squad && p.squad !== squad) return res.status(403).json({ error: 'مش من مجموعتك' });
  const created = automation.birthdayDraft(p.id);
  const msg = db.prepare('SELECT body FROM messages WHERE dedupe_key = ?').get('bday:' + p.id + ':' + todayCairo().slice(0, 4));
  res.json({ ok: true, created, wa_link: msg ? automation.waLink(p, msg.body) : null });
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
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'للمدير فقط' });
  res.json(db.prepare('SELECT id, username, role, squad, created_at FROM users ORDER BY id').all());
}));
app.post('/api/users', asyncWrap((req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'للمدير فقط' });
  const { username, password, role, squad } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'كلمة السر لازم 6 حروف على الأقل' });
  try {
    const id = auth.createUser(username, password, ['admin','manager','coach','staff'].includes(role) ? role : 'staff', squad || null);
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
  if (!requireFull(req, res)) return;
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => (out[k] = getSetting(k)));
  res.json(out);
}));

app.put('/api/settings', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const body = req.body || {};
  Object.keys(DEFAULTS).forEach((k) => {
    if (body[k] !== undefined) setSetting(k, typeof body[k] === 'string' ? body[k] : JSON.stringify(body[k]));
  });
  res.json({ ok: true });
}));

// ---------- expenses & finance (full roles) ----------
app.get('/api/expenses', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const month = req.query.month; // YYYY-MM
  const year = req.query.year;
  let rows;
  if (month) rows = db.prepare(`SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC, id DESC`).all(month + '%');
  else if (year) rows = db.prepare(`SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC, id DESC`).all(year + '%');
  else rows = db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 200').all();
  res.json(rows);
}));
app.post('/api/expenses', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const { title, category, amount, date } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'بيان المصروف مطلوب' });
  const amt = Number(amount) || 0;
  if (amt <= 0) return res.status(400).json({ error: 'المبلغ لازم يكون أكبر من صفر' });
  const info = db.prepare('INSERT INTO expenses (title, category, amount, date) VALUES (?,?,?,?)')
    .run(String(title).trim(), category || 'أخرى', amt, date || todayCairo());
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id=?').get(info.lastInsertRowid));
}));
app.delete('/api/expenses/:id', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));
app.get('/api/finance', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const today = todayCairo();
  const monthStart = today.slice(0, 8) + '01';
  const yearStart = today.slice(0, 4) + '-01-01';
  const expMonth = db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE date >= ?').get(monthStart).t;
  const expYear = db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE date >= ?').get(yearStart).t;
  const revMonth = db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM subscriptions WHERE start_date >= ?').get(monthStart).t;
  const revYear = db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM subscriptions WHERE start_date >= ?').get(yearStart).t;
  res.json({
    month: today.slice(0, 7), year: today.slice(0, 4),
    expenses_month: expMonth, expenses_year: expYear,
    revenue_month: revMonth, revenue_year: revYear,
    net_month: revMonth - expMonth, net_year: revYear - expYear
  });
}));

// ---------- staff + staff attendance ----------
app.get('/api/staff', asyncWrap((req, res) => {
  const today = todayCairo();
  const date = req.query.date || today;
  const rows = db.prepare('SELECT * FROM staff ORDER BY id').all();
  const att = db.prepare('SELECT staff_id, status, late_minutes FROM staff_attendance WHERE date = ?').all(date);
  const byStaff = {};
  att.forEach((r) => (byStaff[r.staff_id] = { status: r.status, late_minutes: r.late_minutes || 0 }));
  res.json({ date, staff: rows.map((m) => Object.assign({}, m, byStaff[m.id] || { status: null, late_minutes: 0 })) });
}));
app.post('/api/staff', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const { name, role, squad } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'الاسم مطلوب' });
  const info = db.prepare('INSERT INTO staff (name, role, squad) VALUES (?,?,?)')
    .run(String(name).trim(), role || 'مدرب', squad || null);
  res.status(201).json(db.prepare('SELECT * FROM staff WHERE id=?').get(info.lastInsertRowid));
}));
app.put('/api/staff/:id', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const m = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'غير موجود' });
  const { name, role, squad } = req.body || {};
  db.prepare('UPDATE staff SET name=?, role=?, squad=? WHERE id=?')
    .run(name !== undefined ? name : m.name, role !== undefined ? role : m.role, squad !== undefined ? squad : m.squad, m.id);
  res.json(db.prepare('SELECT * FROM staff WHERE id=?').get(m.id));
}));
app.delete('/api/staff/:id', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/staff-attendance', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return; // الإدارة بس اللي تسجل وتعدّل حضور الجهاز
  const { staff_id, date, status, late_minutes } = req.body || {};
  if (!staff_id || !date) return res.status(400).json({ error: 'staff_id و date مطلوبين' });
  if (status === null) {
    db.prepare('DELETE FROM staff_attendance WHERE staff_id = ? AND date = ?').run(staff_id, date);
    return res.json({ ok: true, cleared: true });
  }
  if (!['present', 'absent', 'late'].includes(status)) return res.status(400).json({ error: 'الحالة: present أو absent أو late' });
  let mins = 0;
  if (status === 'late') {
    mins = parseInt(late_minutes, 10);
    if (!Number.isFinite(mins) || mins < 0) mins = 0;
    if (mins > 600) mins = 600;
  }
  db.prepare(
    `INSERT INTO staff_attendance (staff_id, date, status, late_minutes) VALUES (?,?,?,?)
     ON CONFLICT(staff_id, date) DO UPDATE SET status = excluded.status, late_minutes = excluded.late_minutes`
  ).run(staff_id, date, status, mins);
  res.json({ ok: true });
}));

// Monthly staff attendance summary (all staff): present/absent/late counts + total late minutes.
app.get('/api/staff/month', asyncWrap((req, res) => {
  const today = todayCairo();
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today.slice(0, 7);
  const monthStart = month + '-01';
  const monthEnd = month + '-31';
  const staff = db.prepare('SELECT id, name, role, squad FROM staff ORDER BY id').all();
  const rows = db.prepare(
    `SELECT staff_id, status, late_minutes FROM staff_attendance WHERE date >= ? AND date <= ?`
  ).all(monthStart, monthEnd);
  const byStaff = {};
  rows.forEach((r) => {
    const t = byStaff[r.staff_id] = byStaff[r.staff_id] || { present: 0, absent: 0, late: 0, late_minutes: 0 };
    t[r.status] = (t[r.status] || 0) + 1;
    if (r.status === 'late') t.late_minutes += r.late_minutes || 0;
  });
  res.json({
    month,
    staff: staff.map((s) => Object.assign({}, s, byStaff[s.id] || { present: 0, absent: 0, late: 0, late_minutes: 0 }))
  });
}));

// Coach's own attendance (view only): linked staff record, this month.
app.get('/api/my-attendance', asyncWrap((req, res) => {
  const me = db.prepare('SELECT id, name, role, squad FROM staff WHERE user_id = ?').get(req.user.id);
  if (!me) return res.json({ linked: false });
  const today = todayCairo();
  const monthStart = today.slice(0, 8) + '01';
  const rows = db.prepare(
    `SELECT date, status, late_minutes FROM staff_attendance WHERE staff_id = ? AND date >= ? ORDER BY date DESC`
  ).all(me.id, monthStart);
  const tot = { present: 0, absent: 0, late: 0, late_minutes: 0 };
  rows.forEach((r) => {
    tot[r.status] = (tot[r.status] || 0) + 1;
    if (r.status === 'late') tot.late_minutes += r.late_minutes || 0;
  });
  // Per-month totals for the whole current year (view-only summary).
  const yearStart = today.slice(0, 4) + '-01-01';
  const yearRows = db.prepare(
    `SELECT substr(date, 1, 7) AS ym,
            SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
            SUM(CASE WHEN status = 'late' THEN late_minutes ELSE 0 END) AS late_minutes
     FROM staff_attendance WHERE staff_id = ? AND date >= ? GROUP BY ym ORDER BY ym DESC`
  ).all(me.id, yearStart);
  res.json({ linked: true, name: me.name, month: today.slice(0, 7), totals: tot, rows, months: yearRows });
}));

// ---------- coaches overview (full roles) ----------
app.get('/api/coaches-overview', asyncWrap((req, res) => {
  if (!requireFull(req, res)) return;
  const today = todayCairo();
  const monthStart = today.slice(0, 8) + '01';
  const coaches = db.prepare(`SELECT * FROM staff WHERE role LIKE '%مدرب%' OR role LIKE '%حراس%' ORDER BY id`).all();
  res.json(coaches.map((c) => {
    const players = c.squad ? db.prepare(`SELECT COUNT(*) AS n FROM players WHERE status='active' AND squad = ?`).get(c.squad).n : 0;
    const att = c.squad ? db.prepare(
      `SELECT COUNT(*) AS n FROM attendance a JOIN players p ON p.id = a.player_id WHERE p.squad = ? AND a.date >= ?`
    ).get(c.squad, monthStart).n : 0;
    const staffAtt = db.prepare(
      `SELECT SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) AS absent, SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) AS late FROM staff_attendance WHERE staff_id = ? AND date >= ?`
    ).get(c.id, monthStart);
    const lateMins = db.prepare(
      `SELECT COALESCE(SUM(late_minutes),0) AS t FROM staff_attendance WHERE staff_id = ? AND date >= ? AND status = 'late'`
    ).get(c.id, monthStart).t;
    return { id: c.id, name: c.name, role: c.role, squad: c.squad, players_count: players, attendance_records_month: att, present_month: staffAtt.present || 0, absent_month: staffAtt.absent || 0, late_month: staffAtt.late || 0, late_minutes_month: lateMins };
  }));
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`United Academy app running: http://localhost:${PORT}`));
