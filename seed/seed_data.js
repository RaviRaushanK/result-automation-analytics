'use strict';

const { randomUUID } = require('crypto');

function uuid() {
  return randomUUID();
}

// Real students.
// These records may be inserted into students,
// but demo academic data must NEVER be generated for them.
const REAL_STUDENTS = [
  {
    usn: '1MV25MC061',
    name: 'RAVI RAUSHAN KUMAR',
    email: 'raviraushan253@gmail.com'
  },
  {
    usn: '1MV25MC052',
    name: 'PRAFUL KRISHNAPPA VAJJARAMATTI',
    email: 'example1@gmail.com'
  },
  {
    usn: '1MV25MC074',
    name: 'SINDHUKUMAR S',
    email: 'example2@gmail.com'
  }
];

const REAL_STUDENT_USNS = new Set(
  REAL_STUDENTS.map(student => student.usn)
);

function isRealStudent(studentOrUsn) {
  const usn =
    typeof studentOrUsn === 'string'
      ? studentOrUsn
      : studentOrUsn?.usn;

  return Boolean(usn && REAL_STUDENT_USNS.has(usn));
}

// Legacy/demo helper retained for compatibility.
// Real student USNs are always excluded.
function generateRandomStudents(count = 75) {
  const students = [];

  for (let i = 1; i <= 78; i++) {
    const usn = `1MV25MC${String(i).padStart(3, '0')}`;

    if (REAL_STUDENT_USNS.has(usn)) {
      continue;
    }

    students.push({
      usn,
      name: `STUDENT ${String(i).padStart(3, '0')}`,
      email: `student${String(i).padStart(3, '0')}@test.com`
    });

    if (students.length === count) {
      break;
    }
  }

  return students;
}

const SESSIONS = [
  {
    semester: '1',
    exam_session: 'Dec',
    exam_year: 2025,
    label: 'Sem 1 Dec 2025 (REGULAR)'
  },
  {
    semester: '1',
    exam_session: 'Jun',
    exam_year: 2026,
    label: 'Sem 1 Jun 2026 (BACKLOG)'
  },
  {
    semester: '2',
    exam_session: 'Jun',
    exam_year: 2026,
    label: 'Sem 2 Jun 2026 (REGULAR)'
  }
];

const SUBJECTS_SEM1_DEC2025 = [
  { code: 'MMC101', name: 'PROGRAMMING AND PROBLEM SOLVING IN C', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC102', name: 'DISCRETE MATHEMATICS AND GRAPH THEORY', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC103', name: 'DATABASE MANAGEMENT SYSTEMS (DBMS)', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC104', name: 'OPERATING SYSTEM', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC105', name: 'WEB TECHNOLOGIES', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMCL106', name: 'DBMS AND WEB TECHNOLOGIES LABORATORY', type: 'lab', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
];

const SUBJECTS_SEM1_JUN2026 = [
  { code: 'MMC201', name: 'COMPUTER ORGANIZATION AND ARCHITECTURE', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC202', name: 'DATA STRUCTURES AND ALGORITHMS', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC203', name: 'SOFTWARE ENGINEERING', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC204', name: 'ARTIFICIAL INTELLIGENCE', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC205', name: 'COMPUTER NETWORKS', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMCL206', name: 'DSA AND AI LABORATORY', type: 'lab', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
];

const SUBJECTS_SEM2_JUN2026 = [
  { code: 'MMC301', name: 'THEORY OF COMPUTATION', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC302', name: 'COMPILER DESIGN', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC303', name: 'CLOUD COMPUTING', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC304', name: 'CRYPTOGRAPHY AND NETWORK SECURITY', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC305', name: 'MACHINE LEARNING', type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMCL306', name: 'ML AND CC LABORATORY', type: 'lab', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
];

function getSubjectsForSession(sessionLabel) {
  if (sessionLabel === 'Sem 1 Dec 2025 (REGULAR)') {
    return SUBJECTS_SEM1_DEC2025;
  }

  if (sessionLabel === 'Sem 1 Jun 2026 (BACKLOG)') {
    return SUBJECTS_SEM1_JUN2026;
  }

  if (sessionLabel === 'Sem 2 Jun 2026 (REGULAR)') {
    return SUBJECTS_SEM2_JUN2026;
  }

  return SUBJECTS_SEM1_DEC2025;
}

function computeGrade(total) {
  return require('../services/academicPolicy').legacySeedGrade(total);
}

function computeSGPA(subjectResults, subjects) {
  const gradePoints =
    require('../services/academicPolicy').LEGACY_POINTS;

  let totalPoints = 0;
  let totalCredits = 0;

  for (const sr of subjectResults) {
    const subject = subjects.find(
      item => item.id === sr.subjectId
    );

    if (!subject) {
      continue;
    }

    totalPoints +=
      (gradePoints[sr.grade] || 0) *
      (subject.credits || 0);

    totalCredits += subject.credits || 0;
  }

  return totalCredits > 0
    ? Number((totalPoints / totalCredits).toFixed(2))
    : null;
}

// Demo marks only.
// Hard failure prevents accidental fake results for real students.
function generateMarks(
  usn,
  subjectCode,
  maxInternal,
  maxExternal
) {
  if (isRealStudent(usn)) {
    throw new Error(
      `Refusing to generate demo marks for real student ${usn}.`
    );
  }

  let h = 0;

  for (
    let i = 0;
    i < usn.length + subjectCode.length;
    i++
  ) {
    h =
      ((h << 5) - h) +
      (
        usn.charCodeAt(i % usn.length) ^
        subjectCode.charCodeAt(i % subjectCode.length)
      );

    h |= 0;
  }

  const rng = Math.abs(h) / 2147483647;
  const failRng = Math.abs(Math.sin(h * 3.14));
  const passMark = 0.35;

  let internal =
    Math.floor(rng * (maxInternal * 0.9)) +
    Math.floor(maxInternal * passMark);

  internal = Math.min(internal, maxInternal);

  let external =
    Math.floor(
      ((rng * 1.3) % 1) *
      (maxExternal * 0.95)
    ) +
    Math.floor(maxExternal * passMark);

  external = Math.min(external, maxExternal);

  if (
    failRng < 0.05 &&
    subjectCode === 'MMC102'
  ) {
    internal = Math.floor(maxInternal * 0.3);
    external = Math.floor(maxExternal * 0.25);
  }

  return {
    internal,
    external,
    total: internal + external
  };
}

module.exports = {
  uuid,
  REAL_STUDENTS,
  REAL_STUDENT_USNS,
  isRealStudent,
  generateRandomStudents,
  SESSIONS,
  SUBJECTS_SEM1_DEC2025,
  SUBJECTS_SEM1_JUN2026,
  SUBJECTS_SEM2_JUN2026,
  getSubjectsForSession,
  computeGrade,
  computeSGPA,
  generateMarks
};