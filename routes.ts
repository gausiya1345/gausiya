import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { TABLES, type Role } from "@shared/schema";
import { db, sqlite, ensureSeed, hashPassword, verifyPassword, getSettings, saveSettings, schemaSQL, wipe, seed, DB_PATH } from "./db";

type User = { id: number; name: string; email: string; role: Role; status: string; linkedId: number | null; phone?: string; lastLogin?: string };
declare global {
  namespace Express {
    interface Request { user?: User }
  }
}

const STAFF: Role[] = ["super_admin", "admin", "teacher"];
const ADMINS: Role[] = ["super_admin", "admin"];
const feeEnabled = () => getSettings().feeEnabled !== "0";
const nowISO = () => new Date().toISOString();
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const publicUser = (u: any) => { if (!u) return u; const { passwordHash, ...rest } = u; return rest; };

// ---------- realtime (Server-Sent Events) ----------
type Client = { id: string; userId: number; role: Role; res: Response };
const clients = new Map<string, Client>();
function send(c: Client, event: any) { try { c.res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {} }
function broadcast(event: any, filter?: (c: Client) => boolean) { clients.forEach((c) => (!filter || filter(c)) && send(c, event)); }
function onlineIds() { return Array.from(new Set(Array.from(clients.values()).map((c) => c.userId))); }
function presence() { broadcast({ type: "presence", online: onlineIds() }); }
function changed(...collections: string[]) { broadcast({ type: "change", collections: [...collections, "activity"] }); }

function notify(userIds: number[], title: string, body: string, link = "", kind = "info") {
  const uniq = Array.from(new Set(userIds.filter(Boolean)));
  const createdAt = nowISO();
  uniq.forEach((userId) => {
    const n = db.insert("notifications", { userId, title, body, link, kind, isRead: 0, createdAt });
    broadcast({ type: "notify", notification: n }, (c) => c.userId === userId);
  });
}
const usersWhere = (where: string, params: any[] = []) => db.all<User>("users", `WHERE status='active' AND ${where}`, params).map((u) => u.id);
const adminIds = () => usersWhere(`role IN ('super_admin','admin')`);
const makeStudentCode = () => {
  const y = new Date().getFullYear();
  let code = `STU-${y}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  while (
    db.find<any>("students", "studentCode=?", [code]) ||
    db.find<any>("admissions", "studentCode=? AND status IN ('pending','approved')", [code])
  ) {
    code = `STU-${y}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  }
  return code;
};
const makeLinkCode = () => {
  let code = "";
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (db.find<any>("students", "linkCode=?", [code]));
  return code;
};
function familyUserIds(studentIds: number[]) {
  if (!studentIds.length) return [];
  const ph = studentIds.map(() => "?").join(",");
  const parentIds = (sqlite.prepare(`SELECT DISTINCT parentId FROM students WHERE id IN (${ph})`).all(...studentIds) as any[]).map((r) => r.parentId).filter(Boolean);
  const a = parentIds.length ? usersWhere(`role='parent' AND linkedId IN (${parentIds.map(() => "?").join(",")})`, parentIds) : [];
  const b = usersWhere(`role='student' AND linkedId IN (${ph})`, studentIds);
  return [...a, ...b];
}
const classFamilyIds = (classId: number) => familyUserIds(db.all("students", "WHERE classId=? AND status='Active'", [classId]).map((s: any) => s.id));

function log(req: Request, action: string, module: string, detail = "") {
  db.insert("activity", { userId: req.user?.id ?? null, userName: req.user?.name ?? "Public website", action, module, detail, createdAt: nowISO() });
}

// ---------- auth ----------
function userFromToken(token?: string): User | undefined {
  if (!token) return;
  const s = db.find<any>("sessions", "token=?", [token]);
  if (!s) return;
  const u = db.get<any>("users", s.userId);
  if (!u || !["active", "pending"].includes(u.status)) return;
  return publicUser(u);
}
function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.query.token as string);
  const u = userFromToken(token);
  if (!u) return res.status(401).json({ message: "Please sign in again" });
  req.user = u;
  next();
}
const allow = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) =>
  roles.includes(req.user!.role) ? next() : res.status(403).json({ message: "You don't have permission for this action" });

// ---------- scoping ----------
function scope(u: User) {
  if (u.role === "parent") {
    const kids = db.all<any>("students", "WHERE parentId=?", [u.linkedId ?? -1]);
    return { studentIds: kids.map((k) => k.id), classIds: Array.from(new Set(kids.map((k) => k.classId))) };
  }
  if (u.role === "student") {
    const s = db.get<any>("students", u.linkedId ?? -1);
    return { studentIds: s ? [s.id] : [], classIds: s ? [s.classId] : [] };
  }
  return null;
}

const READ: Record<string, Role[] | "all"> = {
  students: "all", teachers: "all", parents: "all", classes: "all", subjects: "all", attendance: "all",
  exams: "all", results: "all", fees: "all", homework: "all", onlineClasses: "all", notices: "all",
  events: "all", feed: "all", expenses: ADMINS, donations: ADMINS, admissions: ADMINS, enquiries: ADMINS, users: ADMINS, activity: ADMINS,
};
const WRITE: Record<string, Role[]> = {
  students: ADMINS, teachers: ADMINS, parents: ADMINS, classes: ADMINS, subjects: ADMINS, attendance: STAFF,
  exams: ADMINS, results: STAFF, fees: ADMINS, expenses: ADMINS, donations: ADMINS, homework: STAFF, onlineClasses: STAFF,
  notices: ADMINS, events: ADMINS, feed: ["super_admin", "admin", "teacher", "parent", "student"],
  admissions: ADMINS, enquiries: ADMINS, users: ["super_admin"],
};

function readRows(u: User, col: string) {
  if (col === "fees" && !feeEnabled()) return [];
  let rows = db.all<any>(col, "ORDER BY id DESC");
  const sc = scope(u);
  const inS = (id: number) => sc!.studentIds.includes(id);
  const inC = (id: number) => sc!.classIds.includes(id);
  if (sc) {
    switch (col) {
      case "students": rows = rows.filter((r) => inS(r.id)); break;
      case "attendance": case "fees": rows = rows.filter((r) => inS(r.studentId)); break;
      case "results": {
        const pub = new Set(db.all<any>("exams", "WHERE published=1").map((e) => e.id));
        rows = rows.filter((r) => inS(r.studentId) && pub.has(r.examId)); break;
      }
      case "homework": case "onlineClasses": case "exams": case "subjects": rows = rows.filter((r) => inC(r.classId)); break;
      case "parents": rows = rows.filter((r) => u.role === "parent" ? r.id === u.linkedId : db.all<any>("students", "WHERE id=?", [u.linkedId]).some((s) => s.parentId === r.id)); break;
      case "notices": rows = rows.filter((r) => ["All", u.role === "parent" ? "Parents" : "Students"].includes(r.audience)); break;
    }
  } else if (u.role === "teacher" && col === "notices") {
    rows = rows.filter((r) => ["All", "Teachers"].includes(r.audience));
  }
  if (col === "teachers" && !ADMINS.includes(u.role)) rows = rows.map(({ salary, ...r }) => (u.role === "teacher" && r.id === u.linkedId ? { ...r, salary } : r));
  if (col === "users") rows = rows.map(publicUser);
  if (col === "admissions") {
    rows = rows.map((r) => {
      if (u.role !== "super_admin") return (({ password, ...rest }) => rest)(r);
      return r;
    });
  }
  return rows;
}

function nextAppNo() {
  const n = db.count("admissions") + 101;
  let no = `ADM-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
  while (db.find("admissions", "appNo=?", [no])) no = `ADM-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  return no;
}
function nextAdmissionNo() {
  const y = new Date().getFullYear();
  const rows = db.all<any>("students", "WHERE admissionNo LIKE ?", [`MGR-${y}-%`]);
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.admissionNo).split("-")[2]) || 0), 0);
  const all = db.count("students");
  return `MGR-${y}-${String(Math.max(max, all) + 1).padStart(3, "0")}`;
}
function nextReceipt() {
  const r = sqlite.prepare(`SELECT receiptNo FROM fees WHERE receiptNo LIKE 'RCPT-%'`).all() as any[];
  const max = r.reduce((m, x) => Math.max(m, Number(String(x.receiptNo).slice(5)) || 0), 1000);
  return `RCPT-${max + 1}`;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  ensureSeed();

  app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS"); if (req.method === "OPTIONS") return res.sendStatus(204); next(); });

  // ---------- public ----------
  app.get("/api/public", (_req, res) => {
    const s = getSettings();
    const classes = db.all<any>("classes", "ORDER BY sortOrder, id");
    const today = todayISO();
    const exams = db.all<any>("exams", "WHERE endDate >= ? ORDER BY startDate", [today]);
    const byName = new Map<string, any>();
    exams.forEach((e) => { const k = e.name + e.startDate; const c = classes.find((x) => x.id === e.classId); if (!byName.has(k)) byName.set(k, { ...e, classNames: [c?.name] }); else byName.get(k).classNames.push(c?.name); });
    res.json({
      settings: s,
      admissionOpen: s.admissionOpen === "1",
      stats: { students: db.count("students", "WHERE status='Active'"), teachers: db.count("teachers", "WHERE status='Active'"), classes: classes.length, subjects: new Set(db.all<any>("subjects").map((x) => x.name)).size },
      classes: classes.map((c) => ({ id: c.id, name: c.name, alias: c.alias, description: c.description, monthlyFee: c.monthlyFee, students: db.count("students", "WHERE classId=? AND status='Active'", [c.id]) })),
      notices: db.all<any>("notices", "WHERE isPublic=1 ORDER BY date DESC, id DESC LIMIT 5"),
      exams: Array.from(byName.values()).slice(0, 5),
      events: db.all<any>("events", "WHERE date >= ? ORDER BY date LIMIT 5", [today]),
      feed: db.all<any>("feed", "ORDER BY createdAt DESC LIMIT 3"),
    });
  });

  app.post("/api/public/enquiry", (req, res) => {
    const { name, phone } = req.body || {};
    if (!name || !phone) return res.status(400).json({ message: "Please enter your name and phone number" });
    const e = db.insert("enquiries", { ...req.body, status: "new", createdAt: nowISO() });
    log(req, `New enquiry from ${name}`, "enquiries", phone);
    notify(adminIds(), "New admission enquiry", `${name} (${phone}) — ${req.body.classWanted || "General"}`, "/enquiries", "enquiry");
    changed("enquiries");
    res.json(e);
  });

  app.post("/api/public/admission", (req, res) => {
    const s = getSettings();
    if (s.admissionOpen !== "1") return res.status(400).json({ message: "Admissions are currently closed" });
    const b = req.body || {};
    for (const f of ["studentName", "gender", "dob", "classId", "fatherName", "phone", "email", "password"]) if (!b[f]) return res.status(400).json({ message: "Please fill all required (*) fields" });
    const email = String(b.email).trim();
    const password = String(b.password).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Please enter a valid email address" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    const existingUser = db.find<any>("users", "lower(email)=lower(?)", [email]);
    if (existingUser) return res.status(400).json({ message: "This email is already registered. Please use another email." });
    const studentCode = makeStudentCode();
    const a = db.insert<any>("admissions", { ...b, email, password, studentCode, appNo: nextAppNo(), status: "pending", createdAt: nowISO() });
    log(req, `Online admission form: ${a.studentName}`, "admissions", a.appNo);
    notify(adminIds(), "New admission application", `${a.studentName} — ${a.appNo} — ID ${a.studentCode}`, "/admissions", "admission");
    changed("admissions");
    res.json({ appNo: a.appNo, status: a.status, studentCode: a.studentCode, email: a.email });
  });

  app.get("/api/public/admission-status", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "Enter application number or phone" });
    const rows = db.all<any>("admissions", "WHERE appNo=? OR phone=? OR replace(phone,' ','')=? ORDER BY id DESC", [q.toUpperCase(), q, q.replace(/\s/g, "")]);
    const classes = db.all<any>("classes");
    res.json(rows.map((a) => ({ appNo: a.appNo, studentName: a.studentName, className: classes.find((c) => c.id === a.classId)?.name, status: a.status, reason: a.reason, createdAt: a.createdAt, admissionNo: a.studentId ? db.get<any>("students", a.studentId)?.admissionNo : null })));
  });

  // ---------- auth ----------
  app.post("/api/login", (req, res) => {
    const { email, password } = req.body || {};
    const u = db.find<any>("users", "lower(email)=lower(?)", [String(email || "").trim()]);
    if (!u || !verifyPassword(String(password || ""), u.passwordHash)) return res.status(400).json({ message: "Incorrect email or password" });
    // Allow users with status 'active' or 'pending' to sign in so admin approval isn't required.
    if (u.status === "disabled") return res.status(403).json({ message: "This account has been disabled" });
    const token = crypto.randomBytes(24).toString("hex");
    db.insert("sessions", { token, userId: u.id, createdAt: nowISO() });
    db.update("users", u.id, { lastLogin: nowISO() });
    req.user = publicUser(u);
    log(req, "Signed in", "auth");
    changed("users");
    res.json({ token, user: publicUser(db.get("users", u.id)) });
  });

  app.post("/api/google/login", async (req, res) => {
    const credential = String(req.body?.credential || "").trim();
    const fallbackEmail = String(req.body?.email || "").trim().toLowerCase();
    const fallbackName = String(req.body?.name || fallbackEmail.split("@")[0] || "Google user").trim();
    const rawRole = String(req.body?.role || "parent").trim().toLowerCase();
    const role: Role = rawRole === "student" ? "student" : rawRole === "user" ? "user" : "parent";

    let payload: any = null;
    if (credential) {
      try {
        const infoUrl = `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${encodeURIComponent(credential)}`;
        const info = await fetch(infoUrl);
        if (!info.ok) throw new Error("Invalid Google token");
        payload = await info.json();
      } catch {
        return res.status(401).json({ message: "Google login could not be verified. Please try again." });
      }
    } else if (fallbackEmail) {
      payload = { email: fallbackEmail, email_verified: true, name: fallbackName };
    } else {
      return res.status(400).json({ message: "Google login credential or Gmail address is required" });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    if (clientId && payload.aud && payload.aud !== clientId) {
      return res.status(401).json({ message: "Google login audience mismatch" });
    }

    if (!payload.email || payload.email_verified === false || payload.email_verified === "false") {
      return res.status(401).json({ message: "Google email is not verified" });
    }

    const email = String(payload.email).trim().toLowerCase();
    const name = String(payload.name || payload.given_name || email.split("@")[0] || "Google user").trim();

    let u = db.find<any>("users", "lower(email)=lower(?)", [email]);
    if (!u) {
      const parentRow = role === "parent" ? db.insert<any>("parents", { name, relation: "Parent", phone: "", email, address: "", occupation: "" }) : null;
      u = db.insert<any>("users", {
        name,
        email,
        phone: "",
        role,
        status: "active",
        linkedId: parentRow?.id ?? null,
        passwordHash: hashPassword(crypto.randomBytes(16).toString("hex")),
        createdAt: nowISO(),
      });
      log({ user: publicUser(u) } as any, `Google sign-up: ${name}`, "auth", email);
      changed("users", "parents");
    }

    if (u.status === "disabled") return res.status(403).json({ message: "This account has been disabled" });
    if (u.role !== role && ["student", "parent", "user"].includes(role)) {
      db.update("users", u.id, { role, lastLogin: nowISO() });
      u = db.get<any>("users", u.id);
    }

    const token = crypto.randomBytes(24).toString("hex");
    db.insert("sessions", { token, userId: u.id, createdAt: nowISO() });
    db.update("users", u.id, { lastLogin: nowISO() });
    const user = publicUser(db.get("users", u.id));
    res.json({ token, user });
  });

  app.post("/api/signup", (req, res) => {
    const { name, email, password, phone, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
    if (String(password).length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    if (db.find("users", "lower(email)=lower(?)", [email])) return res.status(400).json({ message: "An account with this email already exists" });
    const r = role === "student" ? "student" : role === "user" ? "user" : "parent";
    const parentRow = r === "parent" ? db.insert<any>("parents", { name, relation: "Parent", phone: phone || "", email: String(email).trim(), address: "", occupation: "" }) : null;
    // Auto-approve new sign-ups: create with active status so Super Admin approval isn't required
    const u = db.insert<any>("users", { name, email: String(email).trim(), phone, role: r, status: "active", linkedId: parentRow?.id ?? null, passwordHash: hashPassword(password), createdAt: nowISO() });
    log(req, `New sign-up (auto-approved): ${name}`, "users", email);
    notify([u.id], "Account approved", "Your portal account is now active. Welcome!", "/dashboard", "account");
    changed("users", "parents");
    res.json({ ok: true, id: u.id, linkedId: u.linkedId ?? parentRow?.id ?? null });
  });

  app.post("/api/logout", auth, (req, res) => {
    const token = (req.headers.authorization || "").slice(7);
    sqlite.prepare("DELETE FROM sessions WHERE token=?").run(token);
    res.json({ ok: true });
  });

  app.post("/api/parent/link-request", auth, (req, res) => {
    if (req.user!.role !== "parent") return res.status(403).json({ message: "Only parent accounts can request a child link" });
    const input = String(req.body?.studentId ?? req.body?.studentCode ?? "").trim();
    if (!input) return res.status(400).json({ message: "Enter the student ID or link code" });

    let student = db.find<any>("students", "id=?", [Number(input)]);
    if (!student && input.length >= 4) student = db.find<any>("students", "studentCode=? OR linkCode=? OR admissionNo=?", [input, input, input]);
    if (!student) return res.status(404).json({ message: "Student not found" });

    let parentRow = req.user!.linkedId ? db.get<any>("parents", req.user!.linkedId) : null;
    if (!parentRow) {
      parentRow = db.insert<any>("parents", { name: req.user!.name, relation: "Parent", phone: req.user!.phone || "", email: req.user!.email, address: "", occupation: "" });
      db.update("users", req.user!.id, { linkedId: parentRow.id });
    }
    if (student.parentId && student.parentId !== parentRow.id) return res.status(400).json({ message: "This student is already linked to another parent record" });

    const code = makeLinkCode();
    db.update("students", student.id, { linkCode: code, linkRequestedBy: parentRow.id, linkRequestedAt: nowISO() });
    const studentUser = db.find<any>("users", "role='student' AND linkedId=?", [student.id]);
    if (studentUser) notify([studentUser.id], "Parent link request", `${req.user!.name} requested to link with ${student.name}. Enter code ${code} in your profile.`, `/students/${student.id}`, "link");
    res.json({ ok: true, studentId: student.id, studentName: student.name, linkCode: code, message: "Ask the student to enter this code on their profile to verify the link." });
  });

  app.post("/api/student/verify-link", auth, (req, res) => {
    if (req.user!.role !== "student") return res.status(403).json({ message: "Only student accounts can verify a parent link" });
    const student = db.get<any>("students", req.user!.linkedId ?? -1);
    if (!student) return res.status(404).json({ message: "Student record not found" });

    const code = String(req.body?.linkCode ?? "").trim();
    if (!code) return res.status(400).json({ message: "Enter the verification code" });
    if (!student.linkCode || student.linkCode !== code) return res.status(400).json({ message: "The verification code is incorrect or expired" });

    const parentId = Number(student.linkRequestedBy ?? student.parentId ?? 0);
    if (!parentId) return res.status(400).json({ message: "There is no parent link request to verify" });
    const parent = db.get<any>("parents", parentId);
    const parentUser = parent ? db.find<any>("users", "role='parent' AND linkedId=?", [parent.id]) : null;
    if (!parent) return res.status(404).json({ message: "Parent record not found" });

    db.update("students", student.id, { parentId, linkCode: null, linkRequestedBy: null, linkRequestedAt: null, linkVerifiedAt: nowISO() });
    if (parentUser) db.update("users", parentUser.id, { linkedId: parent.id });
    notify(parentUser ? [parentUser.id] : [], "Student verified", `${student.name} has confirmed the child-link request.`, `/students/${student.id}`, "link");
    res.json({ ok: true, studentId: student.id, studentName: student.name, parentName: parent.name, message: `Verified successfully with ${parent.name}.` });
  });

  app.post("/api/admin/verify-parent-link", auth, allow(...ADMINS), (req, res) => {
    const studentId = Number(req.body?.studentId ?? req.body?.id ?? 0);
    const parentId = Number(req.body?.parentId ?? req.body?.linkedId ?? 0);
    const code = String(req.body?.linkCode ?? "").trim();
    if (!studentId || !parentId || !code) return res.status(400).json({ message: "Student ID, parent ID and verification code are required" });

    const student = db.get<any>("students", studentId);
    if (!student) return res.status(404).json({ message: "Student record not found" });
    const parent = db.get<any>("parents", parentId);
    if (!parent) return res.status(404).json({ message: "Parent record not found" });
    if (student.linkRequestedBy && Number(student.linkRequestedBy) !== parentId) return res.status(400).json({ message: "This verification code belongs to a different parent request" });
    if (!student.linkCode || student.linkCode !== code) return res.status(400).json({ message: "The verification code is incorrect or expired" });

    const parentUser = db.find<any>("users", "role='parent' AND linkedId=?", [parent.id]);
    db.update("students", student.id, { parentId: parent.id, linkCode: null, linkRequestedBy: null, linkRequestedAt: null, linkVerifiedAt: nowISO() });
    if (parentUser) db.update("users", parentUser.id, { linkedId: parent.id });
    notify(parentUser ? [parentUser.id] : [], "Parent link approved", `${student.name} was linked with ${parent.name} by admin approval.`, `/students/${student.id}`, "link");
    res.json({ ok: true, studentId: student.id, parentName: parent.name, message: `Verified successfully with ${parent.name}.` });
  });

  app.get("/api/me", auth, (req, res) => res.json(req.user));
  app.post("/api/me/password", auth, (req, res) => {
    const { current, next } = req.body || {};
    const u = db.get<any>("users", req.user!.id);
    if (!verifyPassword(String(current || ""), u.passwordHash)) return res.status(400).json({ message: "Current password is incorrect" });
    if (String(next || "").length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });
    db.update("users", u.id, { passwordHash: hashPassword(next) });
    log(req, "Changed password", "auth");
    res.json({ ok: true });
  });

  // ---------- realtime stream ----------
  app.get("/api/events", (req, res) => {
    const u = userFromToken(req.query.token as string);
    if (!u) return res.status(401).end();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 3000\n\n`);
    const id = crypto.randomBytes(8).toString("hex");
    const c: Client = { id, userId: u.id, role: u.role, res };
    clients.set(id, c);
    send(c, { type: "hello", online: onlineIds() });
    presence();
    const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
    req.on("close", () => { clearInterval(ping); clients.delete(id); presence(); });
  });

  // ---------- settings ----------
  app.get("/api/settings", auth, (_req, res) => res.json(getSettings()));
  app.put("/api/settings", auth, allow(...ADMINS), (req, res) => {
    saveSettings(req.body || {});
    log(req, "Updated madarsa settings", "settings");
    broadcast({ type: "change", collections: ["settings", "public", "activity"] });
    res.json(getSettings());
  });
  app.post("/api/admissions/toggle", auth, allow(...ADMINS), (req, res) => {
    const open = getSettings().admissionOpen === "1" ? "0" : "1";
    saveSettings({ admissionOpen: open });
    log(req, open === "1" ? "Opened admissions" : "Closed admissions", "admissions");
    broadcast({ type: "change", collections: ["settings", "public", "activity"] });
    res.json({ admissionOpen: open === "1" });
  });

  // ---------- generic collections ----------
  app.get("/api/c/:col", auth, (req, res) => {
    const col = req.params.col as string;
    if (col === "fees" && !feeEnabled()) return res.status(403).json({ message: "Fees module is currently disabled" });
    const perm = READ[col];
    if (!perm) return res.status(404).json({ message: "Unknown collection" });
    if (perm !== "all" && !perm.includes(req.user!.role)) return res.status(403).json({ message: "No access" });
    res.json(readRows(req.user!, col));
  });

  app.post("/api/c/:col", auth, (req, res) => {
    const col = req.params.col as string;
    if (col === "fees" && !feeEnabled()) return res.status(403).json({ message: "Fees module is currently disabled" });
    const perm = WRITE[col];
    if (!perm || !perm.includes(req.user!.role)) return res.status(403).json({ message: "You don't have permission for this action" });
    const b = { ...(req.body || {}) };
    delete b.id;
    if (col === "users") {
      if (!b.email || !b.password) return res.status(400).json({ message: "Email and password are required" });
      if (db.find("users", "lower(email)=lower(?)", [b.email])) return res.status(400).json({ message: "Email already in use" });
      b.passwordHash = hashPassword(b.password); b.status = b.status || "active"; b.createdAt = nowISO();
    }
    if (col === "donations" && !b.receiptNo) { const mx = (sqlite.prepare("SELECT MAX(CAST(substr(receiptNo,4) AS INTEGER)) m FROM donations").get() as any).m || 5000; b.receiptNo = `DN-${mx + 1}`; }
    if (col === "students") { b.admissionNo = b.admissionNo || nextAdmissionNo(); b.studentCode = b.studentCode || makeStudentCode(); b.status = b.status || "Active"; b.admissionDate = b.admissionDate || todayISO(); b.linkCode = b.linkCode || makeLinkCode(); }
    if (col === "feed") { b.authorId = req.user!.id; b.authorName = req.user!.name; b.authorRole = req.user!.role; b.likes = "[]"; b.createdAt = nowISO(); }
    if (col === "notices") b.date = b.date || todayISO();
    if (col === "homework") b.assignedOn = b.assignedOn || todayISO();
    if (col === "enquiries" || col === "admissions") b.createdAt = nowISO();
    if (col === "admissions") { b.appNo = nextAppNo(); b.status = b.status || "pending"; }
    let row: any;
    try { row = db.insert(col, b); } catch (e: any) { return res.status(400).json({ message: e.message.includes("UNIQUE") ? "A record with the same unique value already exists" : e.message }); }
    const label = row.name || row.title || row.topic || row.studentName || row.text?.slice(0, 40) || `#${row.id}`;
    log(req, `Added ${TABLES[col].label.toLowerCase().replace(/s$/, "")}: ${label}`, col);
    // notifications
    if (col === "notices") {
      const roles = row.audience === "Parents" ? "('parent')" : row.audience === "Teachers" ? "('teacher','admin','super_admin')" : row.audience === "Students" ? "('student')" : "('parent','student','teacher','admin','super_admin')";
      notify(usersWhere(`role IN ${roles} AND id<>?`, [req.user!.id]), `Notice: ${row.title}`, row.body?.slice(0, 120) || "", "/notices", row.priority === "High" ? "urgent" : "notice");
    }
    if (col === "homework") notify(classFamilyIds(row.classId), "New homework", `${row.title} — due ${row.dueDate}`, "/homework", "homework");
    if (col === "onlineClasses") notify(classFamilyIds(row.classId), "Online class scheduled", `${row.topic} on ${row.date} at ${row.time}`, "/online-classes", "class");
    if (col === "events") notify(usersWhere("id<>?", [req.user!.id]), `Calendar: ${row.title}`, `${row.type} on ${row.date}`, "/calendar", "event");
    if (col === "feed") broadcast({ type: "toast", title: `${row.authorName} posted on the feed`, body: row.text.slice(0, 90) }, (c) => c.userId !== req.user!.id);
    changed(col);
    res.json(col === "users" ? publicUser(row) : row);
  });

  app.patch("/api/c/:col/:id", auth, (req, res) => {
    const col = req.params.col as string;
    if (col === "fees" && !feeEnabled()) return res.status(403).json({ message: "Fees module is currently disabled" });
    const id = Number(req.params.id);
    const perm = WRITE[col];
    if (!perm || !perm.includes(req.user!.role)) return res.status(403).json({ message: "You don't have permission for this action" });
    const before = db.get<any>(col, id);
    if (!before) return res.status(404).json({ message: "Record not found" });
    const b = { ...(req.body || {}) };
    delete b.id;
    if (col === "feed") {
      if (b.like !== undefined) {
        const likes: number[] = JSON.parse(before.likes || "[]");
        const i = likes.indexOf(req.user!.id);
        i >= 0 ? likes.splice(i, 1) : likes.push(req.user!.id);
        const r = db.update("feed", id, { likes: JSON.stringify(likes) });
        broadcast({ type: "change", collections: ["feed"] });
        return res.json(r);
      }
      if (before.authorId !== req.user!.id && !ADMINS.includes(req.user!.role)) return res.status(403).json({ message: "You can only edit your own posts" });
    }
    if (col === "users") {
      if (b.password) b.passwordHash = hashPassword(b.password);
      delete b.password;
      if (before.role === "super_admin" && b.role && b.role !== "super_admin" && db.count("users", "WHERE role='super_admin' AND status='active'") <= 1) return res.status(400).json({ message: "At least one Super Admin is required" });
    }
    if (col === "students") {
      b.studentCode = before.studentCode || makeStudentCode();
      b.admissionNo = before.admissionNo || b.admissionNo || nextAdmissionNo();
      delete b.linkCode;
      delete b.linkRequestedBy;
      delete b.linkRequestedAt;
      delete b.linkVerifiedAt;
    }
    let row: any;
    try { row = db.update(col, id, b); } catch (e: any) { return res.status(400).json({ message: e.message.includes("UNIQUE") ? "A record with the same unique value already exists" : e.message }); }
    const label = row.name || row.title || row.topic || row.studentName || `#${row.id}`;
    log(req, `Updated ${TABLES[col].label.toLowerCase().replace(/s$/, "")}: ${label}`, col);
    if (col === "users" && before.status !== "active" && row.status === "active") notify([row.id], "Account approved", "Your portal account is now active. Welcome!", "/dashboard", "account");
    if (col === "exams" && !before.published && row.published) {
      notify(classFamilyIds(row.classId), "Result published", `${row.name} results are now available`, "/results", "result");
      broadcast({ type: "change", collections: ["results"] });
    }
    if (col === "enquiries") {}
    changed(col);
    res.json(col === "users" ? publicUser(row) : row);
  });

  app.delete("/api/c/:col/:id", auth, (req, res) => {
    const col = req.params.col as string;
    if (col === "fees" && !feeEnabled()) return res.status(403).json({ message: "Fees module is currently disabled" });
    const id = Number(req.params.id);
    const perm = WRITE[col];
    if (!perm || !perm.includes(req.user!.role)) return res.status(403).json({ message: "You don't have permission for this action" });
    const before = db.get<any>(col, id);
    if (!before) return res.status(404).json({ message: "Record not found" });
    if (col === "feed" && before.authorId !== req.user!.id && !ADMINS.includes(req.user!.role)) return res.status(403).json({ message: "You can only delete your own posts" });
    if (col === "users" && before.id === req.user!.id) return res.status(400).json({ message: "You cannot delete your own account" });
    db.remove(col, id);
    if (col === "students") ["attendance", "results", "fees"].forEach((t) => sqlite.prepare(`DELETE FROM ${t} WHERE studentId=?`).run(id));
    if (col === "exams") sqlite.prepare(`DELETE FROM results WHERE examId=?`).run(id);
    if (col === "users") sqlite.prepare(`DELETE FROM sessions WHERE userId=?`).run(id);
    log(req, `Deleted ${TABLES[col].label.toLowerCase().replace(/s$/, "")}: ${before.name || before.title || before.topic || before.studentName || "#" + id}`, col);
    changed(col, ...(col === "students" ? ["attendance", "results", "fees"] : col === "exams" ? ["results"] : []));
    res.json({ ok: true });
  });

  // ---------- attendance ----------
  app.post("/api/attendance/mark", auth, allow(...STAFF), (req, res) => {
    const { classId, date, entries } = req.body || {};
    if (!classId || !date || !Array.isArray(entries)) return res.status(400).json({ message: "Class, date and entries required" });
    const tx = sqlite.transaction(() => entries.forEach((e: any) => db.upsert("attendance", { studentId: e.studentId, classId, date, status: e.status, markedBy: req.user!.name }, ["studentId", "date"])));
    tx();
    const cls = db.get<any>("classes", classId);
    const absent = entries.filter((e: any) => e.status === "Absent").map((e: any) => e.studentId);
    log(req, `Marked attendance — ${cls?.name} (${date})`, "attendance", `${entries.length} students, ${absent.length} absent`);
    if (date === todayISO() && absent.length) {
      absent.forEach((sid: number) => { const s = db.get<any>("students", sid); notify(familyUserIds([sid]), "Absent today", `${s?.name} was marked absent on ${date}`, "/attendance", "attendance"); });
    }
    changed("attendance");
    res.json({ ok: true, saved: entries.length });
  });

  // ---------- results ----------
  app.post("/api/results/save", auth, allow(...STAFF), (req, res) => {
    const { examId, entries } = req.body || {};
    if (!examId || !Array.isArray(entries)) return res.status(400).json({ message: "Exam and marks required" });
    const tx = sqlite.transaction(() => entries.forEach((e: any) => {
      if (e.marks === "" || e.marks === null || e.marks === undefined) sqlite.prepare("DELETE FROM results WHERE examId=? AND studentId=? AND subjectId=?").run(examId, e.studentId, e.subjectId);
      else db.upsert("results", { examId, studentId: e.studentId, subjectId: e.subjectId, marks: e.marks, remarks: e.remarks || "" }, ["examId", "studentId", "subjectId"]);
    }));
    tx();
    const ex = db.get<any>("exams", examId);
    log(req, `Saved marks — ${ex?.name}`, "results", `${entries.length} entries`);
    changed("results");
    res.json({ ok: true });
  });

  // ---------- fees ----------
  app.post("/api/fees/generate", auth, allow(...ADMINS), (req, res) => {
    const { month } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(month || "")) return res.status(400).json({ message: "Choose a valid month" });
    const classes = db.all<any>("classes");
    let created = 0;
    const tx = sqlite.transaction(() => db.all<any>("students", "WHERE status='Active'").forEach((s) => {
      if (db.find("fees", "studentId=? AND month=?", [s.id, month])) return;
      db.insert("fees", { studentId: s.id, month, amount: classes.find((c) => c.id === s.classId)?.monthlyFee || 0, paidAmount: 0, status: "Unpaid" });
      created++;
    }));
    tx();
    log(req, `Generated fees for ${month}`, "fees", `${created} new records`);
    changed("fees");
    res.json({ created });
  });

  app.post("/api/fees/:id/pay", auth, allow(...ADMINS), (req, res) => {
    if (!feeEnabled()) return res.status(403).json({ message: "Fees module is currently disabled" });
    const f = db.get<any>("fees", Number(req.params.id));
    if (!f) return res.status(404).json({ message: "Fee record not found" });
    const amount = Number(req.body?.amount || 0);
    if (!(amount > 0)) return res.status(400).json({ message: "Enter an amount" });
    const paidAmount = Math.min(f.amount, (f.paidAmount || 0) + amount);
    const row = db.update<any>("fees", f.id, { paidAmount, status: paidAmount >= f.amount ? "Paid" : "Partial", method: req.body.method || "Cash", paidOn: req.body.paidOn || todayISO(), receiptNo: f.receiptNo || nextReceipt(), remarks: req.body.remarks || f.remarks });
    const s = db.get<any>("students", f.studentId);
    log(req, `Fee payment ₹${amount} — ${s?.name}`, "fees", `${f.month} • ${row.receiptNo}`);
    notify(familyUserIds([f.studentId]), "Fee payment received", `₹${amount} received for ${s?.name} (${f.month}). Receipt ${row.receiptNo}`, "/fees", "fee");
    changed("fees");
    res.json(row);
  });

  // ---------- admissions ----------
  app.post("/api/admissions/:id/approve", auth, allow(...ADMINS), (req, res) => {
    const a = db.get<any>("admissions", Number(req.params.id));
    if (!a) return res.status(404).json({ message: "Application not found" });
    if (a.status === "approved") return res.status(400).json({ message: "Already approved" });
    const classId = Number(req.body?.classId || a.classId);
    let parent = db.find<any>("parents", "replace(phone,' ','')=replace(?,' ','')", [a.phone]);
    if (!parent) parent = db.insert("parents", { name: a.fatherName, relation: "Father", phone: a.phone, email: a.email, address: a.address });
    const roll = (sqlite.prepare("SELECT MAX(rollNo) m FROM students WHERE classId=?").get(classId) as any).m || 0;
    const s = db.insert<any>("students", { admissionNo: nextAdmissionNo(), studentCode: a.studentCode || makeStudentCode(), name: a.studentName, gender: a.gender, dob: a.dob, classId, rollNo: roll + 1, fatherName: a.fatherName, motherName: a.motherName, parentId: parent.id, phone: a.phone, address: a.address, bloodGroup: a.bloodGroup, admissionDate: todayISO(), status: "Active", notes: a.notes });
    const studentEmail = String(a.email || "").trim();
    const studentPassword = String(a.password || "").trim();
    if (studentEmail && studentPassword.length >= 6) {
      const existingLogin = db.find<any>("users", "lower(email)=lower(?)", [studentEmail]);
      if (existingLogin && existingLogin.role !== "student") return res.status(400).json({ message: "This email is already linked to another account type." });
      if (!existingLogin) {
        db.insert<any>("users", { name: a.studentName, email: studentEmail, role: "student", status: "active", linkedId: s.id, phone: a.phone, passwordHash: hashPassword(studentPassword), createdAt: nowISO() });
      } else {
        db.update("users", existingLogin.id, { name: a.studentName, role: "student", status: "active", linkedId: s.id, phone: a.phone, passwordHash: hashPassword(studentPassword) });
      }
    }
    db.update("admissions", a.id, { status: "approved", studentId: s.id, classId });
    const month = todayISO().slice(0, 7);
    const cls = db.get<any>("classes", classId);
    db.insert("fees", { studentId: s.id, month, amount: cls?.monthlyFee || 0, paidAmount: 0, status: "Unpaid" });
    log(req, `Approved admission: ${a.studentName}`, "admissions", `${a.appNo} → ${s.admissionNo}`);
    changed("admissions", "students", "parents", "fees");
    res.json({ student: s });
  });
  app.post("/api/admissions/:id/reject", auth, allow(...ADMINS), (req, res) => {
    const a = db.get<any>("admissions", Number(req.params.id));
    if (!a) return res.status(404).json({ message: "Application not found" });
    db.update("admissions", a.id, { status: req.body?.cancel ? "cancelled" : "rejected", reason: req.body?.reason || "" });
    log(req, `${req.body?.cancel ? "Cancelled" : "Rejected"} admission: ${a.studentName}`, "admissions", req.body?.reason || "");
    changed("admissions");
    res.json({ ok: true });
  });

  // ---------- messages ----------
  app.get("/api/contacts", auth, (req, res) => {
    const me = req.user!;
    let users = db.all<any>("users", "WHERE status='active' AND id<>? ORDER BY name", [me.id]).map(publicUser);
    if (!STAFF.includes(me.role)) users = users.filter((u) => STAFF.includes(u.role));
    const online = new Set(onlineIds());
    const unread = sqlite.prepare("SELECT fromId, COUNT(*) c FROM messages WHERE toId=? AND isRead=0 GROUP BY fromId").all(me.id) as any[];
    const last = sqlite.prepare(`SELECT * FROM messages WHERE fromId=? OR toId=? ORDER BY id DESC`).all(me.id, me.id) as any[];
    res.json(users.map((u) => {
      const lm = last.find((m) => m.fromId === u.id || m.toId === u.id);
      return { ...u, online: online.has(u.id), unread: unread.find((x) => x.fromId === u.id)?.c || 0, lastMessage: lm?.body || "", lastAt: lm?.createdAt || "" };
    }).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || "") || a.name.localeCompare(b.name)));
  });
  app.get("/api/messages/:userId", auth, (req, res) => {
    const me = req.user!.id, other = Number(req.params.userId);
    sqlite.prepare("UPDATE messages SET isRead=1 WHERE fromId=? AND toId=? AND isRead=0").run(other, me);
    broadcast({ type: "read", by: me }, (c) => c.userId === other);
    res.json(sqlite.prepare("SELECT * FROM messages WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?) ORDER BY id").all(me, other, other, me));
  });
  app.post("/api/messages", auth, (req, res) => {
    const { toId, body } = req.body || {};
    if (!toId || !String(body || "").trim()) return res.status(400).json({ message: "Message is empty" });
    const to = db.get<any>("users", Number(toId));
    if (!to) return res.status(404).json({ message: "User not found" });
    if (!STAFF.includes(req.user!.role) && !STAFF.includes(to.role)) return res.status(403).json({ message: "You can message staff only" });
    const m = db.insert("messages", { fromId: req.user!.id, toId: to.id, body: String(body).trim().slice(0, 2000), isRead: 0, createdAt: nowISO() });
    broadcast({ type: "message", message: m, fromName: req.user!.name }, (c) => c.userId === to.id || c.userId === req.user!.id);
    res.json(m);
  });
  app.post("/api/typing", auth, (req, res) => {
    broadcast({ type: "typing", from: req.user!.id }, (c) => c.userId === Number(req.body?.toId));
    res.json({ ok: true });
  });

  // ---------- notifications ----------
  app.get("/api/notifications", auth, (req, res) => res.json(db.all("notifications", "WHERE userId=? ORDER BY id DESC LIMIT 60", [req.user!.id])));
  app.post("/api/notifications/read", auth, (req, res) => {
    if (req.body?.id) sqlite.prepare("UPDATE notifications SET isRead=1 WHERE id=? AND userId=?").run(req.body.id, req.user!.id);
    else sqlite.prepare("UPDATE notifications SET isRead=1 WHERE userId=?").run(req.user!.id);
    res.json({ ok: true });
  });
  app.get("/api/online", auth, (_req, res) => res.json(onlineIds()));

  // ---------- database / backup ----------
  app.get("/api/admin/backup", auth, allow(...ADMINS), (req, res) => {
    const data: Record<string, any[]> = {};
    Object.keys(TABLES).filter((t) => t !== "sessions").forEach((t) => (data[t] = db.all(t)));
    log(req, "Downloaded JSON backup", "system");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="madarsa-backup-${todayISO()}.json"`);
    res.send(JSON.stringify({ app: "madarsa-gausiya-razviya", version: 2, exportedAt: nowISO(), data }, null, 2));
  });
  app.get("/api/admin/database", auth, allow(...ADMINS), async (req, res) => {
    const tmp = `/tmp/madarsa-${Date.now()}.db`;
    await sqlite.backup(tmp);
    log(req, "Downloaded SQLite database", "system");
    res.setHeader("Content-Type", "application/x-sqlite3");
    res.setHeader("Content-Disposition", `attachment; filename="madarsa-${todayISO()}.db"`);
    fs.createReadStream(tmp).pipe(res).on("finish", () => fs.unlink(tmp, () => {}));
  });
  app.get("/api/admin/schema.sql", auth, allow(...ADMINS), (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="madarsa-schema.sql"`);
    res.send(schemaSQL());
  });
  app.get("/api/admin/db-stats", auth, allow(...ADMINS), (_req, res) => {
    const size = [DB_PATH, DB_PATH + "-wal"].reduce((a, f) => a + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0);
    res.json({ size, engine: `SQLite ${(sqlite.prepare("select sqlite_version() v").get() as any).v}`, tables: Object.entries(TABLES).map(([name, d]) => ({ name, label: d.label, rows: db.count(name), columns: Object.keys(d.columns).length + 1 })) });
  });
  app.post("/api/admin/restore", auth, allow("super_admin"), (req, res) => {
    const data = req.body?.data;
    if (!data || typeof data !== "object") return res.status(400).json({ message: "Invalid backup file" });
    const tx = sqlite.transaction(() => {
      wipe();
      for (const [t, rows] of Object.entries<any[]>(data)) {
        if (!TABLES[t] || t === "sessions" || !Array.isArray(rows)) continue;
        rows.forEach((r) => { const { id, ...rest } = r; const cols = ["id", ...Object.keys(TABLES[t].columns).filter((c) => c in rest)]; sqlite.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => (c === "id" ? id : rest[c]))); });
      }
    });
    tx();
    log(req, "Restored database from backup", "system");
    broadcast({ type: "reload" });
    res.json({ ok: true });
  });
  app.post("/api/admin/reset-demo", auth, allow("super_admin"), (req, res) => {
    sqlite.transaction(() => { wipe(); seed(); })();
    sqlite.exec("DELETE FROM sessions");
    broadcast({ type: "reload" });
    res.json({ ok: true });
  });

  return httpServer;
}
