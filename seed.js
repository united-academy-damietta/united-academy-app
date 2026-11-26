// Demo seed: runs only when the players table is empty.
const { db, todayCairo, addDays, addMonths } = require('./db');

function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (n > 0) return false;

  const today = todayCairo();
  const players = [
    ['يوسف أحمد', 'أحمد محمود', '01012345001', 'تحت 10'],
    ['حمزة سيد', 'سيد عبد الله', '01012345002', 'تحت 10'],
    ['مالك مصطفى', 'مصطفى كامل', '01012345003', 'تحت 12'],
    ['عمر خالد', 'خالد حسن', '01012345004', 'تحت 12'],
    ['زياد عماد', 'عماد فتحي', '01012345005', 'تحت 14'],
    ['آدم هشام', 'هشام رمضان', '01012345006', 'تحت 10'],
    ['مروان طارق', 'طارق سليم', '01012345007', 'تحت 14'],
    ['يحيى كريم', 'كريم عادل', '01012345008', 'تحت 12'],
    ['سليم محمود', 'محمود جابر', '01012345009', 'تحت 10'],
    ['كنزي محمد', 'محمد الشاذلي', '01012345010', 'تحت 12'],
    ['ريان إسلام', 'إسلام فؤاد', '01012345011', 'تحت 14'],
    ['جاد أسامة', 'أسامة نبيل', '01012345012', 'تحت 10']
  ];

  const insertPlayer = db.prepare(
    'INSERT INTO players (name, parent_name, parent_phone, age_group) VALUES (?,?,?,?)'
  );
  const insertSub = db.prepare(
    'INSERT INTO subscriptions (player_id, start_date, months, amount, end_date) VALUES (?,?,?,?,?)'
  );
  const insertAtt = db.prepare(
    'INSERT OR IGNORE INTO attendance (player_id, date, present) VALUES (?,?,?)'
  );

  // Varied subscription states relative to today.
  const subPlans = [
    { start: addDays(today, -10), months: 1, amount: 300 }, // active, 20 left
    { start: addDays(today, -23), months: 1, amount: 300 }, // ends in 7 -> reminder
    { start: addDays(today, -29), months: 1, amount: 350 }, // ends in 1
    { start: addDays(today, -30), months: 1, amount: 300 }, // ends today -> due
    { start: addDays(today, -33), months: 1, amount: 300 }, // in grace (3 over)
    { start: addDays(today, -36), months: 1, amount: 350 }, // in grace (6 over)
    { start: addDays(today, -45), months: 1, amount: 300 }, // expired
    { start: addDays(today, -5), months: 1, amount: 300 },  // active
    { start: addDays(today, -60), months: 3, amount: 850 }, // active long
    { start: addDays(today, -1), months: 1, amount: 300 },  // just started
    { start: addDays(today, -25), months: 1, amount: 300 }, // ends in 5
    null // no subscription yet
  ];

  const tx = db.transaction(() => {
    players.forEach((p, i) => {
      const id = insertPlayer.run(...p).lastInsertRowid;
      const plan = subPlans[i];
      if (plan) {
        insertSub.run(id, plan.start, plan.months, plan.amount, addMonths(plan.start, plan.months));
      }
      // attendance for the last 4 training days (Sun/Tue/Thu)
      const days = [];
      for (let d = 0; d <= 10 && days.length < 4; d++) {
        const date = addDays(today, -d);
        const dow = new Date(date + 'T12:00:00Z').getUTCDay();
        if ([0, 2, 4].includes(dow)) days.push(date);
      }
      days.forEach((date, di) => {
        const present = (i + di) % 5 !== 0; // ~80% attendance
        insertAtt.run(id, date, present ? 1 : 0);
      });
    });
  });
  tx();
  console.log('Seeded demo data: 12 players.');
  return true;
}

module.exports = { seedIfEmpty };
