// United Academy admin - single page app (no build step).
const app = document.getElementById('app');
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
  document.getElementById('bottomnav').style.display = 'none';
  app.innerHTML = `
    <div class="card" style="max-width:400px;margin:40px auto;text-align:center">
      <div style="font-size:40px;margin-bottom:6px">⚽</div>
      <h2 style="margin-bottom:14px">يونايتد أكاديمي</h2>
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
  app.innerHTML = `
    <div class="grid">
      <div class="card stat"><div class="num">${d.players_total}</div><div class="lbl">لاعب مسجل</div></div>
      <div class="card stat"><div class="num">${d.subs_active}</div><div class="lbl">اشتراك ساري</div></div>
      <div class="card stat"><div class="num">${d.collected_month}</div><div class="lbl">جنيه محصلة الشهر ده (${d.payments_month} دفعة)</div></div>
      <div class="card stat"><div class="num">${d.present_today}/${d.subs_active}</div><div class="lbl">حضور النهاردة${d.is_training_day ? '' : ' (مفيش تدريب)'}</div></div>
    </div>
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
    const st = await api('/settings');
    openModal(`
      <h3>${p.subscription ? 'تجديد اشتراك' : 'اشتراك جديد'} - ${esc(p.name)}</h3>
      <label>تاريخ البداية</label><input id="s-start" type="date" value="${todayLocal()}" />
      <label>المدة (شهور)</label><input id="s-months" type="number" min="1" value="${esc(st.sub_months)}" />
      <label>المبلغ (جنيه)</label><input id="s-amount" type="number" min="0" value="${esc(st.sub_amount)}" />
      <p class="note">هيتجهز رسالة تأكيد واتساب كمسودة في شاشة الرسائل - مفيش إرسال تلقائي.</p>
      <div class="btn-row">
        <button class="btn gray" onclick="closeModal()">إلغاء</button>
        <button class="btn" id="sub-save">حفظ الاشتراك</button>
      </div>`);
    document.getElementById('sub-save').onclick = async () => {
      await api(`/players/${id}/subscriptions`, { body: {
        start_date: document.getElementById('s-start').value,
        months: document.getElementById('s-months').value,
        amount: document.getElementById('s-amount').value
      }});
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
async function renderAttendance() {
  pageTitle.textContent = 'الحضور';
  const today = todayLocal();
  app.innerHTML = `
    <input type="date" id="att-date" value="${today}" />
    <div id="att-body"></div>`;
  async function load(date) {
    const d = await api('/attendance?date=' + date);
    const body = document.getElementById('att-body');
    if (!d.is_training_day) {
      body.innerHTML = `<div class="empty">اليوم ده مش يوم تدريب (التدريب أحد / تلات / خميس). تقدر تسجل حضور استثنائي برضه.</div>` +
        playerRows(d.players);
    } else {
      body.innerHTML = playerRows(d.players) + `
        <div class="btn-row">
          <button class="btn block" id="close-day">إغلاق اليوم وتجهيز رسائل الغياب</button>
        </div>
        <p class="note" style="margin-top:8px">الزر ده بيجهز مسودة رسالة لكل لاعب غائب - الرسائل بتتراجع وتتبعت بإيدك من شاشة الرسائل.</p>`;
      document.getElementById('close-day').onclick = async () => {
        const r = await api('/attendance/close', { body: { date } });
        toast(`اتجهزت ${r.absence_drafts_created} رسالة غياب`);
      };
    }
    body.querySelectorAll('.toggle-pill button').forEach((btn) => {
      btn.onclick = async () => {
        const pid = btn.dataset.pid;
        const present = btn.dataset.val === '1';
        await api('/attendance', { body: { player_id: pid, date, present } });
        load(date);
      };
    });
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
      </div>`).join('');
  }
  await load(today);
  document.getElementById('att-date').onchange = (e) => load(e.target.value);
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
      <div class="btn-row">
        <button class="btn secondary" id="u-add">إضافة مستخدم</button>
        <button class="btn gray" id="logout-btn">تسجيل خروج</button>
      </div>
      <p class="note" style="margin-top:6px">إضافة المستخدمين متاحة لحساب المدير (admin) بس.</p>
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
const routes = {
  '/': renderDashboard,
  '/players': renderPlayers,
  '/attendance': renderAttendance,
  '/messages': renderMessages,
  '/settings': renderSettings
};
async function route() {
  try {
    await api('/me');
  } catch (e) {
    return; // renderLogin already shown by api()
  }
  document.getElementById('bottomnav').style.display = '';
  const hash = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('#bottomnav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === hash || (hash.startsWith('/player/') && a.dataset.route === '/players'));
  });
  try {
    const m = hash.match(/^\/player\/(\d+)$/);
    if (m) await renderPlayer(m[1]);
    else await (routes[hash] || renderDashboard)();
  } catch (e) {
    app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
route();
