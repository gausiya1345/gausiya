import sqlite3

conn = sqlite3.connect(r'd:\Dillu\Madarsa Portal — Full Source Code\madarsa-portal\madarsa.db')
print('classes', conn.execute('select count(*) from classes').fetchone()[0])
print('subjects', conn.execute('select count(*) from subjects').fetchone()[0])
print('students', conn.execute('select count(*) from students').fetchone()[0])
print('exams', conn.execute('select count(*) from exams').fetchone()[0])
print('results', conn.execute('select count(*) from results').fetchone()[0])
print('users', conn.execute('select count(*) from users').fetchone()[0])
print('super_admin', conn.execute("select email from users where role='super_admin' ").fetchall())
conn.close()
