const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('madarsa.db');
try {
  const pw = '9934886605dilD@';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  const stored = `${salt}:${hash}`;
  db.prepare(`INSERT INTO "users" (name,email,role,status,linkedId,passwordHash,createdAt,phone) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name, role=excluded.role, status=excluded.status, linkedId=excluded.linkedId, passwordHash=excluded.passwordHash, createdAt=excluded.createdAt, phone=excluded.phone`).run('Super Admin','gausiyamadarsa92@gmail.com','super_admin','active', null, stored, new Date().toISOString(), '');
  const row = db.prepare('SELECT id,email,role,createdAt FROM users WHERE email=?').get('gausiyamadarsa92@gmail.com');
  console.log('INSERT_RESULT:', row);
} catch (err) {
  console.error('INSERT_ERROR:', err);
} finally {
  db.close();
}
