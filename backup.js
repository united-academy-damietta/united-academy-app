// النسخ الاحتياطي اليومي لقاعدة البيانات على Google Drive (اتفعل بموافقة أحمد 28 نوفمبر).
// لقطة متسقة + ضغط + جدولة يومية + زرار يدوي + رفع لمجلد مخصوص على درايف الأكاديمية.
// الاحتفاظ: كل النسخ بتتخزن، مفيش مسح تلقائي لأي نسخة (قاعدة أحمد: ممنوع مسح أي حاجة).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { db, getSetting, setSetting } = require('./db');

const dataDir = path.join(__dirname, 'data');
const markerFile = path.join(dataDir, '.db_initialized');
// نسخة كل ساعة (بطلب أحمد 28 نوفمبر) - كل النسخ بتتخزن، مفيش مسح تلقائي.

function driveConfigured() {
  return !!(
    process.env.GDRIVE_CLIENT_ID &&
    process.env.GDRIVE_CLIENT_SECRET &&
    process.env.GDRIVE_REFRESH_TOKEN &&
    process.env.GDRIVE_FOLDER_ID
  );
}

// لقطة متسقة من قاعدة البيانات (SQLite online backup) مضغوطة gzip في مجلد مؤقت.
async function snapshotToTmp() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapPath = path.join(os.tmpdir(), `academy-backup-${stamp}.db`);
  await db.backup(snapPath);
  const gzPath = snapPath + '.gz';
  await new Promise((resolve, reject) => {
    fs.createReadStream(snapPath)
      .pipe(zlib.createGzip())
      .pipe(fs.createWriteStream(gzPath))
      .on('finish', resolve)
      .on('error', reject);
  });
  fs.rmSync(snapPath, { force: true });
  return gzPath;
}

// الرفع على Google Drive: OAuth2 (refresh token) من متغيرات البيئة + رفع multipart.
// كل النسخ بتتفضل محفوظة - مفيش مسح تلقائي نهائيًا.
async function getDriveAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GDRIVE_CLIENT_ID,
      client_secret: process.env.GDRIVE_CLIENT_SECRET,
      refresh_token: process.env.GDRIVE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Drive auth failed: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}

async function uploadToDrive(gzPath) {
  if (!driveConfigured()) {
    return { skipped: true, reason: 'Google Drive لسه غير مربوط - متغيرات البيئة GDRIVE_* مش متظبطة' };
  }
  const token = await getDriveAccessToken();
  const name = `academy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db.gz`;
  const metadata = { name, parents: [process.env.GDRIVE_FOLDER_ID] };
  const boundary = 'backup_boundary_' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
    fs.readFileSync(gzPath),
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Drive upload failed: ' + ((j.error && j.error.message) || r.status));
  return { skipped: false, id: j.id, name: j.name };
}

async function runBackup(trigger) {
  const at = new Date().toISOString();
  try {
    const gz = await snapshotToTmp();
    const size = fs.statSync(gz).size;
    const up = await uploadToDrive(gz);
    fs.rmSync(gz, { force: true });
    const result = up.skipped ? `skipped: ${up.reason}` : `uploaded: ${up.name} (id ${up.id})`;
    setSetting('backup_last_at', at);
    setSetting('backup_last_result', `${result} (${trigger}, ${size} bytes)`);
    return { ok: !up.skipped, skipped: !!up.skipped, reason: up.reason || null, size, at };
  } catch (e) {
    setSetting('backup_last_at', at);
    setSetting('backup_last_result', `error: ${e.message} (${trigger})`);
    return { ok: false, skipped: false, error: e.message, at };
  }
}

function cairoNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
}

// جدولة بدون مكتبات إضافية: فحص كل 15 دقيقة، وينفذ نسخة كل ساعة.
function startScheduler() {
  setInterval(() => {
    const c = cairoNow();
    const hourStamp = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}-${String(c.getHours()).padStart(2, '0')}`;
    if ((getSetting('backup_last_run_hour') || '') === hourStamp) return;
    setSetting('backup_last_run_hour', hourStamp);
    runBackup('hourly').catch(() => {});
  }, 15 * 60 * 1000);
}

// نقطة استعادة بعد النشر: تشتغل بس لما قاعدة البيانات تتبني من الصفر (نشر جديد مسح التخزين)
// ويكون Drive مربوط. التنزيل والفحص (integrity check) والتبديل هيتفعّلوا بعد الموافقة.
function restoreIfFreshDeploy() {
  const fresh = !fs.existsSync(markerFile);
  if (fresh) fs.writeFileSync(markerFile, new Date().toISOString());
  if (!fresh) return { fresh: false, restored: false };
  if (!driveConfigured()) return { fresh: true, restored: false, reason: 'Drive غير مربوط بعد' };
  // TODO بعد الموافقة: تنزيل أحدث نسخة + فحص سلامة + استبدال قاعدة البيانات قبل الفتح.
  return { fresh: true, restored: false, reason: 'الاستعادة التلقائية هتتفعّل بعد الربط' };
}

function backupStatus() {
  return {
    drive_linked: driveConfigured(),
    last_at: getSetting('backup_last_at') || null,
    last_result: getSetting('backup_last_result') || null
  };
}

module.exports = { runBackup, startScheduler, restoreIfFreshDeploy, backupStatus, driveConfigured };
