// النسخ الاحتياطي اليومي لقاعدة البيانات.
// المرحلة الحالية (بموافقة أحمد): تجهيز كامل في الكود - لقطة متسقة + ضغط + جدولة يومية
// + زرار يدوي + سطر حالة. رفع Google Drive مقفول لحد ما أحمد يوافق صراحة على الربط:
// مفيش أي بيانات بتسيب السيرفر طالما متغيرات البيئة GDRIVE_* مش متظبطة.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { db, getSetting, setSetting } = require('./db');

const dataDir = path.join(__dirname, 'data');
const markerFile = path.join(dataDir, '.db_initialized');
const BACKUP_HOUR_CAIRO = 2; // النسخة اليومية الساعة 2 بالليل بتوقيت القاهرة

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

// الرفع على Google Drive: مش متفعّل لحد موافقة أحمد الصريحة على الربط.
// بعد الموافقة: googleapis OAuth2 بالمفاتيح من متغيرات البيئة، رفع لمجلد مخصوص،
// والاحتفاظ بآخر 30 نسخة (مسح الأقدم - معروض على أحمد ضمن الخطة).
async function uploadToDrive() {
  if (!driveConfigured()) {
    return { skipped: true, reason: 'Google Drive لسه غير مربوط - مستني موافقة أحمد على الربط' };
  }
  return { skipped: true, reason: 'رفع Drive هيتفعّل بعد الربط' };
}

async function runBackup(trigger) {
  const at = new Date().toISOString();
  try {
    const gz = await snapshotToTmp();
    const size = fs.statSync(gz).size;
    const up = await uploadToDrive(gz);
    fs.rmSync(gz, { force: true });
    const result = up.skipped ? `skipped: ${up.reason}` : 'uploaded';
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

// جدولة بدون مكتبات إضافية: فحص كل 30 دقيقة، وينفذ مرة واحدة يوميًا في ساعة النسخ.
function startScheduler() {
  setInterval(() => {
    const c = cairoNow();
    if (c.getHours() !== BACKUP_HOUR_CAIRO) return;
    const day = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
    if ((getSetting('backup_last_run_day') || '') === day) return;
    setSetting('backup_last_run_day', day);
    runBackup('daily').catch(() => {});
  }, 30 * 60 * 1000);
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
