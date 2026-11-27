// Demo seed: runs only when the players table is empty.
const { db, todayCairo, addDays, addMonths } = require('./db');
const auth = require('./auth');

// Deterministic pseudo-random so the demo data is stable between reseeds.
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

const FIRST_NAMES = [
  'يوسف', 'حمزة', 'مالك', 'عمر', 'زياد', 'آدم', 'مروان', 'يحيى', 'سليم', 'ريان',
  'جاد', 'كريم', 'مازن', 'فارس', 'زين', 'مؤمن', 'همام', 'تميم', 'بلال', 'أنس',
  'باسل', 'تيمور', 'سيف', 'يزيد', 'كنان', 'إلياس', 'هادي', 'لؤي', 'سند', 'قصي',
  'معاذ', 'براء', 'عمار', 'أيوب', 'حاتم', 'طه', 'جود', 'عمرو', 'بدر', 'يامن',
  'أرسلان', 'ضياء', 'شهاب', 'رواد', 'نبيل'
];
const FATHER_NAMES = [
  'أحمد', 'محمد', 'محمود', 'حسن', 'إبراهيم', 'سيد', 'مصطفى', 'خالد', 'طارق', 'عماد',
  'إسلام', 'أسامة', 'هشام', 'سامي', 'وائل', 'هاني', 'رضا', 'شعبان', 'عطية', 'زكي',
  'عاشور', 'الدسوقي', 'عوض', 'مبروك', 'سرحان', 'غانم', 'توفيق', 'فهيم', 'لطفي', 'مراد',
  'ناجي', 'قدري', 'صبحي', 'عزت', 'يونس', 'زهران', 'سليمان', 'فرج', 'حجازي', 'خليل',
  'درويش', 'عقل', 'معوض', 'حلمي', 'رفعت'
];
const SURNAMES = [
  'عبد الله', 'كامل', 'فتحي', 'رمضان', 'عادل', 'سليم', 'جابر', 'فؤاد', 'نبيل', 'الشاذلي',
  'النجار', 'الغندور', 'أبو زيد', 'الحسيني', 'عبد العزيز', 'عبد الحميد', 'وهيب', 'عيد', 'صقر', 'نصار',
  'سعد', 'شكري', 'طلعت', 'عفيفي', 'غريب', 'قطب', 'لاشين', 'هيكل', 'وصفي', 'بركات',
  'جاد', 'حربي', 'دعبس', 'سلامة', 'فريد', 'قاسم', 'مرسي', 'نصر', 'هلال', 'وجيه',
  'ياسر', 'شلبي', 'صادق', 'فايد', 'مرعي', 'زكريا', 'عياد', 'قناوي', 'ماضي', 'هارون'
];

function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (n > 0) return false;

  const today = todayCairo();
  const SQUADS = ['كيدز 2019-2021', '2017-2018', '2015-2016', '2013-2014', 'حراس'];
  const AGE_LABEL = {
    'كيدز 2019-2021': 'كيدز',
    '2017-2018': '2017/2018',
    '2015-2016': '2015/2016',
    '2013-2014': '2013/2014',
    'حراس': 'حراس'
  };
  const SQUAD_SIZE = 20;

  // Original named demo players (kept as-is).
  const players = [
    ['يوسف أحمد', 'أحمد محمود', '01012345001', 'كيدز', 'كيدز 2019-2021', '2019-04-12'],
    ['حمزة سيد', 'سيد عبد الله', '01012345002', 'كيدز', 'كيدز 2019-2021', '2020-08-03'],
    ['مالك مصطفى', 'مصطفى كامل', '01012345003', '2017/2018', '2017-2018', '2017-06-14'],
    ['عمر خالد', 'خالد حسن', '01012345004', '2017/2018', '2017-2018', '2018-02-19'],
    ['زياد عماد', 'عماد فتحي', '01012345005', '2015/2016', '2015-2016', '2015-09-08'],
    ['آدم هشام', 'هشام رمضان', '01012345006', 'كيدز', 'كيدز 2019-2021', '2021-01-25'],
    ['مروان طارق', 'طارق سليم', '01012345007', '2015/2016', '2015-2016', '2016-05-21'],
    ['يحيى كريم', 'كريم عادل', '01012345008', '2017/2018', '2017-2018', '2017-11-30'],
    ['سليم محمود', 'محمود جابر', '01012345009', '2013/2014', '2013-2014', '2013-03-17'],
    ['كنزي محمد', 'محمد الشاذلي', '01012345010', '2013/2014', '2013-2014', '2014-07-09'],
    ['ريان إسلام', 'إسلام فؤاد', '01012345011', 'حراس', 'حراس', '2014-12-05'],
    ['جاد أسامة', 'أسامة نبيل', '01012345012', '2015/2016', '2015-2016', '2016-10-02']
  ];
  const BIRTH_RANGE = {
    'كيدز 2019-2021': [2019, 2021],
    '2017-2018': [2017, 2018],
    '2015-2016': [2015, 2016],
    '2013-2014': [2013, 2014],
    'حراس': [2013, 2016]
  };

  // Varied subscription states for the original 12 (relative to today).
  const subPlans = [
    { start: addDays(today, -10), months: 1, amount: 700 },
    { start: addDays(today, -23), months: 1, amount: 700 },
    { start: addDays(today, -29), months: 1, amount: 700 },
    { start: addDays(today, -30), months: 1, amount: 700 },
    { start: addDays(today, -33), months: 1, amount: 700 },
    { start: addDays(today, -36), months: 1, amount: 700 },
    { start: addDays(today, -45), months: 1, amount: 700 },
    { start: addDays(today, -5), months: 1, amount: 700 },
    { start: addDays(today, -60), months: 3, amount: 1890 },
    { start: addDays(today, -1), months: 1, amount: 700 },
    { start: addDays(today, -25), months: 1, amount: 700 },
    null
  ];

  // Fill every squad up to SQUAD_SIZE with generated players.
  const usedNames = new Set(players.map((p) => p[0]));
  const gen = rng(20261127);
  let phoneSeq = 0;
  const generated = []; // {row, squad}
  SQUADS.forEach((squad, si) => {
    const have = players.filter((p) => p[4] === squad).length;
    for (let j = have; j < SQUAD_SIZE; j++) {
      let name, guard = 0;
      do {
        const first = FIRST_NAMES[Math.floor(gen() * FIRST_NAMES.length)];
        const father = FATHER_NAMES[Math.floor(gen() * FATHER_NAMES.length)];
        name = `${first} ${father}`;
        guard++;
      } while (usedNames.has(name) && guard < 50);
      usedNames.add(name);
      const father = name.split(' ')[1];
      const parent = `${father} ${SURNAMES[Math.floor(gen() * SURNAMES.length)]}`;
      phoneSeq++;
      const phone = '010' + String(20000000 + phoneSeq * 91).slice(0, 8);
      const [yFrom, yTo] = BIRTH_RANGE[squad];
      const by = yFrom + Math.floor(gen() * (yTo - yFrom + 1));
      const birth = `${by}-${String(1 + Math.floor(gen() * 12)).padStart(2, '0')}-${String(1 + Math.floor(gen() * 28)).padStart(2, '0')}`;
      const row = [name, parent, phone, AGE_LABEL[squad], squad, birth];
      players.push(row);
      generated.push({ index: players.length - 1, squad, squadIndex: si });
    }
  });

  // Dropout demo players (from the generated ones): stopped coming entirely.
  // month dropouts: last presence 14-30 days ago. year dropouts: 31-365 days ago.
  const monthDropouts = [generated[5], generated[42], generated[60]].filter(Boolean).map((g, k) => ({
    index: g.index, stopDaysAgo: [18, 22, 26][k]
  }));
  const yearDropouts = [generated[24], generated[78]].filter(Boolean).map((g, k) => ({
    index: g.index, stopDaysAgo: [48, 60][k]
  }));
  const dropoutByIndex = {};
  monthDropouts.concat(yearDropouts).forEach((d) => (dropoutByIndex[d.index] = d.stopDaysAgo));

  // Training days (Sun/Tue/Thu) going back ~10 weeks.
  const trainingDates = [];
  for (let d = 0; trainingDates.length < 30 && d < 80; d++) {
    const date = addDays(today, -d);
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    if ([0, 2, 4].includes(dow)) trainingDates.push(date);
  }

  const insertPlayer = db.prepare(
    'INSERT INTO players (name, parent_name, parent_phone, age_group, squad, birth_date) VALUES (?,?,?,?,?,?)'
  );
  const insertSub = db.prepare(
    'INSERT INTO subscriptions (player_id, start_date, months, amount, end_date) VALUES (?,?,?,?,?)'
  );
  const insertAtt = db.prepare(
    'INSERT OR IGNORE INTO attendance (player_id, date, present) VALUES (?,?,?)'
  );

  const PLAN_TABLE = { 1: 700, 3: 1890, 6: 3570, 12: 6720 };

  const tx = db.transaction(() => {
    players.forEach((p, i) => {
      const id = insertPlayer.run(...p).lastInsertRowid;
      // subscription
      if (i < subPlans.length) {
        const plan = subPlans[i];
        if (plan) insertSub.run(id, plan.start, plan.months, plan.amount, addMonths(plan.start, plan.months));
      } else {
        const r = rng(9000 + i * 37);
        const pick = r();
        let months = 0;
        if (pick < 0.62) months = 1;
        else if (pick < 0.78) months = 3;
        else if (pick < 0.9) months = 6;
        else if (pick < 0.97) months = 12;
        if (months) {
          const maxBack = Math.min(months * 28, 200) - 5;
          const start = addDays(today, -(1 + Math.floor(r() * Math.max(1, maxBack))));
          insertSub.run(id, start, months, PLAN_TABLE[months], addMonths(start, months));
        }
      }
      // attendance: realistic variety per player
      const stopDays = dropoutByIndex[i];
      const pr = rng(5000 + i * 91);
      const rate = 0.8 + pr() * 0.15; // 80-95% حضور
      trainingDates.forEach((date) => {
        if (stopDays && date > addDays(today, -stopDays)) return; // انقطع بعد التاريخ ده
        insertAtt.run(id, date, pr() < rate ? 1 : 0);
      });
    });
  });
  tx();

  // لاعبين تجريبيين (معلمين بـ "تجريبي") علشان كروت أنواع الاشتراك تفتح قوائم مش فاضية - يتشالوا قبل البيانات الحقيقية
  const demoPlayers = [
    { name: 'تجريبي - لاعب 3 شهور 1', months: 3, amount: 1890 },
    { name: 'تجريبي - لاعب 3 شهور 2', months: 3, amount: 1890 },
    { name: 'تجريبي - لاعب 6 شهور 1', months: 6, amount: 3570 },
    { name: 'تجريبي - لاعب 6 شهور 2', months: 6, amount: 3570 },
    { name: 'تجريبي - عضو مستقبل 1', months: 1, amount: 400, kind: 'mustaqbal', membership: 'MST-DEMO-01' },
    { name: 'تجريبي - عضو مستقبل 2', months: 1, amount: 550, kind: 'mustaqbal', membership: 'MST-DEMO-02' }
  ];
  const insertDemoP = db.prepare(
    'INSERT INTO players (name, parent_name, parent_phone, age_group, squad, birth_date, membership_no) VALUES (?,?,?,?,?,?,?)'
  );
  const insertDemoSub = db.prepare(
    'INSERT INTO subscriptions (player_id, start_date, months, amount, end_date, kind) VALUES (?,?,?,?,?,?)'
  );
  const demoTx = db.transaction(() => {
    demoPlayers.forEach((d, i) => {
      const pid = insertDemoP.run(d.name, 'ولي أمر تجريبي', '01099990' + String(100 + i), '2017-2018', '2017-2018', '2017-03-15', d.membership || null).lastInsertRowid;
      insertDemoSub.run(pid, today, d.months, d.amount, addMonths(today, d.months), d.kind || 'academy');
    });
  });
  demoTx();

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
      const info = insertStaff.run(name, role, squad);
      if (username && !db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
        const uid = auth.createUser(username, 'united2026', urole, squad);
        db.prepare('UPDATE staff SET user_id = ? WHERE id = ?').run(uid, info.lastInsertRowid);
      }
    });
  });
  staffTx();

  // Demo staff attendance over the last 12 training days, with late minutes and some absences.
  const allStaff = db.prepare('SELECT id, role FROM staff ORDER BY id').all();
  const insStaffAtt = db.prepare(
    'INSERT OR IGNORE INTO staff_attendance (staff_id, date, status, late_minutes) VALUES (?,?,?,?)'
  );
  const staffDays = trainingDates.slice(0, 30);
  allStaff.forEach((s, si) => {
    staffDays.forEach((ds, di) => {
      if (si === 0 && di === 1) insStaffAtt.run(s.id, ds, 'late', 20); // ك شهد اتأخرت 20 دقيقة
      else if (si === 2 && di === 2) insStaffAtt.run(s.id, ds, 'absent', 0);
      else if ((si * 3 + di) % 19 === 0) insStaffAtt.run(s.id, ds, 'absent', 0);
      else if ((si * 5 + di) % 9 === 0) insStaffAtt.run(s.id, ds, 'late', 5 + ((si * 13 + di * 7) % 26));
      else insStaffAtt.run(s.id, ds, 'present', 0);
    });
  });

  // Demo parent-contact log entries.
  const demoIds = db.prepare('SELECT id FROM players ORDER BY id LIMIT 20').all().map((r) => r.id);
  // Three players get birthdays in the coming week so the birthday box has content.
  [1, 3, 5].forEach((offset, i) => {
    const md = addDays(today, offset).slice(5);
    db.prepare('UPDATE players SET birth_date = substr(birth_date, 1, 4) || ? WHERE id = ?').run('-' + md, demoIds[i * 7]);
  });
  // Sample evaluations for last month so history and trend show up.
  const lastMonth = addMonths(today.slice(0, 8) + '01', -1).slice(0, 7);
  const insEval = db.prepare(
    'INSERT OR IGNORE INTO evaluations (player_id, month, commitment, skill, fitness, behavior, notes, coach_name) VALUES (?,?,?,?,?,?,?,?)'
  );
  insEval.run(demoIds[0], lastMonth, 5, 3, 4, 5, 'مجتهد وملتزم، محتاج يشتغل على التسديد', 'ك شهد');
  insEval.run(demoIds[1], lastMonth, 4, 4, 4, 4, '', 'ك شهد');
  insEval.run(demoIds[2], lastMonth, 3, 4, 3, 4, 'لياقته محتاجة تتحسن', 'ك شهد');
  insEval.run(demoIds[3], lastMonth, 5, 5, 4, 5, 'موهبة واضحة', 'ك شهد');
  // Sample announcement so the announcements box shows realistic content.
  db.prepare('INSERT INTO announcements (kind, details, event_date, created_by, created_at) VALUES (?,?,?,?,?)')
    .run('تغيير ميعاد', 'تمرين يوم الخميس الجاي هيبقى الساعة 6 بدل 5 عشان امتحانات نص السنة', addDays(today, 7), 'أ مريم المصري', addDays(today, -1) + ' 12:00:00');
  const insContact = db.prepare(
    'INSERT INTO contact_log (player_id, type, note, staff_name, created_at) VALUES (?,?,?,?,?)'
  );
  insContact.run(demoIds[5], 'اشتراك', 'كلمنا والده بخصوص التجديد وقال هيجدد آخر الأسبوع', 'أ مريم المصري', addDays(today, -2) + ' 14:30:00');
  insContact.run(demoIds[5], 'غياب', 'والدته اتصلت: عنده امتحانات الأسبوع ده وهيحضر من الخميس', 'أ مريم المصري', addDays(today, -4) + ' 12:10:00');
  insContact.run(demoIds[17], 'شكوى أو استفسار', 'والده سأل عن مواعيد التدريب في رمضان', 'م محمد رزق', addDays(today, -1) + ' 18:45:00');

  const insertExp = db.prepare('INSERT INTO expenses (title, category, amount, date) VALUES (?,?,?,?)');
  insertExp.run('إيجار الملعب - الشهر ده', 'إيجار', 3000, today.slice(0, 8) + '01');
  insertExp.run('كرات ومعدات تدريب', 'معدات', 1200, addDays(today, -6));
  insertExp.run('مرتبات الجهاز - الشهر الماضي', 'مرتبات', 8500, addDays(today, -32));

  console.log(`Seeded demo data: ${players.length} players (${SQUAD_SIZE} per squad), 11 staff, 3 expenses.`);
  return true;
}

module.exports = { seedIfEmpty };
