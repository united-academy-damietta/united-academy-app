// Demo seed: runs only when the players table is empty.
const { db, todayCairo, addDays, addMonths } = require('./db');
const auth = require('./auth');

function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (n > 0) return false;

  const today = todayCairo();
  const players = [
    ['يوسف أحمد', 'أحمد محمود', '01012345001', 'كيدز', 'كيدز 2019-2021'],
    ['حمزة سيد', 'سيد عبد الله', '01012345002', 'كيدز', 'كيدز 2019-2021'],
    ['مالك مصطفى', 'مصطفى كامل', '01012345003', '2017/2018', '2017-2018'],
    ['عمر خالد', 'خالد حسن', '01012345004', '2017/2018', '2017-2018'],
    ['زياد عماد', 'عماد فتحي', '01012345005', '2015/2016', '2015-2016'],
    ['آدم هشام', 'هشام رمضان', '01012345006', 'كيدز', 'كيدز 2019-2021'],
    ['مروان طارق', 'طارق سليم', '01012345007', '2015/2016', '2015-2016'],
    ['يحيى كريم', 'كريم عادل', '01012345008', '2017/2018', '2017-2018'],
    ['سليم محمود', 'محمود جابر', '01012345009', '2013/2014', '2013-2014'],
    ['كنزي محمد', 'محمد الشاذلي', '01012345010', '2013/2014', '2013-2014'],
    ['ريان إسلام', 'إسلام فؤاد', '01012345011', 'حراس', 'حراس'],
    ['جاد أسامة', 'أسامة نبيل', '01012345012', '2015/2016', '2015-2016']
  ];

  const insertPlayer = db.prepare(
    'INSERT INTO players (name, parent_name, parent_phone, age_group, squad) VALUES (?,?,?,?,?)'
  );
  const insertSub = db.prepare(
    'INSERT INTO subscriptions (player_id, start_date, months, amount, end_date) VALUES (?,?,?,?,?)'
  );
  const insertAtt = db.prepare(
    'INSERT OR IGNORE INTO attendance (player_id, date, present) VALUES (?,?,?)'
  );

  // Varied subscription states relative to today.
  const subPlans = [
    { start: addDays(today, -10), months: 1, amount: 700 }, // active, 20 left
    { start: addDays(today, -23), months: 1, amount: 700 }, // ends in 7 -> reminder
    { start: addDays(today, -29), months: 1, amount: 700 }, // ends in 1
    { start: addDays(today, -30), months: 1, amount: 700 }, // ends today -> due
    { start: addDays(today, -33), months: 1, amount: 700 }, // in grace (3 over)
    { start: addDays(today, -36), months: 1, amount: 700 }, // in grace (6 over)
    { start: addDays(today, -45), months: 1, amount: 700 }, // expired
    { start: addDays(today, -5), months: 1, amount: 700 },  // active
    { start: addDays(today, -60), months: 3, amount: 1890 }, // active long
    { start: addDays(today, -1), months: 1, amount: 700 },  // just started
    { start: addDays(today, -25), months: 1, amount: 700 }, // ends in 5
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

  const staffRows = [
    ['ك شهد', 'مدربة', 'كيدز 2019-2021', 'shahd', 'coach'],
    ['ك الاء', 'مدربة', 'كيدز 2019-2021', 'alaa', 'coach'],
    ['ك أحمد خشبة', 'مدرب', '2017-2018', 'khashaba', 'coach'],
    ['ك محمد محمود', 'مدرب', '2015-2016', 'mmahmoud', 'coach'],
    ['ك إسلام', 'مدرب', '2013-2014', 'islam', 'coach'],
    ['ك مصطفى عبد السلام', 'مدرب حراس', 'حراس', 'mostafa', 'coach'],
    ['أ مريم المصري', 'مسؤولة الاشتراكات', null, 'mariam', 'manager'],
    ['م محمد رزق', 'مدير الأكاديمية', null, 'mrezq', 'manager'],
    ['ك أحمد النجار', 'المدير الفني', null, 'anagar', 'manager'],
    ['أ محمد الشربيني', 'إداري', null, 'shorbiny', 'staff'],
    ['عم حمودة', 'عامل مهمات', null, 'hamouda', 'staff']
  ];
  const insertStaff = db.prepare('INSERT INTO staff (name, role, squad) VALUES (?,?,?)');
  const staffTx = db.transaction(() => {
    staffRows.forEach(([name, role, squad, username, urole]) => {
      insertStaff.run(name, role, squad);
      if (username && !db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
        auth.createUser(username, 'united2026', urole, squad);
      }
    });
  });
  staffTx();

  const insertExp = db.prepare('INSERT INTO expenses (title, category, amount, date) VALUES (?,?,?,?)');
  insertExp.run('إيجار الملعب - الشهر ده', 'إيجار', 3000, today.slice(0, 8) + '01');
  insertExp.run('كرات ومعدات تدريب', 'معدات', 1200, addDays(today, -6));
  insertExp.run('مرتبات الجهاز - الشهر الماضي', 'مرتبات', 8500, addDays(today, -32));

  console.log('Seeded demo data: 12 players, 11 staff, 3 expenses.');
  return true;
}

module.exports = { seedIfEmpty };
