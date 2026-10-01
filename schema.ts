// Madarsa Gausiya Razviya — database schema (single source of truth).
// Every collection maps to a real SQLite table. Column types: text | int | real.

export type ColType = "text" | "int" | "real";
export interface TableDef {
  columns: Record<string, ColType>;
  unique?: string[][];
  label: string;
}

export const TABLES: Record<string, TableDef> = {
  users: {
    label: "Portal accounts",
    columns: {
      name: "text", email: "text", passwordHash: "text", role: "text", status: "text",
      phone: "text", linkedId: "int", lastLogin: "text", createdAt: "text",
    },
    unique: [["email"]],
  },
  sessions: { label: "Login sessions", columns: { token: "text", userId: "int", createdAt: "text" }, unique: [["token"]] },
  settings: { label: "Madarsa settings", columns: { key: "text", value: "text" }, unique: [["key"]] },
  classes: {
    label: "Classes",
    columns: { name: "text", alias: "text", section: "text", description: "text", classTeacherId: "int", room: "text", capacity: "int", monthlyFee: "int", sortOrder: "int" },
  },
  subjects: {
    label: "Subjects",
    columns: { name: "text", code: "text", type: "text", classId: "int", teacherId: "int", fullMarks: "int", passMarks: "int" },
  },
  teachers: {
    label: "Teachers",
    columns: { name: "text", urduName: "text", designation: "text", qualification: "text", phone: "text", email: "text", gender: "text", joiningDate: "text", salary: "int", address: "text", status: "text" },
  },
  parents: {
    label: "Parents",
    columns: { name: "text", relation: "text", phone: "text", email: "text", occupation: "text", address: "text" },
  },
  students: {
    label: "Students",
    columns: {
      admissionNo: "text", studentCode: "text", name: "text", gender: "text", dob: "text", classId: "int", rollNo: "int",
      fatherName: "text", motherName: "text", parentId: "int", phone: "text", address: "text",
      bloodGroup: "text", admissionDate: "text", status: "text", notes: "text",
      linkCode: "text", linkRequestedBy: "int", linkRequestedAt: "text", linkVerifiedAt: "text",
    },
    unique: [["admissionNo"], ["studentCode"]],
  },
  attendance: {
    label: "Attendance",
    columns: { studentId: "int", classId: "int", date: "text", status: "text", markedBy: "text" },
    unique: [["studentId", "date"]],
  },
  exams: {
    label: "Examinations",
    columns: { name: "text", classId: "int", startDate: "text", endDate: "text", totalMarks: "int", published: "int", description: "text" },
  },
  results: {
    label: "Results",
    columns: { examId: "int", studentId: "int", subjectId: "int", marks: "real", remarks: "text" },
    unique: [["examId", "studentId", "subjectId"]],
  },
  fees: {
    label: "Fees",
    columns: { studentId: "int", month: "text", amount: "int", paidAmount: "int", status: "text", method: "text", paidOn: "text", receiptNo: "text", remarks: "text" },
    unique: [["studentId", "month"]],
  },
  donations: {
    label: "Donations",
    columns: { receiptNo: "text", donorName: "text", phone: "text", type: "text", amount: "int", date: "text", method: "text", purpose: "text", notes: "text" },
  },
  expenses: {
    label: "Expenses",
    columns: { title: "text", category: "text", amount: "int", date: "text", paidTo: "text", method: "text", notes: "text" },
  },
  homework: {
    label: "Homework",
    columns: { classId: "int", subjectId: "int", title: "text", description: "text", assignedOn: "text", dueDate: "text", teacherId: "int" },
  },
  onlineClasses: {
    label: "Online classes",
    columns: { classId: "int", subjectId: "int", topic: "text", date: "text", time: "text", duration: "int", platform: "text", link: "text", teacherId: "int" },
  },
  notices: {
    label: "Notices",
    columns: { title: "text", body: "text", audience: "text", priority: "text", date: "text", isPublic: "int", attachment: "text" },
  },
  events: {
    label: "Calendar events",
    columns: { title: "text", date: "text", endDate: "text", type: "text", description: "text" },
  },
  feed: {
    label: "Feed",
    columns: { text: "text", image: "text", authorId: "int", authorName: "text", authorRole: "text", likes: "text", createdAt: "text" },
  },
  admissions: {
    label: "Admissions",
    columns: {
      appNo: "text", studentCode: "text", studentName: "text", gender: "text", dob: "text", classId: "int", bloodGroup: "text",
      fatherName: "text", motherName: "text", phone: "text", email: "text", password: "text", previousSchool: "text",
      address: "text", notes: "text", status: "text", reason: "text", studentId: "int", createdAt: "text",
    },
    unique: [["appNo"]],
  },
  enquiries: {
    label: "Enquiries",
    columns: { name: "text", phone: "text", studentName: "text", classWanted: "text", message: "text", status: "text", createdAt: "text" },
  },
  messages: {
    label: "Messages",
    columns: { fromId: "int", toId: "int", body: "text", isRead: "int", createdAt: "text" },
  },
  notifications: {
    label: "Notifications",
    columns: { userId: "int", title: "text", body: "text", link: "text", kind: "text", isRead: "int", createdAt: "text" },
  },
  activity: {
    label: "Activity log",
    columns: { userId: "int", userName: "text", action: "text", module: "text", detail: "text", createdAt: "text" },
  },
};

export type Role = "super_admin" | "admin" | "teacher" | "parent" | "student" | "user";
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin", admin: "Admin", teacher: "Teacher", parent: "Parent", student: "Student", user: "User",
};

export type Row = Record<string, any> & { id: number };
