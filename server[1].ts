import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { dbService, hashPassword } from "./src/dbService";
import { User, Student, Subject, Class } from "./src/types";

const app = express();
const PORT = 3000;

app.use(express.json());

// API: Authentication endpoints
app.post("/api/auth/login", (req, res) => {
  const { email, password, role } = req.body;
  
  if (!email || !password || !role) {
    return res.status(400).json({ error: "Please provide email, password, and role." });
  }

  const users = dbService.getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.role === role);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid email, password, or role selection." });
  }

  // Get student or teacher info associated
  let detail: any = null;
  if (role === 'student') {
    detail = dbService.getStudentByUserId(user.id);
  } else if (role === 'teacher') {
    detail = dbService.getTeachers().find(t => t.userId === user.id);
  }

  res.json({
    message: "Login successful",
    token: `token_${user.id}_${Date.now()}`, // simple security token
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      detail: detail
    }
  });
});

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, role, batch, phone, gpa, department } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "Please fill out all required fields." });
  }

  const users = dbService.getUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "An account with this email already exists." });
  }

  // Create User
  const userId = `usr_${Math.random().toString(36).substr(2, 9)}`;
  const newUser: User = {
    id: userId,
    name,
    email,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString()
  };

  dbService.addUser(newUser);

  // Link to Student / Teacher table
  let details: any = null;
  if (role === 'student') {
    const studentId = `STU-${Math.floor(1000 + Math.random() * 9000)}`;
    const newStudent: Student = {
      id: studentId,
      userId,
      batch: batch || "Class of 2025",
      phone: phone || "",
      gpa: gpa || 3.5,
      department: department || "Computer Science",
      overallAttendance: 90
    };
    dbService.addStudent(newStudent);
    
    // Seed initial attendance entries for the newly signed-up student so they have a matching profile schedule with data
    const classes = dbService.getClasses();
    const dates = ["2023-10-18", "2023-10-19", "2023-10-20", "2023-10-21", "2023-10-22", "2023-10-23", "2023-10-24"];
    const statuses: ('Present' | 'Absent' | 'Late')[] = ['Present', 'Present', 'Present', 'Present', 'Present', 'Late', 'Late', 'Absent'];
    const seededRecs: any[] = [];
    
    classes.forEach((c, cIdx) => {
      // Seed a few dates for each class
      dates.slice(0, 4 + (cIdx % 3)).forEach((d, dIdx) => {
        const randStatus = statuses[(cIdx + dIdx) % statuses.length];
        seededRecs.push({
          id: `att_${c.id}_${studentId}_${Date.now()}_${cIdx}_${dIdx}`,
          studentId: studentId,
          classId: c.id,
          subjectId: c.subjectId,
          date: d,
          timeLogged: randStatus === 'Present' ? "09:02 AM" : randStatus === 'Late' ? "09:18 AM" : "--:--",
          status: randStatus
        });
      });
    });
    dbService.saveAttendances(seededRecs);
    details = newStudent;
  } else if (role === 'teacher') {
    const teacherId = `TCH-${Math.floor(1000 + Math.random() * 9000)}`;
    const newTeacher = {
      id: teacherId,
      userId,
      phone: phone || "",
      department: department || "Computer Science"
    };
    dbService.addTeacher(newTeacher);

    // Duplicate standard subjects and classes under this new teacher's ID so their dashboard has ready-to-test details!
    const defaultSubjects = [
      { name: "Computer Science 101", code: "CS101" },
      { name: "Advanced Data Structures", code: "CS301" }
    ];
    defaultSubjects.forEach((s, subIdx) => {
      const newSubId = `SUB-${Math.floor(100 + Math.random() * 900)}`;
      dbService.addSubject({
        id: newSubId,
        name: s.name,
        code: s.code,
        teacherId: teacherId
      });
      // Add a matching class section
      dbService.addClass({
        id: `CLS-${Math.floor(100 + Math.random() * 900)}`,
        name: `${s.name} - Sec ${String.fromCharCode(65 + subIdx)}`,
        room: `Lecture Hall ${String.fromCharCode(65 + subIdx)}`,
        subjectId: newSubId,
        teacherId: teacherId,
        time: subIdx === 0 ? "08:00 AM - 09:30 AM" : "10:00 AM - 11:30 AM",
        term: "Fall Semester"
      });
    });

    details = newTeacher;
  }

  res.json({
    message: "Signed up successfully. Please log in.",
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      detail: details
    }
  });
});

// API: Students endpoints
app.get("/api/students", (req, res) => {
  const students = dbService.getStudents();
  const users = dbService.getUsers();
  
  // Combine user info into student list
  const combined = students.map(s => {
    const u = users.find(user => user.id === s.userId);
    const attendance = dbService.calculateStudentAttendance(s.id);
    return {
      ...s,
      name: u ? u.name : "Unknown student",
      email: u ? u.email : "",
      overallAttendance: attendance
    };
  });

  // Filters
  const search = req.query.search as string;
  let filtered = combined;
  if (search) {
    const q = search.toLowerCase();
    filtered = combined.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.id.toLowerCase().includes(q) || 
      s.department.toLowerCase().includes(q)
    );
  }

  res.json(filtered);
});

// API: Teachers endpoints
app.get("/api/teachers", (req, res) => {
  const teachers = dbService.getTeachers();
  const users = dbService.getUsers();
  const subjects = dbService.getSubjects();
  
  // Combine user info into teacher list
  const combined = teachers.map(t => {
    const u = users.find(user => user.id === t.userId);
    const teacherSubjects = subjects.filter(sub => sub.teacherId === t.id);
    return {
      ...t,
      name: u ? u.name : "Unknown Faculty",
      email: u ? u.email : "",
      role: 'teacher',
      subjects: teacherSubjects.map(sub => sub.name)
    };
  });

  // Filters
  const search = req.query.search as string;
  let filtered = combined;
  if (search) {
    const q = search.toLowerCase();
    filtered = combined.filter(t => 
      t.name.toLowerCase().includes(q) || 
      t.id.toLowerCase().includes(q) || 
      t.department.toLowerCase().includes(q)
    );
  }

  res.json(filtered);
});

app.post("/api/students", (req, res) => {
  const { name, email, password, batch, phone, gpa, department } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }

  const users = dbService.getUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "Email already exists." });
  }

  const userId = `usr_${Math.random().toString(36).substr(2, 9)}`;
  const newUser: User = {
    id: userId,
    name,
    email,
    passwordHash: hashPassword(password),
    role: 'student',
    createdAt: new Date().toISOString()
  };
  dbService.addUser(newUser);

  const studentId = `STU-${Math.floor(1000 + Math.random() * 9000)}`;
  const newStudent: Student = {
    id: studentId,
    userId,
    batch: batch || "Class of 2025",
    phone: phone || "",
    gpa: Number(gpa) || 3.5,
    department: department || "Science"
  };
  dbService.addStudent(newStudent);

  res.json({ success: true, student: { ...newStudent, name, email, overallAttendance: 100 } });
});

app.put("/api/students/:id", (req, res) => {
  const studentId = req.params.id;
  const { name, email, batch, phone, gpa, department } = req.body;

  const student = dbService.getStudent(studentId);
  if (!student) {
    return res.status(404).json({ error: "Student not found." });
  }

  dbService.updateStudent(studentId, { batch, phone, gpa: Number(gpa), department });

  // Update user info
  const users = dbService.getUsers();
  const userIdx = users.findIndex(u => u.id === student.userId);
  if (userIdx !== -1) {
    if (name) users[userIdx].name = name;
    if (email) users[userIdx].email = email;
    // Save is triggered by helper save commands on write, we force it:
    dbService.getDbData().users[userIdx] = users[userIdx];
  }

  res.json({ success: true, message: "Student updated successfully." });
});

app.delete("/api/students/:id", (req, res) => {
  const studentId = req.params.id;
  const deleted = dbService.deleteStudent(studentId);
  if (deleted) {
    res.json({ success: true, message: "Student and its dependencies deleted." });
  } else {
    res.status(404).json({ error: "Student not found." });
  }
});

// API: Subject endpoints
app.get("/api/subjects", (req, res) => {
  res.json(dbService.getSubjects());
});

app.post("/api/subjects", (req, res) => {
  const { name, code, teacherId } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: "Name and code are required." });
  }
  const subjectId = `SUB-${Math.floor(100 + Math.random() * 900)}`;
  const newSub: Subject = {
    id: subjectId,
    name,
    code,
    teacherId: teacherId || "TCH-1002"
  };
  dbService.addSubject(newSub);
  res.json({ success: true, subject: newSub });
});

app.put("/api/subjects/:id", (req, res) => {
  const { name, code, teacherId } = req.body;
  const sub = dbService.updateSubject(req.params.id, { name, code, teacherId });
  if (sub) {
    res.json({ success: true, subject: sub });
  } else {
    res.status(404).json({ error: "Subject not found" });
  }
});

app.delete("/api/subjects/:id", (req, res) => {
  const deleted = dbService.deleteSubject(req.params.id);
  if (deleted) {
    res.json({ success: true, message: "Subject deleted." });
  } else {
    res.status(404).json({ error: "Subject not found." });
  }
});

// API: Class endpoints
app.get("/api/classes", (req, res) => {
  res.json(dbService.getClasses());
});

app.post("/api/classes", (req, res) => {
  const { name, room, subjectId, teacherId, time, term } = req.body;
  if (!name || !room || !subjectId) {
    return res.status(400).json({ error: "Name, room and subject are required." });
  }
  const clsId = `CLS-${Math.floor(100 + Math.random() * 900)}`;
  const newCls: Class = {
    id: clsId,
    name,
    room,
    subjectId,
    teacherId: teacherId || "TCH-1002",
    time: time || "10:00 AM - 11:30 AM",
    term: term || "Fall Semester"
  };
  dbService.addClass(newCls);
  res.json({ success: true, class: newCls });
});

app.put("/api/classes/:id", (req, res) => {
  const cls = dbService.updateClass(req.params.id, req.body);
  if (cls) {
    res.json({ success: true, class: cls });
  } else {
    res.status(404).json({ error: "Class not found." });
  }
});

app.delete("/api/classes/:id", (req, res) => {
  const deleted = dbService.deleteClass(req.params.id);
  if (deleted) {
    res.json({ success: true, message: "Class deleted." });
  } else {
    res.status(404).json({ error: "Class not found." });
  }
});

// API: Attendance endpoints
app.get("/api/attendance", (req, res) => {
  let attendances = dbService.getAttendances();
  const { classId, date } = req.query;
  if (classId) {
    attendances = attendances.filter(a => a.classId === classId);
  }
  if (date) {
    attendances = attendances.filter(a => a.date === date);
  }
  res.json(attendances);
});

// Post action to save attendance
app.post("/api/attendance/mark", (req, res) => {
  const { classId, subjectId, date, records } = req.body; // records: list of { studentId, status, timeLogged }
  
  if (!classId || !subjectId || !date || !records || !Array.isArray(records)) {
    return res.status(400).json({ error: "Validation parameters failed." });
  }

  const attendanceRecs = records.map((r, idx) => ({
    id: `att_${classId}_${r.studentId}_${Date.now()}_${idx}`,
    studentId: r.studentId,
    classId,
    subjectId,
    date,
    timeLogged: r.timeLogged || (r.status === 'Present' ? "09:00 AM" : r.status === 'Late' ? "09:15 AM" : "--:--"),
    status: r.status as 'Present' | 'Absent' | 'Late'
  }));

  dbService.saveAttendances(attendanceRecs);

  // Trigger low-threshold alarm notification if average attendance drops below 75%
  const presentCount = attendanceRecs.filter(r => r.status === 'Present' || r.status === 'Late').length;
  const pct = Math.round((presentCount / attendanceRecs.length) * 100);
  if (pct < 75) {
    const clsName = dbService.getClasses().find(c => c.id === classId)?.name || "Academic Class";
    dbService.addNotification({
      id: `not_${Date.now()}`,
      title: clsName,
      message: `Attendance dropped to ${pct}% (Threshold: 75%).`,
      timeAgo: "Just now",
      type: "critical"
    });
  }

  res.json({ success: true, message: "Attendance saved successfully.", averageAttendance: pct });
});

// Detailed history combined for Admin/Teacher History Table
app.get("/api/attendance/history", (req, res) => {
  const attendances = dbService.getAttendances();
  const students = dbService.getStudents();
  const users = dbService.getUsers();
  const subjects = dbService.getSubjects();

  const history = attendances.map(a => {
    const student = students.find(s => s.id === a.studentId);
    const user = student ? users.find(u => u.id === student.userId) : null;
    const sub = subjects.find(s => s.id === a.subjectId);
    return {
      id: a.id,
      date: a.date,
      studentName: user ? user.name : "Unknown Student",
      studentId: a.studentId,
      subjectName: sub ? sub.name : "Unknown Subject",
      timeLogged: a.timeLogged,
      status: a.status
    };
  });

  // Sort history: latest date first
  history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  res.json(history);
});

// API: Summary Metrics
app.get("/api/reports/summary", (req, res) => {
  const students = dbService.getStudents();
  const users = dbService.getUsers();
  const classes = dbService.getClasses();
  const teachers = dbService.getTeachers();
  const attendances = dbService.getAttendances();

  // At-risk calculations (students with attendance < 75%)
  const atRisk = students.map(s => {
    const rate = dbService.calculateStudentAttendance(s.id);
    const u = users.find(user => user.id === s.userId);
    return {
      id: s.id,
      userId: s.userId,
      name: u ? u.name : "Unknown student",
      department: s.department,
      attendanceRate: rate
    };
  }).filter(s => s.attendanceRate < 75);

  // General counts
  res.json({
    totalStudents: students.length,
    totalTeachers: teachers.length,
    totalClasses: classes.length,
    todayAttendanceRate: 94, // Standard visual metrics
    atRiskStudents: atRisk,
    distribution: {
      present: attendances.filter(a => a.status === 'Present').length,
      absent: attendances.filter(a => a.status === 'Absent').length,
      late: attendances.filter(a => a.status === 'Late').length
    }
  });
});

// API: Notifications
app.get("/api/notifications", (req, res) => {
  res.json(dbService.getNotifications());
});

async function startServer() {
  // Vite dev server mapping
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`EduTrack Pro server started at http://localhost:${PORT}`);
  });
}

startServer();
