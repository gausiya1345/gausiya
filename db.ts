import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import { TABLES } from "@shared/schema";

export const DB_PATH = path.resolve(process.env.DB_PATH || "madarsa.db");
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = OFF");

const sqlType = { text: "TEXT", int: "INTEGER", real: "REAL" } as const;

export function schemaSQL(): string {
  const out: string[] = [
    "-- Madarsa Gausiya Razviya Portal — SQLite schema",
    `-- Generated ${new Date().toISOString()}`,
    "",
  ];
  for (const [name, def] of Object.entries(TABLES)) {
    const cols = Object.entries(def.columns).map(([c, t]) => `  "${c}" ${sqlType[t]}`);
    const uniq = (def.unique || []).map((u) => `  UNIQUE(${u.map((x) => `"${x}"`).join(", ")})`);
    out.push(`-- ${def.label}`);
    out.push(`CREATE TABLE IF NOT EXISTS "${name}" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n${[...cols, ...uniq].join(",\n")}\n);`);
    out.push("");
  }
  out.push(`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);`);
  out.push(`CREATE INDEX IF NOT EXISTS idx_att_class ON attendance(classId, date);`);
  out.push(`CREATE INDEX IF NOT EXISTS idx_fee_month ON fees(month);`);
  out.push(`CREATE INDEX IF NOT EXISTS idx_res_exam ON results(examId);`);
  out.push(`CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(fromId, toId);`);
  out.push(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(userId, isRead);`);
  return out.join("\n");
}

export function migrate() {
  sqlite.exec(schemaSQL());
  // add any columns introduced later
  for (const [name, def] of Object.entries(TABLES)) {
    const existing = new Set((sqlite.prepare(`PRAGMA table_info("${name}")`).all() as any[]).map((r) => r.name));
    for (const [c, t] of Object.entries(def.columns)) {
      if (!existing.has(c)) sqlite.exec(`ALTER TABLE "${name}" ADD COLUMN "${c}" ${sqlType[t]}`);
    }
  }
}

// ---------- generic helpers ----------
function clean(table: string, data: Record<string, any>) {
  const def = TABLES[table];
  const out: Record<string, any> = {};
  for (const [c, t] of Object.entries(def.columns)) {
    if (!(c in data)) continue;
    let v = data[c];
    if (v === "" && t !== "text") v = null;
    if (v !== null && v !== undefined) {
      if (t === "int") v = typeof v === "boolean" ? (v ? 1 : 0) : Math.round(Number(v));
      else if (t === "real") v = Number(v);
      else if (typeof v === "object") v = JSON.stringify(v);
      else v = String(v);
      if (typeof v === "number" && isNaN(v)) v = null;
    }
    out[c] = v ?? null;
  }
  return out;
}

export const db = {
  all<T = any>(table: string, where = "", params: any[] = []): T[] {
    return sqlite.prepare(`SELECT * FROM "${table}" ${where}`).all(...params) as T[];
  },
  get<T = any>(table: string, id: number): T | undefined {
    return sqlite.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as T | undefined;
  },
  find<T = any>(table: string, where: string, params: any[] = []): T | undefined {
    return sqlite.prepare(`SELECT * FROM "${table}" WHERE ${where} LIMIT 1`).get(...params) as T | undefined;
  },
  insert<T = any>(table: string, data: Record<string, any>): T {
    const d = clean(table, data);
    const keys = Object.keys(d);
    const sql = keys.length
      ? `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`
      : `INSERT INTO "${table}" DEFAULT VALUES`;
    const info = sqlite.prepare(sql).run(...keys.map((k) => d[k]));
    return this.get<T>(table, Number(info.lastInsertRowid))!;
  },
  upsert(table: string, data: Record<string, any>, conflict: string[]) {
    const d = clean(table, data);
    const keys = Object.keys(d);
    const upd = keys.filter((k) => !conflict.includes(k));
    sqlite.prepare(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})
       ON CONFLICT(${conflict.map((c) => `"${c}"`).join(",")}) DO ${upd.length ? `UPDATE SET ${upd.map((k) => `"${k}"=excluded."${k}"`).join(",")}` : "NOTHING"}`,
    ).run(...keys.map((k) => d[k]));
  },
  update<T = any>(table: string, id: number, data: Record<string, any>): T | undefined {
    const d = clean(table, data);
    const keys = Object.keys(d);
    if (keys.length) sqlite.prepare(`UPDATE "${table}" SET ${keys.map((k) => `"${k}"=?`).join(",")} WHERE id=?`).run(...keys.map((k) => d[k]), id);
    return this.get<T>(table, id);
  },
  remove(table: string, id: number) {
    return sqlite.prepare(`DELETE FROM "${table}" WHERE id=?`).run(id).changes;
  },
  count(table: string, where = "", params: any[] = []): number {
    return (sqlite.prepare(`SELECT COUNT(*) c FROM "${table}" ${where}`).get(...params) as any).c;
  },
};

// ---------- password hashing ----------
export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

// ---------- settings ----------
export const DEFAULT_SETTINGS: Record<string, string> = {
  name: "Madarsa Gausiya Razviya",
  urduName: "مدرسہ غوثیہ رضویہ",
  place: "Islamnagar",
  address: "Islamnagar, Jharkhand, India",
  phone: "+91 98765 43210, +91 91234 56789",
  email: "office@gausiyarazviya.in",
  timings: "Sat – Thu, 7:00 AM – 1:00 PM (Friday off)",
  tagline: "Ilm • Akhlaq • Taleem • Mustaqbil",
  about:
    "Madarsa Gausiya Razviya, Islamnagar is a centre of Deeni and Asri taleem where children learn the Quran, Tajweed, Urdu, Arabic and Fiqh alongside English, Hindi and Mathematics. Our Asatiza focus on strong Akhlaq, discipline and a love for learning — preparing every child for this world and the Aakhirat.",
  session: "2026-27",
  principal: "Maulana Abdul Qadir Razvi",
  established: "1998",
  admissionOpen: "1",
  feeEnabled: "0",
  receiptFooter: "JazakAllah Khair. This is a computer-generated receipt.",
};
export function getSettings(): Record<string, string> {
  const rows = db.all<{ key: string; value: string }>("settings");
  const s = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => (s[r.key] = r.value));
  return s;
}
export function saveSettings(obj: Record<string, any>) {
  for (const [k, v] of Object.entries(obj)) db.upsert("settings", { key: k, value: String(v ?? "") }, ["key"]);
}

// ---------- seed ----------
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

export function wipe() {
  for (const t of Object.keys(TABLES)) {
    if (t === "sessions") continue;
    sqlite.exec(`DELETE FROM "${t}"; DELETE FROM sqlite_sequence WHERE name='${t}';`);
  }
}

export function seed() {
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const now = new Date();
  const today = iso(now);
  const tx = sqlite.transaction(() => {
    saveSettings(DEFAULT_SETTINGS);

    const teacherData = [
      ["Maulana Abdul Qadir Razvi", "مولانا عبد القادر رضوی", "Sadr Mudarris (Principal)", "Fazil, Jamia Ashrafia", "Male", 32000],
      ["Hafiz Mohammad Irfan", "حافظ محمد عرفان", "Mudarris — Hifz & Nazra", "Hafiz-e-Quran, Qari", "Male", 18000],
      ["Mufti Shahid Raza", "مفتی شاہد رضا", "Mudarris — Fiqh & Arabic", "Mufti, Alimiyat", "Male", 24000],
      ["Qari Naushad Alam", "قاری نوشاد عالم", "Mudarris — Tajweed", "Qari, Tajweed Certificate", "Male", 17000],
      ["Mrs. Rukhsar Parveen", "رخسار پروین", "Teacher — English", "B.A., B.Ed.", "Female", 16000],
      ["Mr. Salim Ansari", "سلیم انصاری", "Teacher — Mathematics", "B.Sc. Mathematics", "Male", 16000],
      ["Mrs. Shabana Khatoon", "شبانہ خاتون", "Teacher — Hindi & EVS", "M.A. Hindi", "Female", 15000],
      ["Maulana Tanveer Ahmad", "مولانا تنویر احمد", "Mudarris — Urdu & Diniyat", "Alim, Jamia Razviya", "Male", 19000],
    ];
    const teachers = teacherData.map(([name, urduName, designation, qualification, gender, salary], i) =>
      db.insert("teachers", {
        name, urduName, designation, qualification, gender, salary,
        phone: `+91 9${String(700000000 + i * 1234567).slice(0, 4)} ${String(700000000 + i * 1234567).slice(4, 9)}`,
        email: `${String(name).toLowerCase().replace(/^(maulana|hafiz|mufti|qari|mrs\.|mr\.)\s+/, "").split(" ")[0]}@gausiyarazviya.in`,
        joiningDate: `20${String(8 + i * 2).padStart(2, "0")}-06-0${(i % 8) + 1}`,
        address: "Islamnagar, Jharkhand", status: "Active",
      }),
    );

    const classData = [
      ["Class 1", "Darja-e-Awwal", "Qaida, Nazra basics, Urdu alphabets and early Maths & English."],
      ["Class 2", "Darja-e-Duwam", "Nazra Quran, Duas, Urdu reading, Hindi and number work."],
      ["Class 3", "Darja-e-Suwam", "Nazra with Tajweed, Diniyat, Urdu writing, English and Maths."],
      ["Class 4", "Darja-e-Chaharum", "Tajweed, Fiqh basics, Arabic introduction and Asri subjects."],
      ["Class 5", "Darja-e-Panjum", "Arabic, Fiqh, Seerat, advanced Urdu with English, Maths and EVS."],
    ];
    const fees = [300, 350, 400, 450, 500];
    const classes = classData.map(([name, alias, description], i) =>
      db.insert("classes", { name, alias, description, section: "A", classTeacherId: teachers[[1, 7, 3, 2, 0][i]].id, room: `Room ${101 + i}`, capacity: 35, monthlyFee: fees[i], sortOrder: i + 1 }),
    );

    const subjectPlan: [string, string, string, number][] = [
      ["Quran (Nazra)", "QRN", "Deeni", 1], ["Urdu", "URD", "Deeni", 7], ["Diniyat", "DIN", "Deeni", 7],
      ["English", "ENG", "Asri", 4], ["Mathematics", "MAT", "Asri", 5], ["Hindi", "HIN", "Asri", 6],
    ];
    const subjects: any[] = [];
    classes.forEach((c, ci) => {
      const plan = [...subjectPlan];
      if (ci >= 2) plan.push(["Tajweed", "TJW", "Deeni", 3]);
      if (ci >= 3) plan.push(["Arabic", "ARB", "Deeni", 2], ["Fiqh", "FQH", "Deeni", 2]);
      if (ci >= 1) plan.push(["EVS", "EVS", "Asri", 6]);
      plan.forEach(([name, code, type, t]) => subjects.push(db.insert("subjects", { name, code: `${code}${ci + 1}`, type, classId: c.id, teacherId: teachers[t].id, fullMarks: 100, passMarks: 35 })));
    });

    const boys = ["Mohammad Ayaan", "Abdul Rahman", "Mohammad Arham", "Zaid Raza", "Faizan Ali", "Mohammad Saad", "Umar Farooq", "Hamza Ansari", "Mohammad Rehan", "Arshad Alam", "Talha Raza", "Mohammad Anas", "Imran Khan", "Sufiyan Ahmad", "Mohammad Ashraf", "Danish Raza", "Salman Ali", "Mohammad Kaif", "Aqib Javed", "Rizwan Ahmad"];
    const girls = ["Ayesha Siddiqa", "Fatima Zahra", "Maryam Khatoon", "Zainab Parveen", "Khadija Bano", "Aliya Naaz", "Sana Fatima", "Hafsa Noor", "Sumayya Khatoon", "Iqra Parveen", "Rukaiya Bano", "Muskan Naaz", "Tabassum Ara", "Nazia Khatoon", "Afreen Fatima"];
    const fathers = ["Mohammad Iqbal", "Abdul Karim", "Nasir Hussain", "Shamim Ahmad", "Mohammad Yunus", "Jamil Akhtar", "Rafiq Ansari", "Mohammad Sajid", "Anwar Hussain", "Mushtaq Alam", "Mohammad Idris", "Wasim Raza", "Kalim Ahmad", "Mohammad Rafi", "Zahid Hussain", "Aslam Ansari", "Mohammad Qasim", "Firoz Alam", "Nadeem Akhtar", "Mohammad Hanif", "Shahnawaz Khan", "Irshad Ali", "Mohammad Salim", "Akhtar Raza", "Sarfaraz Ahmad", "Mohammad Tahir", "Ejaz Ahmad", "Mohammad Jafar", "Iftikhar Alam", "Mehboob Ali"];
    const mothers = ["Shahnaz Begum", "Rehana Khatoon", "Nasreen Bano", "Farzana Parveen", "Rubina Khatoon", "Salma Begum", "Tarannum Ara", "Nikhat Parveen"];
    const occupations = ["Farmer", "Shopkeeper", "Tailor", "Driver", "Teacher", "Mason", "Business", "Govt. Employee", "Electrician", "Labourer"];
    const parents = fathers.map((name, i) =>
      db.insert("parents", { name, relation: "Father", phone: `+91 7${String(600000000 + i * 3187231).slice(0, 4)} ${String(600000000 + i * 3187231).slice(4, 9)}`, email: i < 3 ? `${name.toLowerCase().replace(/\s+/g, ".")}@gmail.com` : "", occupation: pick(occupations), address: `Ward ${1 + (i % 9)}, Islamnagar` }),
    );

    const students: any[] = [];
    let adm = 1;
    let bi = 0, gi = 0;
    classes.forEach((c, ci) => {
      const n = 10 + (ci % 3);
      for (let k = 0; k < n; k++) {
        const isBoy = r() > 0.42;
        const name = isBoy ? boys[bi++ % boys.length] : girls[gi++ % girls.length];
        const p = parents[(ci * 6 + k) % parents.length];
        const age = 6 + ci;
        students.push(db.insert("students", {
          admissionNo: `MGR-${2026 - (ci > 0 ? 1 : 0)}-${String(adm++).padStart(3, "0")}`,
          name, gender: isBoy ? "Male" : "Female",
          dob: `${2026 - age}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
          classId: c.id, rollNo: k + 1, fatherName: p.name, motherName: pick(mothers), parentId: p.id,
          phone: p.phone, address: p.address, bloodGroup: pick(["A+", "B+", "O+", "AB+", "B-", "O-"]),
          admissionDate: ci > 0 ? "2025-04-05" : "2026-04-03", status: "Active",
        }));
      }
    });

    // attendance: last 45 days, skip Fridays
    const stmtAtt = sqlite.prepare(`INSERT OR IGNORE INTO attendance (studentId, classId, date, status, markedBy) VALUES (?,?,?,?,?)`);
    for (let d = 45; d >= 1; d--) {
      const day = new Date(now);
      day.setDate(day.getDate() - d);
      if (day.getDay() === 5) continue;
      const ds = iso(day);
      students.forEach((s, idx) => {
        const weak = idx % 9 === 4; // a few chronic absentees
        const x = r();
        const st = x < (weak ? 0.26 : 0.06) ? "Absent" : x < (weak ? 0.32 : 0.09) ? "Leave" : x < (weak ? 0.36 : 0.12) ? "Late" : "Present";
        stmtAtt.run(s.id, s.classId, ds, st, "Class Teacher");
      });
    }

    // exams
    const exams: any[] = [];
    classes.forEach((c) => {
      exams.push(db.insert("exams", { name: "Quarterly Examination", classId: c.id, startDate: "2026-07-06", endDate: "2026-07-13", totalMarks: 100, published: 1, description: "First term assessment" }));
      exams.push(db.insert("exams", { name: "Half-Yearly Examination", classId: c.id, startDate: "2026-10-12", endDate: "2026-10-21", totalMarks: 100, published: 0, description: "Imtihaan-e-Nisf Saala" }));
    });
    const stmtRes = sqlite.prepare(`INSERT OR IGNORE INTO results (examId, studentId, subjectId, marks, remarks) VALUES (?,?,?,?,?)`);
    exams.filter((e) => e.published).forEach((e) => {
      const subs = subjects.filter((s) => s.classId === e.classId);
      students.filter((s) => s.classId === e.classId).forEach((s, i) => {
        const ability = 45 + ((i * 37) % 50);
        subs.forEach((sub) => stmtRes.run(e.id, s.id, sub.id, Math.max(18, Math.min(99, Math.round(ability + (r() - 0.5) * 24))), ""));
      });
    });

    // fees: April → current month
    const months: string[] = [];
    const m0 = new Date(2026, 3, 1);
    for (let d = new Date(m0); d <= now; d.setMonth(d.getMonth() + 1)) months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    let rc = 1001;
    const stmtFee = sqlite.prepare(`INSERT OR IGNORE INTO fees (studentId, month, amount, paidAmount, status, method, paidOn, receiptNo, remarks) VALUES (?,?,?,?,?,?,?,?,?)`);
    students.forEach((s, si) => {
      const amt = classes.find((c) => c.id === s.classId)!.monthlyFee;
      months.forEach((m, mi) => {
        const last = mi === months.length - 1;
        const defaulter = si % 11 === 3 && mi >= months.length - 3;
        const paid = !defaulter && (last ? r() > 0.45 : r() > 0.04);
        const partial = !paid && !defaulter && r() > 0.6;
        const status = paid ? "Paid" : partial ? "Partial" : "Unpaid";
        const pa = paid ? amt : partial ? Math.round(amt / 2) : 0;
        stmtFee.run(s.id, m, amt, pa, status, pa ? pick(["Cash", "Cash", "UPI", "Bank"]) : "", pa ? `${m}-${String(3 + Math.floor(r() * 10)).padStart(2, "0")}` : "", pa ? `RCPT-${rc++}` : "", "");
      });
    });

    // expenses
    const expCats: [string, string, number][] = [["Staff salary", "Salary", 0], ["Electricity bill", "Utilities", 2400], ["Books & Qaida purchase", "Books & Stationery", 3500], ["Building repair", "Maintenance", 6000], ["Water & cleaning", "Utilities", 900], ["Iftar / Mehfil arrangement", "Events", 4500]];
    const salaryTotal = teachers.reduce((a, t) => a + t.salary, 0);
    months.forEach((m, mi) => {
      db.insert("expenses", { title: `Staff salary — ${m}`, category: "Salary", amount: salaryTotal, date: `${m}-05`, paidTo: "All staff", method: "Bank", notes: "" });
      expCats.slice(1).forEach(([title, category, amount], k) => {
        if ((mi + k) % 2 === 0) db.insert("expenses", { title, category, amount: amount + Math.round(r() * 800), date: `${m}-${String(10 + k * 3).padStart(2, "0")}`, paidTo: pick(["Local vendor", "JBVNL", "Maktaba Razviya", "Contractor"]), method: pick(["Cash", "UPI"]), notes: "" });
      });
    });

    // donations (Zakat / Sadqa / Lillah / Chanda) — main income of the madarsa
    const donors = ["Haji Abdul Sattar", "Janab Iqbal Ahmad", "Anjuman Islamia Committee", "Mohammad Shakeel (Dubai)", "Haji Nizamuddin", "Jama Masjid Committee", "Janab Rafiq Qureshi", "Anonymous", "Dr. Sameer Khan", "Haji Mushtaq Ansari"];
    const dTypes = ["Zakat", "Sadqa", "Lillah", "Chanda", "Atiya"];
    let dr = 5001;
    months.forEach((m, mi) => {
      const n = 10 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const type = pick(dTypes);
        const amount = type === "Zakat" ? 20000 + Math.round(r() * 40) * 1000 : 2000 + Math.round(r() * 18) * 500;
        const day = Math.min(28, 1 + Math.floor(r() * 27));
        const date = `${m}-${String(day).padStart(2, "0")}`;
        if (date > iso(now)) continue;
        db.insert("donations", { receiptNo: `DN-${dr++}`, donorName: pick(donors), phone: `+91 9${Math.floor(100000000 + r() * 899999999)}`.replace(/(\d{5})(\d{5})$/, "$1 $2"), type, amount, date, method: pick(["Cash", "UPI", "Bank", "Cash"]), purpose: pick(["General fund", "Talaba kitchen", "Building fund", "Books for talaba", "Asatiza salary"]), notes: "" });
      }
    });

    // homework & online classes
    const addDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d); };
    classes.forEach((c, ci) => {
      const subs = subjects.filter((s) => s.classId === c.id);
      [["Memorise Surah Al-Fil with Tajweed", 0], ["Write 10 Urdu words with meaning", 1], ["Exercise 4.2 — Addition & subtraction", 4], ["Learn the Dua before eating", 2]].forEach(([title, si], k) => {
        const sub = subs[Number(si) % subs.length];
        db.insert("homework", { classId: c.id, subjectId: sub.id, title, description: "Complete neatly in your notebook and show to the Ustad.", assignedOn: addDays(-k - 1), dueDate: addDays(2 - k), teacherId: sub.teacherId });
      });
      const sub = subs[ci % subs.length];
      db.insert("onlineClasses", { classId: c.id, subjectId: sub.id, topic: `${sub.name} — revision session`, date: addDays(1 + (ci % 3)), time: "17:30", duration: 45, platform: "Google Meet", link: "https://meet.google.com/", teacherId: sub.teacherId });
    });

    // notices & events
    [
      ["Admissions open for session 2026-27", "Admissions for Class 1 to Class 5 are open. Parents can apply online or visit the office with Aadhaar and birth certificate.", "All", "High", addDays(-6), 1],
      ["Half-Yearly Examination from 12 October", "The Half-Yearly (Nisf Saala) examinations will begin on 12 October 2026. Detailed date sheet is available on the portal.", "All", "High", addDays(-2), 1],
      ["Parent–Teacher Meeting", "PTM will be held on Saturday at 10:00 AM. Parents are requested to attend and review their child’s progress.", "Parents", "Normal", addDays(-1), 1],
      ["Staff meeting — syllabus review", "All Asatiza must attend the syllabus review meeting after Zuhr on Thursday.", "Teachers", "Normal", addDays(-3), 0],
      ["Jashn-e-Eid Milad-un-Nabi programme", "Students will present Naat, Taqreer and Qirat. Parents are warmly invited.", "All", "Normal", addDays(-10), 1],
    ].forEach(([title, body, audience, priority, date, isPublic]) => db.insert("notices", { title, body, audience, priority, date, isPublic }));
    [
      ["Half-Yearly Examination", "2026-10-12", "2026-10-21", "Exam"],
      ["Gandhi Jayanti — holiday", "2026-10-02", "", "Holiday"],
      ["Parent–Teacher Meeting", addDays(5), "", "Event"],
      ["Annual Jalsa & Dastarbandi", "2026-12-20", "", "Event"],
      ["Winter break", "2026-12-28", "2027-01-03", "Holiday"],
    ].forEach(([title, date, endDate, type]) => db.insert("events", { title, date, endDate, type, description: "" }));

    // admissions & enquiries
    const ts = (h: number) => new Date(now.getTime() - h * 3600e3).toISOString();
    [["Mohammad Ahil", "Male", 0, "Shakeel Ahmad", "+91 9431112233"], ["Zoya Fatima", "Female", 1, "Mohammad Arif", "+91 9955443322"], ["Huzaifa Raza", "Male", 2, "Nawab Hussain", "+91 8877665544"]].forEach(([studentName, gender, ci, fatherName, phone], i) =>
      db.insert("admissions", { appNo: `ADM-2026-${String(101 + i).padStart(4, "0")}`, studentName, gender, dob: `${2019 - Number(ci)}-05-1${i}`, classId: classes[Number(ci)].id, fatherName, motherName: pick(mothers), phone, email: "", previousSchool: i === 2 ? "Maktab Noorul Islam" : "", address: "Islamnagar", notes: "", status: "pending", createdAt: ts(20 + i * 30) }),
    );
    [["Rashid Khan", "+91 9123456780", "Ayan Khan", "Class 1", "What documents are required for admission?"], ["Nazma Begum", "+91 9988776655", "Sadia", "Class 3", "Is there transport facility from Rampur?"]].forEach(([name, phone, studentName, classWanted, message], i) =>
      db.insert("enquiries", { name, phone, studentName, classWanted, message, status: i ? "contacted" : "new", createdAt: ts(8 + i * 26) }),
    );

    // users
    const u = (name: string, email: string, role: string, linkedId: number | null, pw: string) =>
      db.insert("users", { name, email, role, status: "active", linkedId, passwordHash: hashPassword(pw), createdAt: new Date().toISOString(), phone: "" });
    // ensure provided Super Admin exists and is upserted so credentials persist
    const providedSuperAdminEmail = process.env.SUPERADMIN_EMAIL || "gausiyamadarsa92@gmail.com";
    const providedSuperAdminPass = process.env.SUPERADMIN_PW || "9934886605dilD@";
    db.upsert("users", { name: "Super Admin", email: providedSuperAdminEmail, role: "super_admin", status: "active", linkedId: null, passwordHash: hashPassword(providedSuperAdminPass), createdAt: new Date().toISOString(), phone: "" }, ["email"]);
    const sa = db.find("users", "email = ?", [providedSuperAdminEmail]);
    u("Office Admin", "admin@madarsa.in", "admin", null, "admin123");
    const tu = u(teachers[1].name, "teacher@madarsa.in", "teacher", teachers[1].id, "teacher123");
    const firstStudent = students[0];
    const pu = u(parents[firstStudent.parentId - 1].name, "parent@madarsa.in", "parent", firstStudent.parentId, "parent123");
    u(firstStudent.name, "student@madarsa.in", "student", firstStudent.id, "student123");
    db.insert("users", { name: "Nadeem Akhtar", email: "nadeem.akhtar@gmail.com", role: "parent", status: "pending", linkedId: null, passwordHash: hashPassword("parent123"), createdAt: ts(5), phone: "+91 9000011111" });

    // feed
    [
      [sa.id, "Super Admin", "super_admin", "Alhamdulillah! 12 students of Class 5 completed their first Dora of Quran-e-Kareem this month. Mubarakbaad to all Asatiza and parents.", 30],
      [tu.id, teachers[1].name, "teacher", "Tajweed practice session for Class 3 will continue every Thursday after Asr. Please ensure children revise Makharij at home.", 12],
    ].forEach(([authorId, authorName, authorRole, text, h]) => db.insert("feed", { authorId, authorName, authorRole, text, likes: "[]", createdAt: ts(Number(h)) }));

    // messages parent <-> teacher
    [[pu.id, tu.id, "Assalamu Alaikum Hafiz sahab, how is Ayaan doing in Nazra?", 26], [tu.id, pu.id, "Walaikum Assalam. MashaAllah he is improving — please make him revise 15 minutes daily.", 25]].forEach(([fromId, toId, body, h]) =>
      db.insert("messages", { fromId, toId, body, isRead: 1, createdAt: ts(Number(h)) }),
    );
    db.insert("activity", { userId: sa.id, userName: "System", action: "Database initialised with demo data", module: "system", detail: "", createdAt: new Date().toISOString() });
  });
  tx();
}

export function ensureSeed() {
  migrate();
  const needsSeed =
    db.count("users") === 0 ||
    db.count("classes") === 0 ||
    db.count("subjects") === 0 ||
    db.count("students") === 0 ||
    db.count("exams") === 0;

  if (needsSeed) seed();

  // Always ensure provided Super Admin exists (allows overriding demo credentials)
  try {
    const providedSuperAdminEmail = process.env.SUPERADMIN_EMAIL || "gausiyamadarsa92@gmail.com";
    const providedSuperAdminPass = process.env.SUPERADMIN_PW || "9934886605dilD@";
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(providedSuperAdminPass, salt, 64).toString("hex");
    const stored = `${salt}:${hash}`;
    sqlite.prepare(
      `INSERT INTO "users" (name,email,role,status,linkedId,passwordHash,createdAt,phone) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name, role=excluded.role, status=excluded.status, linkedId=excluded.linkedId, passwordHash=excluded.passwordHash, createdAt=excluded.createdAt, phone=excluded.phone`,
    ).run("Super Admin", providedSuperAdminEmail, "super_admin", "active", null, stored, new Date().toISOString(), "");
  } catch (err) {
    console.error("ensureSeed: failed to upsert provided Super Admin", err);
  }
}
