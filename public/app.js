// United Academy admin - single page app (no build step).
const app = document.getElementById('app');
let currentUser = null;
const NAV_RULES = {
  coach: ['/', '/players', '/attendance'],
  staff: ['/staff']
};
function applyRoleNav() {
  const allowed = currentUser && NAV_RULES[currentUser.role];
  document.querySelectorAll('#bottomnav a').forEach((a) => {
    a.style.display = allowed && !allowed.includes(a.dataset.route) ? 'none' : '';
  });
}
const pageTitle = document.getElementById('page-title');

async function api(path, opts) {
  const res = await fetch('/api' + path, opts ? {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  } : undefined);
  if (res.status === 401 && path !== '/login') {
    renderLogin();
    throw new Error('سجل الدخول الأول');
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'خطأ في الاتصال');
  }
  return res.json();
}

// ---------------- Login ----------------
function renderLogin() {
  pageTitle.textContent = 'تسجيل الدخول';
  document.body.classList.add('login-mode');
  document.getElementById('bottomnav').style.display = 'none';
  app.innerHTML = `
    <div class="card login-card">
      <img class="login-logo" src="assets/logo.jpg" alt="United Academy" />
      <h2 style="margin-bottom:2px">يونايتد أكاديمي</h2>
      <p class="note" style="letter-spacing:2px;margin-bottom:14px">UNITED ACADEMY</p>
      <div style="text-align:right">
        <label>اسم المستخدم</label><input id="l-user" autocomplete="username" />
        <label>كلمة السر</label><input id="l-pass" type="password" autocomplete="current-password" />
      </div>
      <button class="btn block" id="l-btn">دخول</button>
      <p class="note" id="l-err" style="color:var(--red);margin-top:8px"></p>
    </div>`;
  async function doLogin() {
    try {
      await api('/login', { body: {
        username: document.getElementById('l-user').value,
        password: document.getElementById('l-pass').value
      }});
      document.body.classList.remove('login-mode');
      document.getElementById('bottomnav').style.display = '';
      route();
    } catch (e) {
      document.getElementById('l-err').textContent = e.message;
    }
  }
  document.getElementById('l-btn').onclick = doLogin;
  document.getElementById('l-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const WEEKDAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const STATE = {
  active: { label: 'نشط', cls: 'active' },
  grace: { label: 'فترة سماح', cls: 'grace' },
  expired: { label: 'منتهي', cls: 'expired' },
  none: { label: 'بدون اشتراك', cls: 'none' }
};
const MSG_TYPES = {
  payment: 'تأكيد اشتراك',
  absence: 'تنبيه غياب',
  reminder_7d: 'تذكير تجديد',
  due: 'انتهاء اشتراك',
  overdue: 'تجديد متأخر'
};

function stateBadge(p) {
  const s = STATE[p.sub_state] || STATE.none;
  let extra = '';
  if (p.days_left !== null && p.days_left !== undefined) {
    if (p.sub_state === 'active') extra = ` - فاضل ${p.days_left} يوم`;
    else if (p.sub_state === 'grace') extra = ` - متأخر ${-p.days_left} يوم`;
  }
  return `<span class="badge ${s.cls}">${s.label}${extra}</span>`;
}

function openModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modal-backdrop').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

// ---------------- Dashboard ----------------
async function renderDashboard() {
  pageTitle.textContent = 'لوحة التحكم';
  const d = await api('/dashboard');
  const hero = `
    <div class="hero">
      <div class="hero-text">
        <div class="h-title">يونايتد أكاديمي</div>
        <div class="h-sub">إدارة الحضور والاشتراكات - دمياط الجديدة</div>
        <div class="h-line"></div>
      </div>
    </div>`;
  // Coach dashboard: attendance only - no subscription counts or money.
  if (currentUser && currentUser.role === 'coach') {
    const m = await api('/attendance/month');
    app.innerHTML = hero + `
    <div class="grid">
      <div class="card stat"><div class="num">${d.players_total}</div><div class="lbl">لاعب في مجموعتك</div></div>
      <div class="card stat"><div class="num">${d.present_today}/${d.players_total}</div><div class="lbl">حضور النهاردة${d.is_training_day ? '' : ' (مفيش تدريب)'}</div></div>
    </div>
    <div class="btn-row"><a class="btn block" href="#/attendance">✅ تسجيل حضور النهاردة</a></div>
    <h2 class="section">أكتر اللاعبين حضورًا الشهر ده</h2>
    ${topAttendeeRows(m.top_attendees)}
    <div id="my-att"></div>
    <h2 class="section">المنقطعين عن التدريب</h2>
    ${dropoutBox(m)}
    <h2 class="section">أيام التدريب الشهر ده (أحد / تلات / خميس)</h2>
    ${trainingDayRows(m.training_days)}
    <h2 class="section">الغائبين الشهر ده</h2>
    ${absenteeRows(m.absentees)}`;
    // خانة حضور المدرب نفسه (عرض فقط - الإدارة هي اللي بتسجل)
    try {
      const mine = await api('/my-attendance');
      if (mine.linked) {
        const ST = { present: '✅ حاضر', absent: '❌ غائب', late: '⏰ متأخر' };
        document.getElementById('my-att').innerHTML = `
          <h2 class="section">حضوري أنا الشهر ده</h2>
          <div class="grid">
            <div class="card stat"><div class="num">${mine.totals.absent}</div><div class="lbl">مرة غياب</div></div>
            <div class="card stat"><div class="num">${mine.totals.late_minutes}</div><div class="lbl">دقيقة تأخير</div></div>
          </div>
          ${mine.rows.length ? mine.rows.map((r) => `
            <div class="list-item" style="cursor:default">
              <div class="grow"><div class="name">${r.date}</div></div>
              <span class="badge ${r.status === 'present' ? 'active' : r.status === 'late' ? 'grace' : 'expired'}">${ST[r.status]}${r.status === 'late' && r.late_minutes ? ' ' + r.late_minutes + ' د' : ''}</span>
            </div>`).join('') : '<div class="empty">لسه مفيش تسجيل ليك الشهر ده</div>'}
          <p class="note">الإدارة هي اللي بتسجل حضور وغياب الجهاز - الشاشة دي للعرض بس.</p>`;
      }
    } catch (e) {}
    return;
  }
  app.innerHTML = hero + `
    <div class="grid">
      <div class="card stat"><div class="num">${d.players_total}</div><div class="lbl">لاعب مسجل</div></div>
      <div class="card stat"><div class="num">${d.subs_active}</div><div class="lbl">اشتراك ساري</div></div>
      <div class="card stat"><div class="num">${d.collected_month}</div><div class="lbl">جنيه محصلة الشهر ده (${d.payments_month} دفعة)</div></div>
      <div class="card stat"><div class="num">${d.present_today}/${d.subs_active}</div><div class="lbl">حضور النهاردة${d.is_training_day ? '' : ' (مفيش تدريب)'}</div></div>
    </div>
    <div id="coaches-box"></div>
    <h2 class="section">تجديدات مستنية (خلال 7 أيام أو متأخرة)</h2>
    ${d.renewals_due.length ? d.renewals_due.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">ينتهي ${p.end_date}</div>
        </div>
        ${stateBadge({ sub_state: p.sub_state, days_left: p.days_left })}
      </div>`).join('') : '<div class="empty">مفيش تجديدات قريبة 👌</div>'}
    <div class="btn-row">
      <a class="btn secondary" href="#/messages">الرسائل الجاهزة (${d.draft_messages})</a>
      <button class="btn" id="gen-btn">تحديث التذكيرات</button>
    </div>`;
  document.getElementById('gen-btn').onclick = async () => {
    const r = await api('/messages/generate');
    toast(`اتعمل ${r.renewals} تذكير جديد`);
    renderDashboard();
  };
  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager')) {
    try {
      const f = await api('/finance');
      document.querySelector('.grid').insertAdjacentHTML('beforeend', `
        <div class="card stat"><div class="num">${f.expenses_month}</div><div class="lbl">مصاريف الشهر</div></div>
        <div class="card stat"><div class="num">${f.expenses_year}</div><div class="lbl">مصاريف السنة</div></div>
        <div class="card stat"><div class="num" style="color:${f.net_year >= 0 ? 'var(--green-dark)' : 'var(--red)'}">${f.net_year}</div><div class="lbl">صافي السنة</div></div>`);
    } catch (e) {}
    try {
      const coaches = await api('/coaches-overview');
      document.getElementById('coaches-box').innerHTML = coaches.length ? `
        <h2 class="section">المدربين ومجموعاتهم (الشهر ده)</h2>
        ${coaches.map((c) => `
          <div class="list-item" style="cursor:default">
            <div class="grow">
              <div class="name">${esc(c.name)}</div>
              <div class="sub">${esc(c.squad || c.role)} - ${c.players_count} لاعب</div>
            </div>
            <div class="sub" style="text-align:left">✅${c.present_month} ❌${c.absent_month} ⏰${c.late_month}${c.late_minutes_month ? ` (${c.late_minutes_month} د)` : ''}</div>
          </div>`).join('')}` : '';
    } catch (e) {}
    try {
      const m = await api('/attendance/month');
      document.querySelector('.grid').insertAdjacentHTML('afterend', `
        <h2 class="section">أكتر اللاعبين حضورًا الشهر ده</h2>
        ${topAttendeeRows(m.top_attendees)}`);
      document.getElementById('coaches-box').insertAdjacentHTML('beforeend', `
        <h2 class="section">المنقطعين عن التدريب</h2>
        ${dropoutBox(m)}
        <h2 class="section">الغائبين الشهر ده</h2>
        ${absenteeRows(m.absentees)}`);
    } catch (e) {}
  }
}

// ---------------- Players ----------------
async function renderPlayers() {
  pageTitle.textContent = 'اللاعبون';
  app.innerHTML = `
    <div class="search-row">
      <input id="search" placeholder="ابحث بالاسم أو رقم ولي الأمر..." />
      <button class="btn" id="add-btn" style="white-space:nowrap">＋ لاعب</button>
    </div>
    <div id="players-list"></div>`;
  const list = document.getElementById('players-list');
  async function load(q) {
    const rows = await api('/players' + (q ? `?search=${encodeURIComponent(q)}` : ''));
    list.innerHTML = rows.length ? rows.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">${esc(p.age_group || '')} ${p.parent_name ? '• ولي الأمر: ' + esc(p.parent_name) : ''}</div>
        </div>
        ${stateBadge(p)}
      </div>`).join('') : '<div class="empty">مفيش لاعبين مطابقين</div>';
  }
  await load('');
  let timer;
  document.getElementById('search').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(e.target.value.trim()), 250);
  };
  document.getElementById('add-btn').onclick = () => {
    openModal(`
    <h3>لاعب جديد</h3>
    <label>اسم اللاعب *</label><input id="f-name" />
    <label>اسم ولي الأمر</label><input id="f-parent" />
    <label>رقم واتساب ولي الأمر</label><input id="f-phone" inputmode="tel" placeholder="01xxxxxxxxx" />
    <label>المجموعة السنية</label>
    <select id="f-age"><option>تحت 8</option><option selected>تحت 10</option><option>تحت 12</option><option>تحت 14</option><option>تحت 16</option></select>
    <label>ملاحظات</label><input id="f-notes" />
    <div class="btn-row">
      <button class="btn gray" onclick="closeModal()">إلغاء</button>
      <button class="btn" id="save-btn">حفظ</button>
    </div>`);
  document.getElementById('save-btn').onclick = async () => {
    try {
      await api('/players', { body: {
        name: document.getElementById('f-name').value,
        parent_name: document.getElementById('f-parent').value,
        parent_phone: document.getElementById('f-phone').value,
        age_group: document.getElementById('f-age').value,
        notes: document.getElementById('f-notes').value
      }});
      closeModal();
      toast('اتحفظ اللاعب ✅');
      renderPlayers();
    } catch (e) { toast(e.message); }
  };
  };
}

// ---------------- Player detail ----------------
async function renderPlayer(id) {
  pageTitle.textContent = 'ملف اللاعب';
  const p = await api('/players/' + id);
  app.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="name" style="font-size:18px;font-weight:800">${esc(p.name)}</div>
        ${stateBadge(p)}
      </div>
      <div class="kv"><span class="k">المجموعة</span><span>${esc(p.age_group || '-')}</span></div>
      <div class="kv"><span class="k">ولي الأمر</span><span>${esc(p.parent_name || '-')}</span></div>
      <div class="kv"><span class="k">واتساب</span><span>${esc(p.parent_phone || '-')}</span></div>
      ${p.subscription ? `
      <div class="kv"><span class="k">الاشتراك الحالي</span><span>${p.subscription.start_date} ← ${p.subscription.end_date}</span></div>
      <div class="kv"><span class="k">المبلغ</span><span>${p.subscription.amount} جنيه / ${p.subscription.months} شهر</span></div>` :
      '<div class="note" style="margin-top:6px">مفيش اشتراك مسجل لسه.</div>'}
      <div class="btn-row">
        <button class="btn" id="renew-btn">${p.subscription ? 'تجديد اشتراك' : 'اشتراك جديد'}</button>
        <button class="btn secondary" id="edit-btn">تعديل البيانات</button>
      </div>
    </div>
    <h2 class="section">سجل الاشتراكات</h2>
    ${p.subscriptions.length ? p.subscriptions.map((s) => `
      <div class="card"><div class="kv"><span class="k">${s.start_date} ← ${s.end_date}</span><span>${s.amount} جنيه (${s.months} شهر)</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}
    <h2 class="section">آخر الحضور</h2>
    ${p.attendance.length ? p.attendance.map((a) => `
      <div class="card"><div class="kv"><span class="k">${a.date}</span><span>${a.present ? '✅ حاضر' : '❌ غائب'}</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}
    <h2 class="section">الرسائل</h2>
    ${p.messages.length ? p.messages.map((m) => `
      <div class="card"><div class="kv"><span class="k">${MSG_TYPES[m.type] || m.type}</span><span>${m.status === 'sent' ? '✅ اتبعتت' : m.status === 'dismissed' ? 'اتجاهلت' : '📝 مسودة'}</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}`;
  document.getElementById('renew-btn').onclick = async () => {
    const plans = await api('/plans');
    const planOpts = Object.entries(plans).map(([k, v]) =>
      `<option value="${k}">${v.label} - ${v.amount} جنيه</option>`).join('');
    openModal(`
      <h3>${p.subscription ? 'تجديد اشتراك' : 'اشتراك جديد'} - ${esc(p.name)}</h3>
      <label>تاريخ البداية</label><input id="s-start" type="date" value="${todayLocal()}" />
      <label>خطة الاشتراك</label>
      <select id="s-plan">
        ${planOpts}
        <option value="custom">مخصص</option>
      </select>
      <div id="s-custom" class="hidden">
        <label>المدة (شهور)</label><input id="s-months" type="number" min="1" value="1" />
        <label>المبلغ (جنيه)</label><input id="s-amount" type="number" min="0" value="700" />
      </div>
      <p class="note">هيتجهز رسالة تأكيد واتساب كمسودة في شاشة الرسائل - مفيش إرسال تلقائي.</p>
      <div class="btn-row">
        <button class="btn gray" onclick="closeModal()">إلغاء</button>
        <button class="btn" id="sub-save">حفظ الاشتراك</button>
      </div>`);
    document.getElementById('s-plan').onchange = (e) => {
      document.getElementById('s-custom').classList.toggle('hidden', e.target.value !== 'custom');
    };
    document.getElementById('sub-save').onclick = async () => {
      const plan = document.getElementById('s-plan').value;
      const body = { start_date: document.getElementById('s-start').value };
      if (plan === 'custom') {
        body.months = document.getElementById('s-months').value;
        body.amount = document.getElementById('s-amount').value;
      } else {
        body.plan = plan;
      }
      await api(`/players/${id}/subscriptions`, { body });
      closeModal();
      toast('اتسجل الاشتراك ✅ ورسالة التأكيد في الرسائل');
      renderPlayer(id);
    };
  };
  document.getElementById('edit-btn').onclick = () => {
    openModal(`
    <h3>تعديل بيانات ${esc(p.name)}</h3>
    <label>اسم اللاعب</label><input id="e-name" value="${esc(p.name)}" />
    <label>اسم ولي الأمر</label><input id="e-parent" value="${esc(p.parent_name || '')}" />
    <label>رقم الواتساب</label><input id="e-phone" value="${esc(p.parent_phone || '')}" />
    <label>المجموعة السنية</label>
    <select id="e-age">${['تحت 8','تحت 10','تحت 12','تحت 14','تحت 16'].map((a) =>
      `<option ${a === p.age_group ? 'selected' : ''}>${a}</option>`).join('')}</select>
    <label>الحالة</label>
    <select id="e-status">
      <option value="active" ${p.status === 'active' ? 'selected' : ''}>نشط</option>
      <option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>موقوف</option>
    </select>
    <label>ملاحظات</label><input id="e-notes" value="${esc(p.notes || '')}" />
    <div class="btn-row">
      <button class="btn gray" onclick="closeModal()">إلغاء</button>
      <button class="btn" id="edit-save">حفظ</button>
    </div>`);
    document.getElementById('edit-save').onclick = async () => {
    await api('/players/' + id, { method: 'PUT', body: {
      name: document.getElementById('e-name').value,
      parent_name: document.getElementById('e-parent').value,
      parent_phone: document.getElementById('e-phone').value,
      age_group: document.getElementById('e-age').value,
      status: document.getElementById('e-status').value,
      notes: document.getElementById('e-notes').value
    }});
    closeModal();
    toast('اتحفظ ✅');
    renderPlayer(id);
    };
  };
}

// ---------------- Attendance ----------------
function trainingDayRows(days) {
  if (!days.length) return '<div class="empty">مفيش أيام تدريب في الشهر ده</div>';
  return days.map((t) => `
    <div class="list-item" style="cursor:default">
      <div class="grow">
        <div class="name">${WEEKDAYS[t.weekday]} ${t.date.slice(8)}/${t.date.slice(5, 7)}</div>
      </div>
      ${t.future ? '<span class="badge none">جاي</span>'
        : t.recorded ? `<span class="badge active">✅ ${t.present}</span> <span class="badge expired">❌ ${t.absent}</span>`
        : '<span class="badge grace">ماتسجلش</span>'}
    </div>`).join('');
}

function dropoutBox(m) {
  return `
    <div class="grid">
      <div class="card stat"><div class="num">${m.dropout_month}</div><div class="lbl">لاعب انقطع خلال الشهر</div></div>
      <div class="card stat"><div class="num">${m.dropout_year}</div><div class="lbl">لاعب انقطع خلال السنة</div></div>
    </div>
    <p class="note">المنقطع = لاعب ماعندوش حضور مسجل من أسبوعين أو أكتر.</p>`;
}

function topAttendeeRows(top) {
  if (!top || !top.length) return '<div class="empty">لسه مفيش حضور مسجل الشهر ده</div>';
  const medals = ['🥇', '🥈', '🥉'];
  return top.map((p, i) => `
    <div class="list-item" style="cursor:default">
      <div class="grow"><div class="name">${medals[i] || '⭐'} ${esc(p.name)}</div></div>
      <span class="badge active">حضر ${p.present_days} ${p.present_days === 1 ? 'يوم' : 'أيام'}</span>
    </div>`).join('');
}

function absenteeRows(absentees) {
  if (!absentees.length) return '<div class="empty">مفيش غياب مسجل الشهر ده 👌</div>';
  return absentees.map((p) => `
    <div class="list-item" style="cursor:default">
      <div class="grow"><div class="name">${esc(p.name)}</div></div>
      <span class="badge expired">غاب ${p.absent_days} ${p.absent_days === 1 ? 'يوم' : 'أيام'}</span>
    </div>`).join('');
}

async function renderAttendance() {
  pageTitle.textContent = 'الحضور';
  const today = todayLocal();
  const fullRole = currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager');
  app.innerHTML = `
    <div class="tabs">
      <button data-tab="day" class="active">تسجيل يوم</button>
      <button data-tab="month">ملخص الشهر</button>
    </div>
    <div id="att-day-wrap">
      <input type="date" id="att-date" value="${today}" />
      <div id="att-body"></div>
    </div>
    <div id="att-month-wrap" class="hidden">
      <input type="month" id="att-monthpick" value="${today.slice(0, 7)}" />
      <div id="month-body"></div>
    </div>`;

  // ---- tab switching ----
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      const monthMode = b.dataset.tab === 'month';
      document.getElementById('att-day-wrap').classList.toggle('hidden', monthMode);
      document.getElementById('att-month-wrap').classList.toggle('hidden', !monthMode);
      if (monthMode) loadMonth(document.getElementById('att-monthpick').value);
    };
  });

  // ---- day view: mark everyone, confirm, save the day in one go ----
  async function loadDay(date) {
    const d = await api('/attendance?date=' + date);
    const pending = {};
    d.players.forEach((p) => { if (p.present !== null) pending[p.id] = p.present; });
    const body = document.getElementById('att-body');
    if (!d.is_training_day) {
      body.innerHTML = `<div class="empty">اليوم ده مش يوم تدريب (التدريب أحد / تلات / خميس). تقدر تسجل حضور استثنائي برضه.</div>`;
    } else {
      body.innerHTML = '';
    }
    body.insertAdjacentHTML('beforeend', playerRows(d.players));
    body.insertAdjacentHTML('beforeend', `
      <div class="btn-row">
        <button class="btn block" id="save-day">💾 حفظ حضور اليوم</button>
      </div>
      <p class="note" id="att-count" style="margin-top:6px"></p>
      ${fullRole && d.is_training_day ? `
      <div class="btn-row">
        <button class="btn secondary block" id="close-day">إغلاق اليوم وتجهيز رسائل الغياب</button>
      </div>
      <p class="note" style="margin-top:8px">زر الإغلاق بيجهز مسودة رسالة لكل لاعب غائب - الرسائل بتتراجع وتتبعت بإيدك من شاشة الرسائل.</p>` : ''}`);
    function refreshCount() {
      const vals = Object.values(pending);
      const nPresent = vals.filter((v) => v === true).length;
      const nAbsent = vals.filter((v) => v === false).length;
      document.getElementById('att-count').textContent =
        `مسجل لحد دلوقتي: ${nPresent} حاضر - ${nAbsent} غائب - من ${d.players.length} لاعب`;
    }
    refreshCount();
    body.querySelectorAll('.toggle-pill button').forEach((btn) => {
      btn.onclick = () => {
        const pid = btn.dataset.pid;
        pending[pid] = btn.dataset.val === '1';
        const pill = btn.closest('.list-item');
        pill.querySelectorAll('.toggle-pill button').forEach((x) => x.classList.remove('on-present', 'on-absent'));
        btn.classList.add(btn.dataset.val === '1' ? 'on-present' : 'on-absent');
        let clr = pill.querySelector('.att-clear');
        if (!clr) {
          pill.insertAdjacentHTML('beforeend', `<button class="btn gray small att-clear" data-pid="${pid}" title="مسح التسجيل">✕</button>`);
          bindClear(pill.querySelector('.att-clear'));
        }
        refreshCount();
      };
    });
    function bindClear(btn) {
      btn.onclick = () => {
        const pid = btn.dataset.pid;
        pending[pid] = null; // will be cleared on save
        const pill = btn.closest('.list-item');
        pill.querySelectorAll('.toggle-pill button').forEach((x) => x.classList.remove('on-present', 'on-absent'));
        btn.remove();
        refreshCount();
      };
    }
    body.querySelectorAll('.att-clear').forEach(bindClear);
    document.getElementById('save-day').onclick = async () => {
      const marks = Object.entries(pending).map(([pid, v]) => ({ player_id: Number(pid), present: v }));
      const nPresent = marks.filter((m) => m.present === true).length;
      const nAbsent = marks.filter((m) => m.present === false).length;
      if (!marks.length) { toast('سجل حاضر/غائب للاعبين الأول'); return; }
      if (!confirm(`تأكيد حفظ حضور يوم ${date}؟\nحاضر: ${nPresent} - غائب: ${nAbsent}`)) return;
      const r = await api('/attendance/bulk', { body: { date, marks } });
      toast(`اتحفظ اليوم ✅ (${r.present} حاضر - ${r.absent} غائب)`);
      loadDay(date);
    };
    const closeBtn = document.getElementById('close-day');
    if (closeBtn) closeBtn.onclick = async () => {
      const r = await api('/attendance/close', { body: { date } });
      toast(`اتجهزت ${r.absence_drafts_created} رسالة غياب`);
    };
  }
  function playerRows(players) {
    if (!players.length) return '<div class="empty">مفيش لاعبين</div>';
    return players.map((p) => `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">${esc(p.age_group || '')}</div>
        </div>
        <div class="toggle-pill">
          <button data-pid="${p.id}" data-val="1" class="${p.present === true ? 'on-present' : ''}">حاضر</button>
          <button data-pid="${p.id}" data-val="0" class="${p.present === false ? 'on-absent' : ''}">غائب</button>
        </div>
        ${p.present !== null ? `<button class="btn gray small att-clear" data-pid="${p.id}" title="مسح التسجيل">✕</button>` : ''}
      </div>`).join('');
  }

  // ---- month view: training days, absentees, per-player attendance days ----
  async function loadMonth(month) {
    const m = await api('/attendance/month?month=' + month);
    document.getElementById('month-body').innerHTML = `
      <h2 class="section">أيام التدريب (أحد / تلات / خميس)</h2>
      ${trainingDayRows(m.training_days)}
      <h2 class="section">الغائبين خلال الشهر</h2>
      ${absenteeRows(m.absentees)}
      <h2 class="section">أيام حضور كل لاعب</h2>
      ${m.players.length ? m.players.map((p) => `
        <div class="list-item" style="cursor:default">
          <div class="grow"><div class="name">${esc(p.name)}</div></div>
          <span class="badge active">حضر ${p.present_days}</span>
          ${p.absent_days ? `<span class="badge expired">غاب ${p.absent_days}</span>` : ''}
        </div>`).join('') : '<div class="empty">مفيش لاعبين</div>'}`;
  }

  await loadDay(today);
  document.getElementById('att-date').onchange = (e) => loadDay(e.target.value);
  document.getElementById('att-monthpick').onchange = (e) => loadMonth(e.target.value);
}

// ---------------- Messages ----------------
async function renderMessages() {
  pageTitle.textContent = 'الرسائل';
  app.innerHTML = `
    <div class="tabs">
      <button data-tab="draft" class="active">مسودات جاهزة</button>
      <button data-tab="sent">اتبعتت</button>
      <button data-tab="dismissed">متجاهلة</button>
    </div>
    <div id="msg-list"></div>`;
  async function load(status) {
    const rows = await api('/messages?status=' + status);
    const list = document.getElementById('msg-list');
    list.innerHTML = rows.length ? rows.map((m) => `
      <div class="card msg-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="name" style="font-weight:700">${esc(m.player_name)}</div>
          <span class="msg-type">${MSG_TYPES[m.type] || m.type}</span>
        </div>
        <div class="sub" style="font-size:12px;color:var(--muted)">ولي الأمر: ${esc(m.parent_name || '-')} • ${esc(m.parent_phone || '-')}</div>
        <div class="body">${esc(m.body)}</div>
        ${status === 'draft' ? `
        <div class="btn-row">
          ${m.wa_link ? `<a class="btn small wa-send" data-id="${m.id}" href="${m.wa_link}" target="_blank" rel="noopener">فتح في واتساب ✈️</a>` : ''}
          <button class="btn small secondary" data-act="sent" data-id="${m.id}">تم الإرسال</button>
          <button class="btn small gray" data-act="dismiss" data-id="${m.id}">تجاهل</button>
        </div>` : ''}
      </div>`).join('') : '<div class="empty">مفيش رسائل هنا</div>';
    list.querySelectorAll('button[data-act]').forEach((b) => {
      b.onclick = async () => {
        await api(`/messages/${b.dataset.id}/${b.dataset.act}`);
        toast(b.dataset.act === 'sent' ? 'اتعلمت كمُرسلة ✅' : 'اتجاهلت');
        load(status);
      };
    });
    list.querySelectorAll('a.wa-send').forEach((a) => {
      a.addEventListener('click', async () => {
        // human pressed send in WhatsApp; mark as sent after opening
        await api(`/messages/${a.dataset.id}/sent`).catch(() => {});
        setTimeout(() => load(status), 800);
      });
    });
  }
  await load('draft');
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      load(b.dataset.tab);
    };
  });
}

// ---------------- Settings ----------------
async function renderSettings() {
  pageTitle.textContent = 'الإعدادات';
  const s = await api('/settings');
  const days = JSON.parse(s.training_days);
  const DAY_NAMES = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
  app.innerHTML = `
    <div class="card">
      <h2 class="section" style="margin-top:0">أيام التدريب</h2>
      <div class="checks">
        ${DAY_NAMES.map((d, i) => `<label><input type="checkbox" data-day="${i}" ${days.includes(i) ? 'checked' : ''}/> ${d}</label>`).join('')}
      </div>
      <label>فترة السماح (أيام)</label><input id="st-grace" type="number" min="0" value="${esc(s.grace_days)}" />
      <label>مدة الاشتراك الافتراضية (شهور)</label><input id="st-months" type="number" min="1" value="${esc(s.sub_months)}" />
      <label>قيمة الاشتراك الافتراضية (جنيه)</label><input id="st-amount" type="number" min="0" value="${esc(s.sub_amount)}" />
      <label>اسم الأكاديمية</label><input id="st-academy" value="${esc(s.academy_name)}" />
    </div>
    <div class="card">
      <h2 class="section" style="margin-top:0">قوالب الرسائل</h2>
      <p class="note">المتغيرات المتاحة: {player} {parent} {academy} {amount} {end_date} {days} {grace}</p>
      <label>تأكيد الاشتراك</label><textarea id="st-t1">${esc(s.tpl_payment)}</textarea>
      <label>تنبيه الغياب</label><textarea id="st-t2">${esc(s.tpl_absence)}</textarea>
      <label>تذكير قبل الانتهاء بـ 7 أيام</label><textarea id="st-t3">${esc(s.tpl_reminder_7d)}</textarea>
      <label>يوم الانتهاء</label><textarea id="st-t4">${esc(s.tpl_due)}</textarea>
      <label>متأخر (فترة السماح)</label><textarea id="st-t5">${esc(s.tpl_overdue)}</textarea>
    </div>
    <button class="btn block" id="st-save">حفظ الإعدادات</button>
    <div class="card" style="margin-top:10px">
      <h2 class="section" style="margin-top:0">المستخدمون</h2>
      <div id="users-list"></div>
      <label>اسم مستخدم جديد</label><input id="u-name" />
      <label>كلمة السر</label><input id="u-pass" type="password" />
        <label>الدور</label>
        <select id="u-role">
          <option value="coach">مدرب (مجموعته بس)</option>
          <option value="manager">صلاحية كاملة</option>
          <option value="staff">الجهاز فقط</option>
        </select>
        <label>المجموعة (للمدربين)</label>
        <select id="u-squad">
          <option value="">-</option>
          <option>كيدز 2019-2021</option>
          <option>2017-2018</option>
          <option>2015-2016</option>
          <option>2013-2014</option>
          <option>حراس</option>
        </select>
      <div class="btn-row">
        <button class="btn secondary" id="u-add">إضافة مستخدم</button>
        <button class="btn gray" id="logout-btn">تسجيل خروج</button>
      </div>
      <p class="note" style="margin-top:6px">إضافة المستخدمين متاحة لحساب المدير (admin) بس.</p>
    </div>
    <div class="card">
      <h2 class="section" style="margin-top:0">تغيير كلمة السر بتاعتي</h2>
      <label>كلمة السر الحالية</label><input id="pw-cur" type="password" />
      <label>كلمة السر الجديدة (6 حروف على الأقل)</label><input id="pw-new" type="password" />
      <button class="btn secondary" id="pw-save">تغيير كلمة السر</button>
    </div>`;
  async function loadUsers() {
    try {
      const users = await api('/users');
      document.getElementById('users-list').innerHTML = users.map((u) =>
        `<div class="kv"><span class="k">${esc(u.username)}</span><span>${u.role === 'admin' ? 'مدير' : 'موظف'}</span></div>`).join('');
    } catch (e) { /* not admin or load issue */ }
  }
  await loadUsers();
  document.getElementById('u-add').onclick = async () => {
    try {
      await api('/users', { body: {
        username: document.getElementById('u-name').value,
        password: document.getElementById('u-pass').value
      }});
      toast('اتضاف المستخدم ✅');
      loadUsers();
    } catch (e) { toast(e.message); }
  };
  document.getElementById('pw-save').onclick = async () => {
    try {
      await api('/password', { body: {
        current_password: document.getElementById('pw-cur').value,
        new_password: document.getElementById('pw-new').value
      }});
      toast('اتغيرت كلمة السر ✅');
    } catch (e) { toast(e.message); }
  };
  document.getElementById('logout-btn').onclick = async () => {
    await api('/logout');
    renderLogin();
  };
  document.getElementById('st-save').onclick = async () => {
    const training = [...document.querySelectorAll('input[data-day]:checked')].map((c) => +c.dataset.day);
    await api('/settings', { method: 'PUT', body: {
      training_days: JSON.stringify(training),
      grace_days: document.getElementById('st-grace').value,
      sub_months: document.getElementById('st-months').value,
      sub_amount: document.getElementById('st-amount').value,
      academy_name: document.getElementById('st-academy').value,
      tpl_payment: document.getElementById('st-t1').value,
      tpl_absence: document.getElementById('st-t2').value,
      tpl_reminder_7d: document.getElementById('st-t3').value,
      tpl_due: document.getElementById('st-t4').value,
      tpl_overdue: document.getElementById('st-t5').value
    }});
    toast('اتحفظت الإعدادات ✅');
  };
}

// ---------------- Router ----------------
// ---------------- Expenses & finance ----------------
async function renderExpenses() {
  pageTitle.textContent = 'المصاريف والمالية';
  const f = await api('/finance');
  const today = todayLocal();
  app.innerHTML = `
    <div class="grid">
      <div class="card stat"><div class="num">${f.revenue_month}</div><div class="lbl">إيرادات الشهر</div></div>
      <div class="card stat"><div class="num">${f.expenses_month}</div><div class="lbl">مصاريف الشهر</div></div>
      <div class="card stat"><div class="num">${f.revenue_year}</div><div class="lbl">محصلة السنة</div></div>
      <div class="card stat"><div class="num">${f.expenses_year}</div><div class="lbl">مصاريف السنة</div></div>
    </div>
    <div class="card" style="text-align:center">
      <div class="lbl" style="color:var(--muted);font-size:13px">صافي السنة</div>
      <div class="num" style="font-size:30px;font-weight:800;color:${f.net_year >= 0 ? 'var(--green-dark)' : 'var(--red)'}">${f.net_year} جنيه</div>
      <div class="note">صافي الشهر: ${f.net_month} جنيه</div>
    </div>
    <h2 class="section">تسجيل مصروف</h2>
    <div class="card">
      <label>البيان</label><input id="e-title" placeholder="مثال: إيجار الملعب" />
      <label>النوع</label>
      <select id="e-cat"><option>إيجار</option><option>مرتبات</option><option>معدات</option><option>أخرى</option></select>
      <label>المبلغ (جنيه)</label><input id="e-amount" type="number" min="0" />
      <label>التاريخ</label><input id="e-date" type="date" value="${today}" />
      <button class="btn block" id="e-save">حفظ المصروف</button>
    </div>
    <h2 class="section">آخر المصاريف</h2>
    <div id="exp-list"></div>`;
  async function loadExp() {
    const rows = await api('/expenses');
    document.getElementById('exp-list').innerHTML = rows.length ? rows.map((e) => `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${esc(e.title)}</div>
          <div class="sub">${esc(e.category)} - ${e.date}</div>
        </div>
        <span class="badge expired">${e.amount} ج</span>
        <button class="btn gray small exp-del" data-id="${e.id}">✕</button>
      </div>`).join('') : '<div class="empty">مفيش مصاريف مسجلة</div>';
    document.querySelectorAll('.exp-del').forEach((b) => {
      b.onclick = async () => {
        await api('/expenses/' + b.dataset.id, { method: 'DELETE' });
        toast('اتمسح المصروف');
        renderExpenses();
      };
    });
  }
  document.getElementById('e-save').onclick = async () => {
    await api('/expenses', { body: {
      title: document.getElementById('e-title').value,
      category: document.getElementById('e-cat').value,
      amount: document.getElementById('e-amount').value,
      date: document.getElementById('e-date').value
    }});
    toast('اتسجل المصروف ✅');
    renderExpenses();
  };
  await loadExp();
}

// ---------------- Staff (الجهاز الفني والإداري) ----------------
const STAFF_STATUS = { present: 'حاضر', absent: 'غائب', late: 'متأخر' };
async function renderStaff() {
  pageTitle.textContent = 'الجهاز الفني والإداري';
  const today = todayLocal();
  app.innerHTML = `
    <input type="date" id="st-date" value="${today}" />
    <div id="staff-body"></div>
    <div id="staff-month"></div>
    <div id="staff-add"></div>`;
  // ملخص الشهر لكل عضو جهاز: حضور/غياب/تأخير + مدة التأخير بالدقائق
  try {
    const sm = await api('/staff/month');
    document.getElementById('staff-month').innerHTML = `
      <h2 class="section">ملخص الشهر - الجهاز (حضور / غياب / مدة التأخير)</h2>
      ${sm.staff.map((s) => `
        <div class="list-item" style="cursor:default">
          <div class="grow">
            <div class="name">${esc(s.name)}</div>
            <div class="sub">${esc(s.role)}${s.squad ? ' - ' + esc(s.squad) : ''}</div>
          </div>
          <span class="badge active">✅ ${s.present}</span>
          <span class="badge expired">❌ ${s.absent}</span>
          <span class="badge grace">⏰ ${s.late_minutes} د (${s.late})</span>
        </div>`).join('')}`;
  } catch (e) {}
  const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager');
  async function load(date) {
    const d = await api('/staff?date=' + date);
    document.getElementById('staff-body').innerHTML = d.staff.length ? d.staff.map((m) => `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${esc(m.name)}</div>
          <div class="sub">${esc(m.role)}${m.squad ? ' - ' + esc(m.squad) : ''}${m.status === 'late' && m.late_minutes ? ` - متأخر ${m.late_minutes} دقيقة` : ''}</div>
        </div>
        ${canEdit ? `
        <div class="toggle-pill">
          <button data-sid="${m.id}" data-val="present" class="${m.status === 'present' ? 'on-present' : ''}">حاضر</button>
          <button data-sid="${m.id}" data-val="absent" class="${m.status === 'absent' ? 'on-absent' : ''}">غائب</button>
          <button data-sid="${m.id}" data-val="late" class="${m.status === 'late' ? 'on-late' : ''}">متأخر</button>
        </div>
        ${m.status ? `<button class="btn gray small staff-clear" data-sid="${m.id}">✕</button>` : ''}` :
        (m.status ? `<span class="badge ${m.status === 'present' ? 'active' : m.status === 'late' ? 'grace' : 'expired'}">${m.status === 'present' ? 'حاضر' : m.status === 'late' ? 'متأخر' : 'غائب'}</span>` : '<span class="note">-</span>')}
      </div>`).join('') : '<div class="empty">مفيش أعضاء جهاز</div>';
    if (canEdit) {
      document.querySelectorAll('#staff-body .toggle-pill button').forEach((b) => {
        b.onclick = async () => {
          const body = { staff_id: b.dataset.sid, date, status: b.dataset.val };
          if (b.dataset.val === 'late') {
            const mins = prompt('اتأخر كام دقيقة؟', '15');
            if (mins === null) return;
            body.late_minutes = parseInt(mins, 10) || 0;
          }
          await api('/staff-attendance', { body });
          load(date);
        };
      });
      document.querySelectorAll('.staff-clear').forEach((b) => {
        b.onclick = async () => {
          await api('/staff-attendance', { body: { staff_id: b.dataset.sid, date, status: null } });
          toast('اتمسح التسجيل');
          load(date);
        };
      });
    }
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager')) {
      document.getElementById('staff-add').innerHTML = `
        <h2 class="section">إضافة عضو جهاز</h2>
        <div class="card">
          <label>الاسم</label><input id="ns-name" />
          <label>الدور</label><input id="ns-role" placeholder="مدرب / إداري / ..." />
          <label>المجموعة (اختياري)</label>
          <select id="ns-squad"><option value="">-</option><option>كيدز 2019-2021</option><option>2017-2018</option><option>2015-2016</option><option>2013-2014</option><option>حراس</option></select>
          <button class="btn block" id="ns-save">إضافة</button>
        </div>`;
      document.getElementById('ns-save').onclick = async () => {
        await api('/staff', { body: {
          name: document.getElementById('ns-name').value,
          role: document.getElementById('ns-role').value,
          squad: document.getElementById('ns-squad').value || null
        }});
        toast('اتضاف ✅');
        renderStaff();
      };
    }
  }
  await load(today);
  document.getElementById('st-date').onchange = (e) => load(e.target.value);
}

const routes = {
  '/': renderDashboard,
  '/players': renderPlayers,
  '/attendance': renderAttendance,
  '/messages': renderMessages,
  '/expenses': renderExpenses,
  '/staff': renderStaff,
  '/settings': renderSettings
};
async function route() {
  let me;
  try {
    me = await api('/me');
  } catch (e) {
    return; // renderLogin already shown by api()
  }
  currentUser = me;
  applyRoleNav();
  document.body.classList.remove('login-mode');
  document.getElementById('bottomnav').style.display = '';
  const hash = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('#bottomnav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === hash || (hash.startsWith('/player/') && a.dataset.route === '/players'));
  });
  try {
    const allowed = NAV_RULES[currentUser.role];
    if (allowed && !allowed.includes(hash) && !hash.startsWith('/player/')) {
      location.hash = '#' + allowed[0];
      return;
    }
    const m = hash.match(/^\/player\/(\d+)$/);
    if (m) await renderPlayer(m[1]);
    else await (routes[hash] || renderDashboard)();
  } catch (e) {
    app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
route();
