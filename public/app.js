// United Academy admin - single page app (no build step).
const app = document.getElementById('app');
let currentUser = null;
const NAV_RULES = {
  coach: ['/', '/players', '/attendance', '/my-att'],
  staff: ['/more', '/staff']
};
function applyRoleNav() {
  const allowed = currentUser && NAV_RULES[currentUser.role];
  document.querySelectorAll('#bottomnav a').forEach((a) => {
    // "حضوري" للمدرب بس - الإدارة عندها شاشة الجهاز وتقرير الشهر
    const myAttHidden = currentUser && currentUser.role !== 'coach' && a.dataset.route === '/my-att';
    a.style.display = (myAttHidden || (allowed && !allowed.includes(a.dataset.route))) ? 'none' : '';
  });
}
const pageTitle = document.getElementById('page-title');
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));

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
  overdue: 'تجديد متأخر',
  birthday: 'تهنئة عيد ميلاد'
};

function stateBadge(p) {
  if (p.sub_state === null || p.sub_state === undefined) return ''; // مخفي عن المدرب
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
// Announcement helpers: WhatsApp text + clipboard copy.
function annWaText(a) {
  const lines = ['📢 إعلان من يونايتد أكاديمي', a.kind + (a.event_date ? ' - يوم ' + a.event_date : '')];
  if (a.details) lines.push(a.details);
  lines.push('للاستفسار: 01030441104');
  return lines.join('\n');
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  const ta = document.createElement('textarea');
  ta.value = t; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); ta.remove();
  return Promise.resolve();
}
function announcementCard(a, withCopy) {
  return `<div class="list-item" style="cursor:default">
    <div class="grow">
      <div class="name">📢 ${esc(a.kind)}${a.event_date ? ' - ' + esc(a.event_date) : ''}</div>
      <div class="sub">${esc(a.details || '')}${a.created_by ? ' • ' + esc(a.created_by) : ''}</div>
    </div>
    ${withCopy ? `<button class="btn small" data-ann-copy="${a.id}">📋 نسخ رسالة واتساب</button>` : ''}
  </div>`;
}

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
    ${(d.announcements && d.announcements.length) ? '<h2 class="section">📢 إعلانات الأكاديمي</h2>' + d.announcements.map((a) => announcementCard(a, false)).join('') : ''}
    ${(d.birthdays_week && d.birthdays_week.length) ? '<h2 class="section">🎂 أعياد ميلاد الأسبوع في مجموعتك (' + d.birthdays_week.length + ')</h2>' + d.birthdays_week.map((p) => `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">هيكمل ${p.turns} سنة يوم ${p.date_this_year}</div>
        </div>
        <button class="btn small" data-bday-wa="${p.id}">🎉 جهز تهنئة</button>
      </div>`).join('') : ''}
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
        const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
        document.getElementById('my-att').innerHTML = `
          <h2 class="section">حضوري وتأخيري كل شهر (السنة دي)</h2>
          ${(mine.months || []).length ? mine.months.map((mo) => `
            <div class="list-item" style="cursor:default">
              <div class="grow">
                <div class="name">${AR_MONTHS[Number(mo.ym.slice(5)) - 1]} ${mo.ym.slice(0, 4)}</div>
                <div class="sub">✅ حضور ${mo.present} يوم${mo.absent ? ' • ❌ غياب ' + mo.absent : ''}${mo.late ? ' • ⏰ تأخير ' + mo.late + ' (' + mo.late_minutes + ' د)' : ''}</div>
              </div>
            </div>`).join('') : '<div class="empty">لسه مفيش تسجيل السنة دي</div>'}
          <h2 class="section">حضوري أنا الشهر ده بالتفصيل</h2>
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
    document.querySelectorAll('[data-bday-wa]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        const r = await api('/messages/birthday/' + btn.dataset.bdayWa, {});
        toast(r.created ? 'التهنئة جاهزة - هتتفتح في واتساب ابعتها بنفسك 🎉' : 'التهنئة متجهزة قبل كده');
        if (r.wa_link) window.open(r.wa_link, '_blank', 'noopener');
        btn.disabled = false;
      };
    });
    return;
  }
  window.toggleDashList = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const opening = el.style.display === 'none';
    el.style.display = opening ? '' : 'none';
    if (opening) el.scrollIntoView({ behavior: 'smooth' });
  };
  app.innerHTML = hero + `
    <div class="grid">
      <div class="card stat"><div class="num">${d.players_total}</div><div class="lbl">لاعب مسجل</div></div>
      <div class="card stat"><div class="num">${d.subs_active}</div><div class="lbl">اشتراك ساري</div></div>
      <div class="card stat" style="cursor:pointer" onclick="toggleDashList('renew-next-list')"><div class="num">${d.renew_next_month}</div><div class="lbl">لاعب هيجددوا الشهر الجاي 🔄</div></div>
      <div class="card stat" style="cursor:pointer" onclick="document.getElementById('late-list').scrollIntoView({behavior:'smooth'})"><div class="num">${d.late_unpaid}</div><div class="lbl">متأخرين في الدفع ⚠️</div></div>
      <div class="card stat"><div class="num">${fmt(d.collected_month)}</div><div class="lbl">${d.payments_month === null ? 'التحصيلات (غير متاحة لهذا الحساب)' : 'جنيه محصلة الشهر ده (' + d.payments_month + ' دفعة)'}</div></div>
      <div class="card stat" style="cursor:pointer" onclick="toggleDashList('dropout-list')"><div class="num">${d.dropout_year}</div><div class="lbl">لاعب منقطع خلال 3 شهور (الشهر ده: ${d.dropout_month})</div></div>
      <div class="card stat" style="cursor:pointer" onclick="toggleDashList('bday-month-list')"><div class="num">${d.birthdays_month.length}</div><div class="lbl">عيد ميلاد الشهر ده 🎂</div></div>
      <div class="card stat" style="cursor:pointer" onclick="toggleDashList('top-att-list')"><div class="num">${d.top_attendance.length ? d.top_attendance[0].pct + '%' : '0'}</div><div class="lbl">أعلى نسبة حضور الشهر ده ✅</div></div>
    </div>
    <div id="bday-month-list" style="display:none">
    <h2 class="section">🎂 أعياد ميلاد الشهر ده (${d.birthdays_month.length})</h2>
    ${d.birthdays_month.length ? d.birthdays_month.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">يوم ${p.day} في الشهر${p.parent_name ? ' • ولي الأمر: ' + esc(p.parent_name) : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">مفيش أعياد ميلاد الشهر ده</div>'}
    </div>
    <div id="top-att-list" style="display:none">
    <h2 class="section">✅ الأكثر حضورًا الشهر ده (من ${d.top_attendance.length ? d.top_attendance[0].sessions : 0} حصة)</h2>
    ${d.top_attendance.length ? d.top_attendance.map((p, i) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${i + 1}. ${esc(p.name)}</div>
          <div class="sub">حضر ${p.present} من ${p.sessions} حصة</div>
        </div>
        <span class="badge active">${p.pct}%</span>
      </div>`).join('') : '<div class="empty">لسه مفيش حضور متسجل الشهر ده</div>'}
    </div>
    <div id="coaches-box"></div>
    <h2 class="section" id="late-list">تجديدات مستنية (خلال 7 أيام أو متأخرة)</h2>
    ${d.renewals_due.length ? d.renewals_due.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">ينتهي ${p.end_date}</div>
        </div>
        ${stateBadge({ sub_state: p.sub_state, days_left: p.days_left })}
      </div>`).join('') : '<div class="empty">مفيش تجديدات قريبة 👌</div>'}
    <div id="renew-next-list" style="display:none">
    <h2 class="section">🔄 اللي هيجددوا الشهر الجاي (${d.renew_next_list.length})</h2>
    ${d.renew_next_list.length ? d.renew_next_list.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">اشتراكه بينتهي ${p.end_date}${p.parent_phone ? ` • <a href="tel:${esc(p.parent_phone)}" onclick="event.stopPropagation()">${esc(p.parent_phone)}</a>` : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">مفيش تجديدات الشهر الجاي 👌</div>'}
    </div>
    <div id="dropout-list" style="display:none">
    <h2 class="section">🚶 اللاعبين المنقطعين (آخر حضور من 14+ يوم)</h2>
    ${d.dropouts_list.length ? d.dropouts_list.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">آخر حضور ${p.last_present} (من ${p.since_days} يوم)${p.parent_phone ? ` • <a href="tel:${esc(p.parent_phone)}" onclick="event.stopPropagation()">${esc(p.parent_phone)}</a>` : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">مفيش لاعبين منقطعين 👌</div>'}
    </div>
    <h2 class="section">⚠️ اشتراكات معرضة للتوقف (${d.at_risk.length})</h2>
    ${d.at_risk.length ? d.at_risk.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}${p.squad ? ' - ' + esc(p.squad) : ''}</div>
          <div class="sub">${p.reasons.map(esc).join(' • ')}${p.parent_phone ? ` • <a href="tel:${esc(p.parent_phone)}" onclick="event.stopPropagation()">${esc(p.parent_phone)}</a>` : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">مفيش اشتراكات في خطر 👌</div>'}
    <h2 class="section">🎂 أعياد ميلاد الأسبوع (${d.birthdays_week.length})</h2>
    ${d.birthdays_week.length ? d.birthdays_week.map((p) => `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${esc(p.name)}${p.squad ? ' - ' + esc(p.squad) : ''}</div>
          <div class="sub">هيكمل ${p.turns} سنة يوم ${p.date_this_year}</div>
        </div>
        <button class="btn small" data-bday="${p.id}">🎉 جهز تهنئة</button>
      </div>`).join('') : '<div class="empty">مفيش أعياد ميلاد الأسبوع ده</div>'}
    <h2 class="section">📢 إعلان تغيير التمرين والإعلانات</h2>
    <div class="list-item" style="cursor:default">
      <div class="grow" style="display:flex; flex-direction:column; gap:8px">
        <select id="ann-kind">
          <option>إلغاء تمرين</option><option>تغيير ميعاد</option><option>تغيير ملعب</option>
          <option>مباراة ودية</option><option>تجمع</option><option>بطولة</option><option>أخرى</option>
        </select>
        <input type="date" id="ann-date" />
        <input type="text" id="ann-details" placeholder="مثال: تمرين الخميس هيبقى الساعة 6 بدل 5 بسبب الحر" />
        <button class="btn small" id="ann-add">📢 أضف إعلان</button>
      </div>
    </div>
    ${(d.announcements || []).map((a) => announcementCard(a, true)).join('') || '<div class="empty">مفيش إعلانات لسه</div>'}
    <div class="btn-row">
      <a class="btn secondary" href="#/messages">الرسائل الجاهزة (${d.draft_messages})</a>
      <button class="btn" id="gen-btn">تحديث التذكيرات</button>
    </div>`;
  document.getElementById('gen-btn').onclick = async () => {
    const r = await api('/messages/generate', {});
    toast(`اتعمل ${r.renewals} تذكير جديد`);
    renderDashboard();
  };
  document.getElementById('ann-add').onclick = async () => {
    const details = document.getElementById('ann-details').value.trim();
    if (!details) { toast('اكتب تفاصيل الإعلان'); return; }
    await api('/announcements', { body: {
      kind: document.getElementById('ann-kind').value,
      event_date: document.getElementById('ann-date').value || null,
      details
    } });
    toast('الإعلان اتنشر 📢');
    renderDashboard();
  };
  document.querySelectorAll('[data-ann-copy]').forEach((btn) => {
    btn.onclick = async () => {
      const a = (d.announcements || []).find((x) => String(x.id) === btn.dataset.annCopy);
      if (!a) return;
      await copyText(annWaText(a));
      toast('رسالة الواتساب اتنسخت - ابعتها من واتساب الأكاديمي 📋');
    };
  });
  document.querySelectorAll('[data-bday]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const r = await api('/messages/birthday/' + btn.dataset.bday, {});
      toast(r.created ? 'التهنئة جاهزة في شاشة الرسائل 📝' : 'التهنئة متجهزة قبل كده');
      if (!r.created) btn.disabled = false;
    };
  });

  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager')) {
    try {
      const f = await api('/finance');
      document.querySelector('.grid').insertAdjacentHTML('beforeend', `
        <div class="card stat"><div class="num">${fmt(f.expenses_month)}</div><div class="lbl">مصاريف الشهر</div></div>
        <div class="card stat"><div class="num">${fmt(f.expenses_year)}</div><div class="lbl">مصاريف السنة</div></div>
        ${f.net_year === null ? '' : `<div class="card stat"><div class="num" style="color:${f.net_year >= 0 ? 'var(--green-dark)' : 'var(--red)'}">${f.net_year}</div><div class="lbl">صافي السنة</div></div>`}`);
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
        <h2 class="section">المنقطعين عن التدريب (${m.dropout_year} لاعب)</h2>
        ${dropoutRows(m.dropouts)}
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
    ${currentUser && currentUser.role !== 'coach' ? `
    <div id="p-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <button class="btn small" data-chip="">الكل</button>
      <button class="btn small gray" data-chip="active">نشط</button>
      <button class="btn small gray" data-chip="grace">فترة سماح</button>
      <button class="btn small gray" data-chip="expired">منتهي</button>
    </div>` : ''}
    <div id="players-list"></div>`;
  const list = document.getElementById('players-list');
  let chipState = '';
  document.querySelectorAll('#p-chips [data-chip]').forEach((b) => {
    b.onclick = () => {
      chipState = b.dataset.chip;
      document.querySelectorAll('#p-chips [data-chip]').forEach((x) => x.classList.toggle('gray', x !== b));
      load(document.getElementById('search').value.trim());
    };
  });
  function chipCounts(rows) {
    const c = { '': rows.length, active: 0, grace: 0, expired: 0 };
    rows.forEach((p) => { if (c[p.sub_state] !== undefined) c[p.sub_state]++; });
    document.querySelectorAll('#p-chips [data-chip]').forEach((b) => {
      const k = b.dataset.chip;
      b.textContent = b.textContent.replace(/\s*\(\d+\)$/, '') + ' (' + c[k] + ')';
    });
  }
  async function load(q) {
    let rows = await api('/players' + (q ? `?search=${encodeURIComponent(q)}` : ''));
    if (!q) chipCounts(rows);
    if (chipState) rows = rows.filter((p) => p.sub_state === chipState);
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
    <label>تاريخ الميلاد</label><input id="f-birth" type="date" />
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
        birth_date: document.getElementById('f-birth').value || null,
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
  const fullRole = currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager');
  const p = await api('/players/' + id);
  const hideSub = p.sub_state === null; // المدرب: من غير أي حاجة عن الاشتراك
  app.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="name" style="font-size:18px;font-weight:800">${esc(p.name)}</div>
        ${stateBadge(p)}
      </div>
      <div class="kv"><span class="k">المجموعة</span><span>${esc(p.age_group || '-')}</span></div>
      <div class="kv"><span class="k">ولي الأمر</span><span>${esc(p.parent_name || '-')}</span></div>
      <div class="kv"><span class="k">واتساب</span><span>${esc(p.parent_phone || '-')}</span></div>
      <div class="kv"><span class="k">تاريخ الميلاد</span><span>${esc(p.birth_date || '-')}</span></div>
      ${p.membership_no ? `<div class="kv"><span class="k">رقم العضوية (نادي المستقبل)</span><span>${esc(p.membership_no)}</span></div>` : ''}
      ${hideSub ? '' : (p.subscription ? `
      <div class="kv"><span class="k">الاشتراك الحالي</span><span>${p.subscription.start_date} ← ${p.subscription.end_date}</span></div>
      ${p.subscription.amount !== null && p.subscription.amount !== undefined ? `<div class="kv"><span class="k">المبلغ</span><span>${fmt(p.subscription.amount)} جنيه / ${p.subscription.months} شهر</span></div>` : ''}` :
      '<div class="note" style="margin-top:6px">مفيش اشتراك مسجل لسه.</div>')}
      ${fullRole ? `<div class="btn-row">
        <button class="btn" id="renew-btn">${p.subscription ? 'تجديد اشتراك' : 'اشتراك جديد'}</button>
        <button class="btn secondary" id="edit-btn">تعديل البيانات</button>
      </div>` : ''}
    </div>
    ${hideSub ? '' : `<h2 class="section">سجل الاشتراكات</h2>
    ${p.subscriptions.length ? p.subscriptions.map((s) => `
      <div class="card"><div class="kv"><span class="k">${s.start_date} ← ${s.end_date}</span><span>${s.amount !== null && s.amount !== undefined ? `${fmt(s.amount)} جنيه (${s.months} شهر)` : 'اشتراك ' + s.months + ' شهر'}</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}`}
    ${hideSub ? '' : `<h2 class="section">مدفوعات البنود</h2>
    ${(p.payments && p.payments.length) ? p.payments.map((y) => `
      <div class="card"><div class="kv"><span class="k">${esc(y.label)}</span><span>${fmt(y.amount)} جنيه - ${y.date}</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}`}
    <h2 class="section">آخر الحضور</h2>
    ${p.attendance.length ? p.attendance.map((a) => `
      <div class="card"><div class="kv"><span class="k">${a.date}</span><span>${a.present ? '✅ حاضر' : '❌ غائب'}</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}
    ${hideSub ? '' : `<h2 class="section">الرسائل</h2>
    ${p.messages.length ? p.messages.map((m) => `
      <div class="card"><div class="kv"><span class="k">${MSG_TYPES[m.type] || m.type}</span><span>${m.status === 'sent' ? '✅ اتبعتت' : m.status === 'dismissed' ? 'اتجاهلت' : '📝 مسودة'}</span></div></div>
    `).join('') : '<div class="empty">لا يوجد</div>'}`}
    <h2 class="section">التقييم الشهري</h2>
    ${(() => {
      const curMonth = todayLocal().slice(0, 7);
      const cur = (p.evaluations || []).find((e) => e.month === curMonth);
      const past = (p.evaluations || []).filter((e) => e.month !== curMonth);
      const scoreLine = (e) => `التزام ${e.commitment || '-'}/5 • مهارة ${e.skill || '-'}/5 • لياقة ${e.fitness || '-'}/5 • سلوك ${e.behavior || '-'}/5`;
      const trend = (e, prev) => {
        if (!prev || !e.skill || !prev.skill) return '';
        const d = e.skill - prev.skill;
        return d > 0 ? ` <span class="badge active">▲ تطور +${d}</span>` : d < 0 ? ` <span class="badge expired">▼ ${d}</span>` : '';
      };
      return `
    <div class="card">
      ${cur ? `
        <div class="kv"><span class="k">تقييم ${cur.month}</span><span>${esc(cur.coach_name || '')}</span></div>
        <div style="margin-top:4px">${scoreLine(cur)}${trend(cur, past[0])}</div>
        ${cur.notes ? `<div class="sub" style="margin-top:4px">${esc(cur.notes)}</div>` : ''}` :
        '<div class="note">لسه مفيش تقييم للشهر ده</div>'}
      <div class="btn-row" style="margin-top:8px">
        <button class="btn secondary" id="ev-btn">${cur ? 'تعديل تقييم الشهر ده' : 'قيّم الشهر ده'}</button>
      </div>
    </div>
    ${past.length ? past.map((e, i) => `
      <div class="card">
        <div class="kv"><span class="k">${e.month}</span><span>${esc(e.coach_name || '')}</span></div>
        <div style="margin-top:4px">${scoreLine(e)}${trend(e, past[i + 1])}</div>
        ${e.notes ? `<div class="sub" style="margin-top:4px">${esc(e.notes)}</div>` : ''}
      </div>`).join('') : ''}`;
    })()}
    <h2 class="section">سجل التواصل مع ولي الأمر</h2>
    <div class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="cl-type" style="flex:1;min-width:120px">
          <option>غياب</option>
          <option>اشتراك</option>
          <option>سلوك</option>
          <option>شكوى أو استفسار</option>
          <option>أخرى</option>
        </select>
        <input id="cl-note" placeholder="مثال: كلمنا والده بخصوص الغياب المتكرر" style="flex:3;min-width:180px" />
        <button class="btn" id="cl-add">حفظ</button>
      </div>
    </div>
    ${p.contact_log && p.contact_log.length ? p.contact_log.map((c) => `
      <div class="card">
        <div class="kv"><span class="k">${esc(c.type)}</span><span>${esc((c.created_at || '').slice(0, 10))} • ${esc(c.staff_name || '')}</span></div>
        <div style="margin-top:4px">${esc(c.note || '')}</div>
      </div>
    `).join('') : '<div class="empty">مفيش تواصل مسجل لسه</div>'}`;
  document.getElementById('ev-btn').onclick = () => {
    const curMonth = todayLocal().slice(0, 7);
    const cur = (p.evaluations || []).find((e) => e.month === curMonth) || {};
    const opts = (v) => [1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === v ? 'selected' : ''}>${n}</option>`).join('');
    openModal(`
      <h3>تقييم ${esc(p.name)} - شهر ${curMonth}</h3>
      <label>الالتزام بالحضور</label><select id="ev-commitment"><option value="">-</option>${opts(cur.commitment)}</select>
      <label>المستوى المهاري</label><select id="ev-skill"><option value="">-</option>${opts(cur.skill)}</select>
      <label>اللياقة البدنية</label><select id="ev-fitness"><option value="">-</option>${opts(cur.fitness)}</select>
      <label>السلوك والانضباط</label><select id="ev-behavior"><option value="">-</option>${opts(cur.behavior)}</select>
      <label>ملاحظات</label><input id="ev-notes" value="${esc(cur.notes || '')}" placeholder="نقاط قوة أو حاجة محتاجة تتحسن" />
      <div class="btn-row">
        <button class="btn gray" onclick="closeModal()">إلغاء</button>
        <button class="btn" id="ev-save">حفظ التقييم</button>
      </div>`);
    document.getElementById('ev-save').onclick = async () => {
      await api(`/players/${id}/evaluation`, { body: {
        month: curMonth,
        commitment: document.getElementById('ev-commitment').value,
        skill: document.getElementById('ev-skill').value,
        fitness: document.getElementById('ev-fitness').value,
        behavior: document.getElementById('ev-behavior').value,
        notes: document.getElementById('ev-notes').value
      } });
      closeModal();
      toast('اتحفظ التقييم ✅');
      renderPlayer(id);
    };
  };
  document.getElementById('cl-add').onclick = async () => {
    const note = document.getElementById('cl-note').value.trim();
    if (!note) { toast('اكتب ملاحظة التواصل الأول'); return; }
    await api(`/players/${id}/contact`, { body: { type: document.getElementById('cl-type').value, note } });
    toast('اتسجل التواصل ✅');
    renderPlayer(id);
  };
  const renewBtn = document.getElementById('renew-btn');
  if (renewBtn) renewBtn.onclick = async () => {
    const plans = await api('/plans');
    const items = await api('/subscription-items');
    window._subItems = items;
    const planOpts = Object.entries(plans).map(([k, v]) =>
      `<option value="${k}">${v.label} - ${fmt(v.amount)} جنيه</option>`).join('');
    const itemsHtml = items.map((it) => `
      <div class="kv" style="align-items:center">
        <label style="margin:0;display:flex;align-items:center;gap:6px"><input type="checkbox" class="s-item" data-id="${it.id}" /> ${esc(it.label)}</label>
        <span><input type="number" min="0" class="s-item-amt" data-id="${it.id}" value="${it.amount || ''}" placeholder="المبلغ" style="width:100px" /> جنيه</span>
      </div>`).join('');
    openModal(`
      <h3>${p.subscription ? 'تجديد اشتراك' : 'اشتراك جديد'} - ${esc(p.name)}</h3>
      <label>تاريخ البداية</label><input id="s-start" type="date" value="${todayLocal()}" />
      <label>خطة اشتراك الأكاديمية</label>
      <select id="s-plan">
        ${planOpts}
        <option value="custom">مخصص</option>
      </select>
      <div id="s-custom" class="hidden">
        <label>المدة (شهور)</label><input id="s-months" type="number" min="1" value="1" />
        <label>المبلغ (جنيه)</label><input id="s-amount" type="number" min="0" value="700" />
      </div>
      <label style="margin-top:6px;font-weight:bold">بنود إضافية (اختياري)</label>
      ${itemsHtml}
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
      body.items = readItems('s-item', 's-item-amt').map((c) => ({ item_id: c.item_id, amount: c.amount }));
      await api(`/players/${id}/subscriptions`, { body });
      closeModal();
      toast('اتسجل الاشتراك ✅ ورسالة التأكيد في الرسائل');
      renderPlayer(id);
    };
  };
  const editBtn = document.getElementById('edit-btn');
  if (editBtn) editBtn.onclick = () => {
    openModal(`
    <h3>تعديل بيانات ${esc(p.name)}</h3>
    <label>اسم اللاعب</label><input id="e-name" value="${esc(p.name)}" />
    <label>اسم ولي الأمر</label><input id="e-parent" value="${esc(p.parent_name || '')}" />
    <label>رقم الواتساب</label><input id="e-phone" value="${esc(p.parent_phone || '')}" />
    <label>تاريخ الميلاد</label><input id="e-birth" type="date" value="${esc(p.birth_date || '')}" />
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
      birth_date: document.getElementById('e-birth').value || null,
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

function dropoutRows(dropouts) {
  if (!dropouts || !dropouts.length) return '<div class="empty">مفيش لاعبين منقطعين 👌</div>';
  return dropouts.map((p) => `
    <div class="list-item" style="cursor:default">
      <div class="grow">
        <div class="name">${esc(p.name)}${p.squad ? ' - ' + esc(p.squad) : ''}</div>
        <div class="sub">تاريخ الميلاد: ${esc(p.birth_date || '-')} • ولي الأمر: ${esc(p.parent_name || '-')} ${p.parent_phone ? `<a href="tel:${esc(p.parent_phone)}">${esc(p.parent_phone)}</a>` : ''}</div>${p.membership_no ? ` <span class="badge">عضوية مستقبل: ${esc(p.membership_no)}</span>` : ''}
      </div>
      <span class="badge expired">آخر حضور ${p.last_present} (من ${p.since_days} يوم)</span>
    </div>`).join('');
}

function dropoutBox(m) {
  return `
    <div class="grid">
      <div class="card stat"><div class="num">${m.dropout_month}</div><div class="lbl">لاعب انقطع خلال الشهر</div></div>
      <div class="card stat"><div class="num">${m.dropout_year}</div><div class="lbl">لاعب انقطع خلال 3 شهور</div></div>
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
  if (!absentees.length) return '<div class="empty">مفيش لاعبين غايبين أكتر من أسبوعين 👌</div>';
  return absentees.map((p) => `
    <div class="list-item" style="cursor:default">
      <div class="grow"><div class="name">${esc(p.name)}</div></div>
      <span class="badge expired">${p.since_days !== undefined ? 'آخر حضور من ' + p.since_days + ' يوم' : 'غاب ' + p.absent_days + ' ' + (p.absent_days === 1 ? 'يوم' : 'أيام')}</span>
    </div>`).join('');
}

async function renderAttendance() {
  pageTitle.textContent = 'الحضور';
  const today = todayLocal();
  const fullRole = currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager');
  app.innerHTML = `
    <div class="tabs">
      <button data-tab="day" class="active">تسجيل يوم</button>
      <button data-tab="pitch">الملعب دلوقتي</button>
      <button data-tab="month">ملخص الشهر</button>
    </div>
    <div id="att-day-wrap">
      <input type="date" id="att-date" value="${today}" />
      <div id="att-body"></div>
    </div>
    <div id="att-month-wrap" class="hidden">
      <input type="month" id="att-monthpick" value="${today.slice(0, 7)}" />
      <div id="month-body"></div>
    </div>
    <div id="att-pitch-wrap" class="hidden"></div>`;

  // ---- tab switching ----
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      const tab = b.dataset.tab;
      document.getElementById('att-day-wrap').classList.toggle('hidden', tab !== 'day');
      document.getElementById('att-month-wrap').classList.toggle('hidden', tab !== 'month');
      document.getElementById('att-pitch-wrap').classList.toggle('hidden', tab !== 'pitch');
      if (tab === 'month') loadMonth(document.getElementById('att-monthpick').value);
      if (tab === 'pitch') renderTrainingDay(document.getElementById('att-pitch-wrap'));
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
    body.insertAdjacentHTML('beforeend', `
      <input id="att-search" placeholder="🔍 ابحث باسم اللاعب..." style="margin-bottom:8px" />
      <div id="att-rows"></div>
      <div class="btn-row sticky-save">
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
    function bindRowEvents(container) {
      container.querySelectorAll('.toggle-pill button').forEach((btn) => {
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
      container.querySelectorAll('.att-clear').forEach(bindClear);
    }
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
    function renderRows(q) {
      const query = (q || '').trim();
      const rows = query
        ? d.players.filter((p) => p.name.includes(query))
        : d.players;
      const container = document.getElementById('att-rows');
      container.innerHTML = playerRows(rows, pending);
      if (query && !rows.length) container.innerHTML = '<div class="empty">مفيش لاعب بالاسم ده في مجموعتك</div>';
      bindRowEvents(container);
    }
    renderRows('');
    document.getElementById('att-search').oninput = (e) => renderRows(e.target.value);
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
  function playerRows(players, pending) {
    if (!players.length) return '<div class="empty">مفيش لاعبين</div>';
    return players.map((p) => {
      const cur = pending && pending[p.id] !== undefined ? pending[p.id] : p.present;
      return `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">${esc(p.age_group || '')}</div>
        </div>
        <div class="toggle-pill">
          <button data-pid="${p.id}" data-val="1" class="${cur === true ? 'on-present' : ''}">حاضر</button>
          <button data-pid="${p.id}" data-val="0" class="${cur === false ? 'on-absent' : ''}">غائب</button>
        </div>
        ${cur !== null && cur !== undefined ? `<button class="btn gray small att-clear" data-pid="${p.id}" title="مسح التسجيل">✕</button>` : ''}
      </div>`;
    }).join('');
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
      <h2 class="section" style="margin-top:0">أسعار بنود الاشتراك</h2>
      <p class="note">السعر ده بيتكتب تلقائي وقت التسجيل، ومريم/الإدارة تقدر تعدله للاعب معين من خانته. «اشتراك سفرية» سعره بيتكتب كل مرة.</p>
      <div id="items-prices"></div>
      <button class="btn block" id="st-items-save" style="margin-top:8px">حفظ أسعار البنود</button>
    </div>
    <div class="card" style="margin-top:10px">
      <h2 class="section" style="margin-top:0">أسعار خطط الأكاديمية</h2>
      <p class="note">أسعار الاشتراك (شهري / 3 شهور / 6 شهور / سنوي). أي تعديل من هنا بينطبق على التسجيل والتجديد فورًا.</p>
      <div id="plans-prices"></div>
      <button class="btn block" id="st-plans-save" style="margin-top:8px">حفظ أسعار الخطط</button>
    </div>
    <div class="card" style="margin-top:10px">
      <h2 class="section" style="margin-top:0">النسخ الاحتياطي</h2>
      <p class="note">نسخة تلقائية كل يوم الساعة 2 بالليل. الرفع على Google Drive هيشتغل بعد موافقة الإدارة على الربط - دلوقتي النسخة بتتجهز محليًا بس ومفيش أي بيانات بتسيب السيرفر.</p>
      <div id="backup-status"></div>
      <button class="btn block" id="backup-run" style="margin-top:8px">نسخة احتياطية دلوقتي</button>
    </div>
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
    await api('/logout', {});
    renderLogin();
  };
  async function loadItemPrices() {
    try {
      const items = await api('/subscription-items');
      document.getElementById('items-prices').innerHTML = items.map((it) => `
        <div class="kv" style="align-items:center"><span class="k">${esc(it.label)}${it.variable ? ' (متغير كل مرة)' : ''}</span>
        <span><input type="number" min="0" data-item-amt="${it.id}" value="${it.amount}" style="width:110px" /> جنيه</span></div>`).join('');
    } catch (e) { document.getElementById('items-prices').innerHTML = '<div class="empty">مش متاحة</div>'; }
  }
  await loadItemPrices();
  async function loadPlanPrices() {
    try {
      const plans = await api('/plans');
      document.getElementById('plans-prices').innerHTML = Object.entries(plans).map(([k, p]) => `
        <div class="kv" style="align-items:center"><span class="k">${esc(p.label)}</span>
        <span><input type="number" min="0" data-plan-amt="${k}" value="${p.amount}" style="width:110px" /> جنيه</span></div>`).join('');
    } catch (e) { document.getElementById('plans-prices').innerHTML = '<div class="empty">مش متاحة</div>'; }
  }
  await loadPlanPrices();
  document.getElementById('st-plans-save').onclick = async () => {
    try {
      const body = {};
      [...document.querySelectorAll('[data-plan-amt]')].forEach((inp) => { body[inp.dataset.planAmt] = inp.value; });
      await api('/plans', { method: 'PUT', body });
      toast('اتحفظت أسعار الخطط ✅');
      loadPlanPrices();
    } catch (e) { toast(e.message); }
  };
  async function loadBackupStatus() {
    try {
      const b = await api('/backup/status');
      document.getElementById('backup-status').innerHTML = `
        <div class="kv"><span class="k">ربط Google Drive</span><span>${b.drive_linked ? '✅ مربوط' : '⏳ مستني الموافقة على الربط'}</span></div>
        <div class="kv"><span class="k">آخر نسخة</span><span>${b.last_at ? esc(b.last_at) : 'لسه مفيش'}</span></div>
        ${b.last_result ? `<div class="kv"><span class="k">النتيجة</span><span>${esc(b.last_result)}</span></div>` : ''}`;
    } catch (e) { document.getElementById('backup-status').innerHTML = '<div class="empty">مش متاحة</div>'; }
  }
  await loadBackupStatus();
  document.getElementById('backup-run').onclick = async () => {
    try {
      const r = await api('/backup/run', { method: 'POST' });
      toast(r.skipped ? ('اتجهزت النسخة محليًا - ' + (r.reason || '')) : 'اتعملت النسخة الاحتياطية ✅');
      loadBackupStatus();
    } catch (e) { toast(e.message); }
  };
  document.getElementById('st-items-save').onclick = async () => {
    try {
      const inputs = [...document.querySelectorAll('[data-item-amt]')];
      for (const inp of inputs) {
        await api('/subscription-items/' + inp.dataset.itemAmt, { method: 'PUT', body: { amount: inp.value } });
      }
      toast('اتحفظت أسعار البنود ✅');
      loadItemPrices();
    } catch (e) { toast(e.message); }
  };
  // أكورديون: كل كارت إعدادات يتفتح ويتقفل من عنوانه
  app.querySelectorAll(':scope > .card').forEach((card, i) => {
    const h = card.querySelector('h2.section');
    if (!h) return;
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'acc-body';
    while (h.nextSibling) bodyWrap.appendChild(h.nextSibling);
    card.appendChild(bodyWrap);
    h.classList.add('acc-head');
    h.insertAdjacentHTML('beforeend', '<span class="acc-arrow" style="margin-inline-start:auto">▾</span>');
    if (i > 0) { bodyWrap.style.display = 'none'; h.querySelector('.acc-arrow').style.transform = 'rotate(180deg)'; }
    h.style.cursor = 'pointer';
    h.onclick = () => {
      const open = bodyWrap.style.display !== 'none';
      bodyWrap.style.display = open ? 'none' : '';
      h.querySelector('.acc-arrow').style.transform = open ? 'rotate(180deg)' : '';
    };
  });
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
      <div class="card stat"><div class="num">${fmt(f.expenses_month)}</div><div class="lbl">مصاريف الشهر</div></div>
      <div class="card stat"><div class="num">${f.revenue_year}</div><div class="lbl">محصلة السنة</div></div>
      <div class="card stat"><div class="num">${fmt(f.expenses_year)}</div><div class="lbl">مصاريف السنة</div></div>
    </div>
    ${f.net_year === null ? '' : `<div class="card" style="text-align:center">
      <div class="lbl" style="color:var(--muted);font-size:13px">صافي السنة</div>
      <div class="num" style="font-size:30px;font-weight:800;color:${f.net_year >= 0 ? 'var(--green-dark)' : 'var(--red)'}">${fmt(f.net_year)} جنيه</div>
      <div class="note">صافي الشهر: ${fmt(f.net_month)} جنيه</div>
    </div>`}
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

// ---------------- My attendance (المدرب يشوف سجله هو بس - عرض فقط) ----------------
async function renderMyAttendance() {
  pageTitle.textContent = 'حضوري';
  const mine = await api('/my-attendance');
  if (!mine.linked) { app.innerHTML = '<div class="empty">حسابك مش مربوط بعضو جهاز - كلم الإدارة</div>'; return; }
  const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const ST = { present: '✅ حاضر', absent: '❌ غائب', late: '⏰ متأخر' };
  app.innerHTML = `
    <h2 class="section">إجمالي كل شهر (السنة دي)</h2>
    ${(mine.months || []).length ? mine.months.map((mo) => `
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="name">${AR_MONTHS[Number(mo.ym.slice(5)) - 1]} ${mo.ym.slice(0, 4)}</div>
          <div class="sub">✅ حضور ${mo.present} يوم${mo.absent ? ' • ❌ غياب ' + mo.absent : ''}${mo.late ? ' • ⏰ تأخير ' + mo.late + ' (' + mo.late_minutes + ' د)' : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">لسه مفيش تسجيل السنة دي</div>'}
    <h2 class="section">سجل الحضور بالتاريخ</h2>
    ${(mine.all_rows || []).length ? mine.all_rows.map((r) => `
      <div class="list-item" style="cursor:default">
        <div class="grow"><div class="name">${r.date}</div></div>
        <span class="badge ${r.status === 'present' ? 'active' : r.status === 'late' ? 'grace' : 'expired'}">${ST[r.status]}${r.status === 'late' && r.late_minutes ? ' ' + r.late_minutes + ' د' : ''}</span>
      </div>`).join('') : '<div class="empty">لسه مفيش تسجيل</div>'}
    <p class="note">الإدارة هي اللي بتسجل - الشاشة دي للعرض بس.</p>`;
}

// ---------------- Staff (الجهاز الفني والإداري) ----------------
const STAFF_STATUS = { present: 'حاضر', absent: 'غائب', late: 'متأخر' };
async function renderStaff() {
  pageTitle.textContent = 'الجهاز الفني والإداري';
  const today = todayLocal();
  app.innerHTML = `
    <input type="date" id="st-date" value="${today}" />
    <div id="staff-savebar"></div>
    <div id="staff-body"></div>
    <div id="staff-month"></div>
    <div id="staff-add"></div>`;
  // تقرير آخر الشهر لكل فرد في الجهاز: حضور/غياب/تأخير - بيتحسب من الأيام المحفوظة بتواريخها
  async function loadMonth(month) {
    try {
      const sm = await api('/staff/month?month=' + month);
      document.getElementById('staff-month').innerHTML = `
        <h2 class="section">📊 تقرير الشهر - حضور وغياب وتأخير كل فرد في الجهاز</h2>
        <input type="month" id="st-month" value="${sm.month}" style="margin-bottom:10px" />
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
      document.getElementById('st-month').onchange = (e) => loadMonth(e.target.value);
    } catch (e) {}
  }
  loadMonth(today.slice(0, 7));
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
        <input type="number" min="0" max="600" inputmode="numeric" class="late-input" data-sid="${m.id}"
          value="${m.late_minutes || ''}" placeholder="دقائق التأخير" title="مدة التأخير بالدقائق"
          style="width:86px;text-align:center;padding:6px 4px;border:1px solid var(--border);border-radius:10px;font:inherit" />
        ${m.status ? `<button class="btn gray small staff-clear" data-sid="${m.id}">✕</button>` : ''}` :
        (m.status ? `<span class="badge ${m.status === 'present' ? 'active' : m.status === 'late' ? 'grace' : 'expired'}">${m.status === 'present' ? 'حاضر' : m.status === 'late' ? 'متأخر' : 'غائب'}${m.status === 'late' && m.late_minutes ? ' ' + m.late_minutes + ' د' : ''}</span>` : '<span class="note">-</span>')}
      </div>`).join('') : '<div class="empty">مفيش أعضاء جهاز</div>';
    if (canEdit) {
      // التسجيل بيتحفظ مرة واحدة بزرار "تأكيد حفظ اليوم" عشان اليوم يتقفل بتاريخه
      const cleared = new Set();
      const savedStatus = {};
      document.querySelectorAll('#staff-body .list-item').forEach((row) => {
        const btn = row.querySelector('.toggle-pill button[class*="on-"]');
        if (btn) savedStatus[btn.dataset.sid] = btn.dataset.val;
      });
      function refreshSaveBar() {
        const marked = document.querySelectorAll('#staff-body .toggle-pill button[class*="on-"]').length;
        const bar = document.getElementById('staff-savebar');
        bar.innerHTML = `<button class="btn block" id="day-save">💾 تأكيد حفظ يوم ${date} (${marked} تسجيل)</button>`;
        document.getElementById('day-save').onclick = async () => {
          const recs = [];
          document.querySelectorAll('#staff-body .list-item').forEach((row) => {
            const on = row.querySelector('.toggle-pill button[class*="on-"]');
            if (!on) return;
            const inp = row.querySelector('.late-input');
            recs.push({ staff_id: on.dataset.sid, date, status: on.dataset.val,
              late_minutes: on.dataset.val === 'late' ? (parseInt(inp && inp.value, 10) || 0) : 0 });
          });
          for (const sid of cleared) {
            if (savedStatus[sid]) recs.push({ staff_id: sid, date, status: null });
          }
          document.getElementById('day-save').disabled = true;
          for (const r of recs) await api('/staff-attendance', { body: r });
          toast(`اتحفظ يوم ${date} ✔ (${recs.length} تسجيل بتاريخه)`);
          loadMonth(document.getElementById('st-month') ? document.getElementById('st-month').value : date.slice(0, 7));
          load(date);
        };
      }
      document.querySelectorAll('#staff-body .toggle-pill button').forEach((b) => {
        b.onclick = () => {
          const pill = b.closest('.toggle-pill');
          pill.querySelectorAll('button').forEach((x) => x.classList.remove('on-present', 'on-absent', 'on-late'));
          b.classList.add(b.dataset.val === 'present' ? 'on-present' : b.dataset.val === 'absent' ? 'on-absent' : 'on-late');
          cleared.delete(b.dataset.sid);
          refreshSaveBar();
        };
      });
      document.querySelectorAll('.late-input').forEach((inp) => {
        inp.onchange = () => refreshSaveBar();
      });
      document.querySelectorAll('.staff-clear').forEach((b) => {
        b.onclick = () => {
          const row = b.closest('.list-item');
          row.querySelectorAll('.toggle-pill button').forEach((x) => x.classList.remove('on-present', 'on-absent', 'on-late'));
          cleared.add(b.dataset.sid);
          refreshSaveBar();
        };
      });
      refreshSaveBar();
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

async function renderTrainingDay(container) {
  if (!container) pageTitle.textContent = 'يوم التدريب';
  const [d, m] = await Promise.all([api('/dashboard'), api('/attendance/month')]);
  const unmarked = d.players_total - d.present_today - d.absent_today;
  const dropoutsBySquad = {};
  (m.dropouts || []).forEach((p) => { const k = p.squad || ''; dropoutsBySquad[k] = (dropoutsBySquad[k] || 0) + 1; });
  (container || app).innerHTML = `
    <h2 class="section">يوم التدريب - اللي بيحصل في الملعب دلوقتي${d.is_training_day ? '' : ' <span class="badge grace">مفيش تدريب النهاردة</span>'}</h2>
    <div class="grid">
      <div class="card stat"><div class="num">${d.present_today}</div><div class="lbl">حاضر في الملعب دلوقتي ✅</div></div>
      <div class="card stat"><div class="num">${d.absent_today}</div><div class="lbl">غايب ❌</div></div>
      <div class="card stat"><div class="num">${unmarked}</div><div class="lbl">لسه ما اتسجلش</div></div>
      <div class="card stat"><div class="num">${m.dropout_year}</div><div class="lbl">منقطع خلال 3 شهور (غايب أسبوعين+)</div></div>
    </div>
    <h2 class="section">حسب المجموعة</h2>
    ${d.squad_attendance.map((s) => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div>
            <div style="font-weight:700">${esc(s.squad || 'بدون مجموعة')}</div>
            <div class="sub">${s.coaches.length ? esc(s.coaches.join('، ')) : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${s.present === 0 && s.absent === 0
              ? `<span class="badge grace">لسه ما اتسجلش (${s.total} لاعب)</span>`
              : `<span class="badge active">✅ حاضر ${s.present}</span> <span class="badge expired">❌ غايب ${s.absent}</span>${s.total - s.present - s.absent > 0 ? ` <span class="badge grace">لسه ${s.total - s.present - s.absent}</span>` : ''}`}
            ${dropoutsBySquad[s.squad || ''] ? `<span class="badge none">منقطع ${dropoutsBySquad[s.squad || '']}</span>` : ''}
          </div>
        </div>
      </div>`).join('')}
    <div class="sub" style="text-align:center;margin-top:8px">الأرقام بتتحدث مع حفظ كل مدرب - افتح الشاشة تاني للتحديث</div>`;
}

// ---------------- New subscriber registration (admin/manager only) ----------------
window.toggleOv = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const opening = el.style.display === 'none';
  el.style.display = opening ? '' : 'none';
  if (opening) el.scrollIntoView({ behavior: 'smooth' });
};
async function renderSubscribe() {
  pageTitle.textContent = 'الاشتراكات';
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager' && currentUser.role !== 'viewer')) {
    app.innerHTML = '<div class="empty">مش مسموح - الشاشة دي لمسؤولة الاشتراكات والإدارة بس</div>';
    return;
  }
  const plans = await api('/plans');
  const items = await api('/subscription-items');
  const overview = await api('/subscriptions/overview');
  window._subItems = items;
  const planOpts = Object.entries(plans).map(([k, v]) =>
    `<option value="${k}">${v.label} - ${fmt(v.amount)} جنيه</option>`).join('');
  const itemsHtml = items.map((it) => `
    <div class="kv" style="align-items:center">
      <label style="margin:0;display:flex;align-items:center;gap:6px"><input type="checkbox" class="r-item" data-id="${it.id}" /> ${esc(it.label)}</label>
      <span><input type="number" min="0" class="r-item-amt" data-id="${it.id}" value="${it.amount || ''}" placeholder="المبلغ" style="width:100px" /> جنيه</span>
    </div>`).join('');
  const ovCard = (key, num, label) => `
      <div class="card stat" style="cursor:pointer" onclick="toggleOv('ov-${key}')"><div class="num">${num}</div><div class="lbl">${label}</div></div>`;
  const ovList = (key, arr, withEnd) => `
    <div id="ov-${key}" style="display:none">
    ${arr.length ? arr.map((p) => `
      <div class="list-item" onclick="location.hash='#/player/${p.id}'">
        <div class="grow">
          <div class="name">${esc(p.name)}</div>
          <div class="sub">${withEnd && p.end_date ? 'اشتراكه بينتهي ' + p.end_date + ' • ' : ''}${p.parent_phone ? `<a href="tel:${esc(p.parent_phone)}" onclick="event.stopPropagation()">${esc(p.parent_phone)}</a>` : 'بدون رقم'}</div>
        </div>
      </div>`).join('') : '<div class="empty">مفيش لاعبين هنا</div>'}
    </div>`;
  app.innerHTML = `
    <div class="grid">
      ${ovCard('m1', overview.m1.length, 'اشتراك شهري')}
      ${ovCard('m3', overview.m3.length, 'اشتراك 3 شهور')}
      ${ovCard('m6', overview.m6.length, 'اشتراك 6 شهور')}
      ${ovCard('m12', overview.m12.length, 'اشتراك سنوي')}
      ${ovCard('mustaqbal', overview.mustaqbal.length, 'أعضاء نادي المستقبل')}
      ${ovCard('kit', overview.kit.length, 'اشتركوا في الزي 👕')}
    </div>
    ${ovList('m1', overview.m1, true)}
    ${ovList('m3', overview.m3, true)}
    ${ovList('m6', overview.m6, true)}
    ${ovList('m12', overview.m12, true)}
    ${ovList('mustaqbal', overview.mustaqbal, true)}
    ${ovList('kit', overview.kit, false)}
    <div class="card">
      <h2 class="section" style="margin-top:0">بيانات اللاعب الجديد</h2>
      <label>اسم اللاعب *</label><input id="r-name" />
      <label>اسم ولي الأمر</label><input id="r-parent" />
      <label>رقم واتساب ولي الأمر</label><input id="r-phone" inputmode="tel" placeholder="01xxxxxxxxx" />
      <label>تاريخ الميلاد</label><input id="r-birth" type="date" />
      <label>المجموعة السنية</label>
      <select id="r-age"><option>تحت 8</option><option selected>تحت 10</option><option>تحت 12</option><option>تحت 14</option><option>تحت 16</option></select>
      <label>الفرقة</label>
      <select id="r-squad"><option value="">-</option><option>كيدز 2019-2021</option><option>2017-2018</option><option>2015-2016</option><option>2013-2014</option><option>حراس</option></select>
      <label>رقم العضوية (أعضاء نادي المستقبل)</label><input id="r-membership" inputmode="numeric" placeholder="اختياري" />
      <label>ملاحظات</label><input id="r-notes" />
    </div>
    <div class="card">
      <h2 class="section" style="margin-top:0">الاشتراك والدفع</h2>
      <label style="display:flex;align-items:center;gap:6px;font-weight:bold"><input type="checkbox" id="r-academy" checked /> اشتراك الأكاديمية</label>
      <div id="r-academy-box">
        <label>تاريخ البداية</label><input id="r-start" type="date" value="${todayLocal()}" />
        <label>خطة الاشتراك</label>
        <select id="r-plan">${planOpts}<option value="mustaqbal">أعضاء نادي المستقبل - سعر متغير</option><option value="custom">مخصص</option></select>
        <div id="r-custom" class="hidden">
          <label>المدة (شهور)</label><input id="r-months" type="number" min="1" value="1" />
          <label>المبلغ (جنيه)</label><input id="r-amount" type="number" min="0" value="700" />
        </div>
      </div>
      <h2 class="section">بنود إضافية (اختياري)</h2>
      ${itemsHtml}
      <p class="note">أي مبلغ يتغير لاعب للاعب يتعدل من الخانة اللي جنبه قبل الحفظ، والسعر الأساسي يتغير للكل من الإعدادات.</p>
      <div id="r-summary" class="note" style="font-weight:bold"></div>
      <p class="note">بعد الحفظ هتتجهز رسالة تأكيد واتساب كمسودة في شاشة الرسائل - مفيش إرسال تلقائي.</p>
      <button class="btn" id="r-save" style="width:100%">💾 تسجيل اللاعب والاشتراك</button>
    </div>
    <div id="r-done"></div>`;
  const upd = () => {
    const academy = document.getElementById('r-academy').checked;
    document.getElementById('r-academy-box').classList.toggle('hidden', !academy);
    const plan = document.getElementById('r-plan').value;
    document.getElementById('r-custom').classList.toggle('hidden', plan !== 'custom' && plan !== 'mustaqbal');
    const parts = [];
    if (academy) {
      const months = plan === 'custom' ? (parseInt(document.getElementById('r-months').value, 10) || 1) : plans[plan].months;
      const amount = plan === 'custom' ? (Number(document.getElementById('r-amount').value) || 0) : plans[plan].amount;
      const start = document.getElementById('r-start').value;
      parts.push(`الأكاديمية: ${months} شهر من ${start} - ${amount} جنيه`);
    }
    const chosen = readItems('r-item', 'r-item-amt');
    if (chosen.length) parts.push('بنود: ' + chosen.map((c) => `${c.label} ${c.amount}ج`).join(' + '));
    const total = chosen.reduce((t, c) => t + c.amount, 0);
    if (total) parts.push(`إجمالي البنود: ${total} جنيه`);
    document.getElementById('r-summary').textContent = parts.join(' | ');
  };
  ['r-plan', 'r-months', 'r-amount', 'r-start', 'r-academy'].forEach((id) => {
    document.getElementById(id).oninput = upd;
    document.getElementById(id).onchange = upd;
  });
  document.querySelectorAll('.r-item, .r-item-amt').forEach((el) => { el.oninput = upd; el.onchange = upd; });
  upd();
  document.getElementById('r-save').onclick = async () => {
    try {
      const plan = document.getElementById('r-plan').value;
      const body = {
        name: document.getElementById('r-name').value,
        parent_name: document.getElementById('r-parent').value,
        parent_phone: document.getElementById('r-phone').value,
        birth_date: document.getElementById('r-birth').value || null,
        age_group: document.getElementById('r-age').value,
        squad: document.getElementById('r-squad').value || null,
        membership_no: document.getElementById('r-membership').value || null,
        notes: document.getElementById('r-notes').value,
        start_date: document.getElementById('r-start').value
      };
      if (document.getElementById('r-academy').checked) {
        if (plan === 'custom') {
          body.months = document.getElementById('r-months').value;
          body.amount = document.getElementById('r-amount').value;
        } else if (plan === 'mustaqbal') {
          body.plan = 'mustaqbal';
          body.months = document.getElementById('r-months').value;
          body.amount = document.getElementById('r-amount').value;
        } else {
          body.plan = plan;
        }
      }
      body.items = readItems('r-item', 'r-item-amt').map((c) => ({ item_id: c.item_id, amount: c.amount }));
      const out = await api('/subscriptions/register', { body });
      const payLines = (out.payments || []).map((y) => `<div class="sub">${esc(y.label)}: ${y.amount} جنيه</div>`).join('');
      document.getElementById('r-done').innerHTML = `
        <div class="card" style="border-right:4px solid #1a7a3c">
          <div class="name">✅ اتسجل ${esc(out.player.name)}</div>
          ${out.subscription ? `<div class="sub">اشتراك الأكاديمية: ${out.subscription.months} شهر من ${out.subscription.start_date} لحد ${out.subscription.end_date} - ${out.subscription.amount} جنيه</div>` : ''}
          ${payLines}
          ${out.subscription ? '<div class="sub">رسالة التأكيد جهزة كمسودة في شاشة الرسائل</div>' : ''}
          <div class="btn-row" style="margin-top:8px">
            ${out.wa_link ? `<a class="btn" href="${out.wa_link}" target="_blank" rel="noopener">✈️ ابعت التأكيد في واتساب</a>` : (out.subscription ? '<div class="sub">مفيش رقم واتساب لولي الأمر - ضيفه من ملف اللاعب عشان يظهر زرار الإرسال</div>' : '')}
            <button class="btn gray" onclick="location.hash='#/player/${out.player.id}'">فتح ملف اللاعب</button>
          </div>
        </div>`;
      toast('اتسجل اللاعب والاشتراك ✅');
    } catch (e) { toast(e.message); }
  };
}

// يقرأ البنود المختارة ومبالغها من أي فورم فيه تشيكبوكسات البنود
function readItems(checkClass, amtClass) {
  const items = (window._subItems || []);
  const out = [];
  document.querySelectorAll('.' + checkClass + ':checked').forEach((cb) => {
    const id = +cb.dataset.id;
    const amtEl = document.querySelector('.' + amtClass + '[data-id="' + id + '"]');
    const amount = amtEl && amtEl.value !== '' ? (Number(amtEl.value) || 0) : null;
    const it = items.find((x) => x.id === id);
    out.push({ item_id: id, label: it ? it.label : '', amount: amount !== null ? amount : (it ? it.amount : 0) });
  });
  return out;
}

const MORE_ICONS = {
  'clip': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 10h6M9 14h6M9 18h4"/></svg>`,
  'chat': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>`,
  'cash': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="19" height="11" rx="2"/><circle cx="12" cy="12.5" r="2.6"/><path d="M6 10.5v.01M18 15v.01"/></svg>`,
  'cap': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13c0-4 4-7 9-7s9 3 9 7"/><path d="M3 13h18"/><path d="M14 13c0 2.5-1.5 4-3.5 4S7 15.5 7 13"/></svg>`,
  'gear': `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/></svg>`
};
async function renderMore() {
  pageTitle.textContent = 'المزيد';
  const full = currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager' || currentUser.role === 'viewer');
  const links = [];
  if (full) {
    links.push(['#/messages', 'chat', 'الرسائل']);
    if (currentUser.role !== 'viewer') links.push(['#/expenses', 'cash', 'المصاريف']);
  }
  links.push(['#/staff', 'cap', 'الجهاز']);
  if (full) links.push(['#/settings', 'gear', 'الإعدادات']);
  app.innerHTML = links.map(([href, icon, label]) => `
    <div class="list-item" onclick="location.hash='${href}'">
      <div class="grow"><div class="name" style="display:flex;align-items:center;gap:8px">${MORE_ICONS[icon] || ''} ${label}</div></div>
    </div>`).join('');
}
const routes = {
  '/': renderDashboard,
  '/training': async () => { location.hash = '#/attendance'; },
  '/players': renderPlayers,
  '/attendance': renderAttendance,
  '/messages': renderMessages,
  '/expenses': renderExpenses,
  '/staff': renderStaff,
  '/my-att': renderMyAttendance,
  '/subscribe': renderSubscribe,
  '/settings': renderSettings,
  '/more': renderMore
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
    if (hash === '/my-att' && currentUser.role !== 'coach') { // حضوري للمدرب بس
      location.hash = '#/';
      return;
    }
    const m = hash.match(/^\/player\/(\d+)$/);
    if (m) await renderPlayer(m[1]);
    else await (routes[hash] || renderDashboard)();
  } catch (e) {
    app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
// ضغطة أي تاب في الشريط السفلي ترجع لفوق الصفحة بسكرول سلس حتى لو إحنا فيها أصلًا
document.querySelectorAll('#bottomnav a').forEach((a) => {
  a.addEventListener('click', () => {
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
  });
});
window.addEventListener('hashchange', route);
route();
