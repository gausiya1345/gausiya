import sqlite3

db = sqlite3.connect(r'd:\Dillu\Madarsa Portal — Full Source Code\madarsa-portal\madarsa.db')
rows = db.execute("SELECT id,email,role,status,linkedId,phone,passwordHash FROM users WHERE email LIKE 'student.approve.test.%' ORDER BY id DESC").fetchall()
print(rows)
db.close()
