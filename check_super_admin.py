import sqlite3, hashlib, hmac

db = sqlite3.connect(r'd:\Dillu\Madarsa Portal — Full Source Code\madarsa-portal\madarsa.db')
for email, pw in [
    ('superadmin@madarsa.in', 'admin123'),
    ('gausiyamadarsa92@gmail.com', '9934886605dilD@'),
]:
    row = db.execute('SELECT id,email,role,status,passwordHash FROM users WHERE email=?', (email,)).fetchone()
    print('EMAIL:', email)
    print('ROW:', row)
    if row:
        salt, hash_hex = row[4].split(':')
        test = hashlib.scrypt(pw.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
        print('MATCHES:', hmac.compare_digest(hash_hex, test))
        print('---')
db.close()
