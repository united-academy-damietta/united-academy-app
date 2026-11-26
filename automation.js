// Automation engine: turns app events into WhatsApp message DRAFTS.
// Nothing is ever sent automatically. Drafts are reviewed in the Messages
// screen and sent by a human through a wa.me link.
const {
  db,
  getSetting,
  getSettingInt,
  todayCairo,
  diffDays,
  currentSub,
  subState,
  normalizePhone
} = require('./db');

const insertMsg = db.prepare(
  `INSERT OR IGNORE INTO messages (player_id, type, body, dedupe_key)
   VALUES (?, ?, ?, ?)`
);

function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m
  );
}

function baseVars(player, extra) {
  return Object.assign(
    {
      player: player.name,
      parent: player.parent_name || 'ولي الأمر',
      academy: getSetting('academy_name'),
      grace: getSettingInt('grace_days', 7)
    },
    extra || {}
  );
}

function createDraft(player, type, body, dedupeKey) {
  const res = insertMsg.run(player.id, type, body, dedupeKey);
  return res.changes > 0;
}

// Payment confirmation after a subscription is created/renewed.
function confirmationDraft(playerId, sub) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return false;
  const body = fill(getSetting('tpl_payment'), baseVars(player, {
    amount: sub.amount,
    end_date: sub.end_date
  }));
  return createDraft(player, 'payment', body, `pay:${playerId}:${sub.id}`);
}

// Absence drafts for one training date: active/grace players not marked present.
function absenceDrafts(date) {
  const today = date || todayCairo();
  const players = db.prepare(`SELECT * FROM players WHERE status = 'active'`).all();
  const presentStmt = db.prepare(
    'SELECT present FROM attendance WHERE player_id = ? AND date = ?'
  );
  let created = 0;
  for (const p of players) {
    const sub = currentSub(p.id);
    if (!sub || sub.start_date > today) continue; // not yet a member on that date
    const st = subState(sub, today);
    if (st.state !== 'active' && st.state !== 'grace') continue;
    const att = presentStmt.get(p.id, today);
    if (att && att.present) continue; // was present
    const body = fill(getSetting('tpl_absence'), baseVars(p));
    if (createDraft(p, 'absence', body, `abs:${p.id}:${today}`)) created++;
  }
  return created;
}

// Renewal drafts: 7 days before end, on end date, and once during grace.
function renewalDrafts(today) {
  today = today || todayCairo();
  const grace = getSettingInt('grace_days', 7);
  const players = db.prepare(`SELECT * FROM players WHERE status = 'active'`).all();
  let created = 0;
  for (const p of players) {
    const sub = currentSub(p.id);
    if (!sub) continue;
    const daysLeft = diffDays(today, sub.end_date);
    let type = null, tpl = null, key = null;
    if (daysLeft === 7) {
      type = 'reminder_7d'; tpl = 'tpl_reminder_7d'; key = `r7:${p.id}:${sub.id}`;
    } else if (daysLeft === 0) {
      type = 'due'; tpl = 'tpl_due'; key = `due:${p.id}:${sub.id}`;
    } else if (daysLeft < 0 && daysLeft >= -grace) {
      type = 'overdue'; tpl = 'tpl_overdue'; key = `ovd:${p.id}:${sub.id}`;
    }
    if (!type) continue;
    const body = fill(getSetting(tpl), baseVars(p, {
      end_date: sub.end_date,
      days: Math.abs(daysLeft)
    }));
    if (createDraft(p, type, body, key)) created++;
  }
  return created;
}

// Run everything time-based (called on server start and from dashboard).
function runDaily(today) {
  return { renewals: renewalDrafts(today) };
}

function waLink(player, body) {
  const phone = normalizePhone(player.parent_phone);
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

module.exports = { confirmationDraft, absenceDrafts, renewalDrafts, runDaily, waLink, fill };
