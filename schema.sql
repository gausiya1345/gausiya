-- Madarsa Gausiya Razviya Portal — SQLite schema
-- Generated 2026-09-28T11:15:00.033Z

-- Portal accounts
CREATE TABLE IF NOT EXISTS "users" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "email" TEXT,
  "passwordHash" TEXT,
  "role" TEXT,
  "status" TEXT,
  "phone" TEXT,
  "linkedId" INTEGER,
  "lastLogin" TEXT,
  "createdAt" TEXT,
  UNIQUE("email")
);

-- Login sessions
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "token" TEXT,
  "userId" INTEGER,
  "createdAt" TEXT,
  UNIQUE("token")
);

-- Madarsa settings
CREATE TABLE IF NOT EXISTS "settings" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "key" TEXT,
  "value" TEXT,
  UNIQUE("key")
);

-- Classes
CREATE TABLE IF NOT EXISTS "classes" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "alias" TEXT,
  "section" TEXT,
  "description" TEXT,
  "classTeacherId" INTEGER,
  "room" TEXT,
  "capacity" INTEGER,
  "monthlyFee" INTEGER,
  "sortOrder" INTEGER
);

-- Subjects
CREATE TABLE IF NOT EXISTS "subjects" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "code" TEXT,
  "type" TEXT,
  "classId" INTEGER,
  "teacherId" INTEGER,
  "fullMarks" INTEGER,
  "passMarks" INTEGER
);

-- Teachers
CREATE TABLE IF NOT EXISTS "teachers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "urduName" TEXT,
  "designation" TEXT,
  "qualification" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "gender" TEXT,
  "joiningDate" TEXT,
  "salary" INTEGER,
  "address" TEXT,
  "status" TEXT
);

-- Parents
CREATE TABLE IF NOT EXISTS "parents" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "relation" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "occupation" TEXT,
  "address" TEXT
);

-- Students
CREATE TABLE IF NOT EXISTS "students" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "admissionNo" TEXT,
  "name" TEXT,
  "gender" TEXT,
  "dob" TEXT,
  "classId" INTEGER,
  "rollNo" INTEGER,
  "fatherName" TEXT,
  "motherName" TEXT,
  "parentId" INTEGER,
  "phone" TEXT,
  "address" TEXT,
  "bloodGroup" TEXT,
  "admissionDate" TEXT,
  "status" TEXT,
  "notes" TEXT,
  UNIQUE("admissionNo")
);

-- Attendance
CREATE TABLE IF NOT EXISTS "attendance" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "studentId" INTEGER,
  "classId" INTEGER,
  "date" TEXT,
  "status" TEXT,
  "markedBy" TEXT,
  UNIQUE("studentId", "date")
);

-- Examinations
CREATE TABLE IF NOT EXISTS "exams" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "classId" INTEGER,
  "startDate" TEXT,
  "endDate" TEXT,
  "totalMarks" INTEGER,
  "published" INTEGER,
  "description" TEXT
);

-- Results
CREATE TABLE IF NOT EXISTS "results" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "examId" INTEGER,
  "studentId" INTEGER,
  "subjectId" INTEGER,
  "marks" REAL,
  "remarks" TEXT,
  UNIQUE("examId", "studentId", "subjectId")
);

-- Fees
CREATE TABLE IF NOT EXISTS "fees" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "studentId" INTEGER,
  "month" TEXT,
  "amount" INTEGER,
  "paidAmount" INTEGER,
  "status" TEXT,
  "method" TEXT,
  "paidOn" TEXT,
  "receiptNo" TEXT,
  "remarks" TEXT,
  UNIQUE("studentId", "month")
);

-- Donations
CREATE TABLE IF NOT EXISTS "donations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "receiptNo" TEXT,
  "donorName" TEXT,
  "phone" TEXT,
  "type" TEXT,
  "amount" INTEGER,
  "date" TEXT,
  "method" TEXT,
  "purpose" TEXT,
  "notes" TEXT
);

-- Expenses
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT,
  "category" TEXT,
  "amount" INTEGER,
  "date" TEXT,
  "paidTo" TEXT,
  "method" TEXT,
  "notes" TEXT
);

-- Homework
CREATE TABLE IF NOT EXISTS "homework" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "classId" INTEGER,
  "subjectId" INTEGER,
  "title" TEXT,
  "description" TEXT,
  "assignedOn" TEXT,
  "dueDate" TEXT,
  "teacherId" INTEGER
);

-- Online classes
CREATE TABLE IF NOT EXISTS "onlineClasses" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "classId" INTEGER,
  "subjectId" INTEGER,
  "topic" TEXT,
  "date" TEXT,
  "time" TEXT,
  "duration" INTEGER,
  "platform" TEXT,
  "link" TEXT,
  "teacherId" INTEGER
);

-- Notices
CREATE TABLE IF NOT EXISTS "notices" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT,
  "body" TEXT,
  "audience" TEXT,
  "priority" TEXT,
  "date" TEXT,
  "isPublic" INTEGER,
  "attachment" TEXT
);

-- Calendar events
CREATE TABLE IF NOT EXISTS "events" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT,
  "date" TEXT,
  "endDate" TEXT,
  "type" TEXT,
  "description" TEXT
);

-- Feed
CREATE TABLE IF NOT EXISTS "feed" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "text" TEXT,
  "image" TEXT,
  "authorId" INTEGER,
  "authorName" TEXT,
  "authorRole" TEXT,
  "likes" TEXT,
  "createdAt" TEXT
);

-- Admissions
CREATE TABLE IF NOT EXISTS "admissions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "appNo" TEXT,
  "studentName" TEXT,
  "gender" TEXT,
  "dob" TEXT,
  "classId" INTEGER,
  "bloodGroup" TEXT,
  "fatherName" TEXT,
  "motherName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "previousSchool" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "status" TEXT,
  "reason" TEXT,
  "studentId" INTEGER,
  "createdAt" TEXT,
  UNIQUE("appNo")
);

-- Enquiries
CREATE TABLE IF NOT EXISTS "enquiries" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "phone" TEXT,
  "studentName" TEXT,
  "classWanted" TEXT,
  "message" TEXT,
  "status" TEXT,
  "createdAt" TEXT
);

-- Messages
CREATE TABLE IF NOT EXISTS "messages" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "fromId" INTEGER,
  "toId" INTEGER,
  "body" TEXT,
  "isRead" INTEGER,
  "createdAt" TEXT
);

-- Notifications
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER,
  "title" TEXT,
  "body" TEXT,
  "link" TEXT,
  "kind" TEXT,
  "isRead" INTEGER,
  "createdAt" TEXT
);

-- Activity log
CREATE TABLE IF NOT EXISTS "activity" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER,
  "userName" TEXT,
  "action" TEXT,
  "module" TEXT,
  "detail" TEXT,
  "createdAt" TEXT
);

CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_att_class ON attendance(classId, date);
CREATE INDEX IF NOT EXISTS idx_fee_month ON fees(month);
CREATE INDEX IF NOT EXISTS idx_res_exam ON results(examId);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(fromId, toId);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(userId, isRead);