/**
 * seed/seed_data.js
 * ──────────────────────────────────────────────────────────────
 * Shared test data definitions.
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

const { randomUUID } = require('crypto');

function uuid() { return randomUUID(); }

// ── 3 Real students ────────────────────────────────────────────
const REAL_STUDENTS = [
  { usn: '1MV25MC061', name: 'RAVI RAUSHAN KUMAR',             email: 'raviraushan253@gmail.com' },
  { usn: '1MV25MC052', name: 'PRAFUL KRISHNAPPA VAJJARAMATTI',  email: 'example1@gmail.com' },
  { usn: '1MV25MC074', name: 'SINDHUKUMAR S',                   email: 'example2@gmail.com' }
];

// ── 75 Random students (USN 1MV25MC001-078, excluding real) ────
function generateRandomStudents(count = 75) {
  const used = new Set(REAL_STUDENTS.map(s => s.usn));
  const students = [];
  for (let i = 1; i <= 78; i++) {
    const usn = `1MV25MC${String(i).padStart(3, '0')}`;
    if (used.has(usn)) continue;
    students.push({
      usn,
      name : `STUDENT ${String(i).padStart(3, '0')}`,
      email: `student${String(i).padStart(3, '0')}@test.com`
    });
    if (students.length === count) break;
  }
  return students;
}

// ── Sessions ────────────────────────────────────────────────────
const SESSIONS = [
  { semester: '1', exam_session: 'Dec', exam_year: 2025, label: 'Sem 1 Dec 2025 (REGULAR)' },
  { semester: '1', exam_session: 'Jun', exam_year: 2026, label: 'Sem 1 Jun 2026 (BACKLOG)' },
  { semester: '2', exam_session: 'Jun', exam_year: 2026, label: 'Sem 2 Jun 2026 (REGULAR)' }
];

// ── Subjects per session ───────────────────────────────────────
// Sem 1 Dec 2025 (REGULAR) — 6 subjects
const SUBJECTS_SEM1_DEC2025 = [
  { code: 'MMC101', name: 'PROGRAMMING AND PROBLEM SOLVING IN C',     type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC102', name: 'DISCRETE MATHEMATICS AND GRAPH THEORY',    type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC103', name: 'DATABASE MANAGEMENT SYSTEMS (DBMS)',       type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC104', name: 'OPERATING SYSTEM',                        type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC105', name: 'WEB TECHNOLOGIES',                        type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMCL106', name: 'DBMS AND WEB TECHNOLOGIES LABORATORY',    type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
];

// Sem 1 Jun 2026 (BACKLOG) — 6 different subjects
const SUBJECTS_SEM1_JUN2026 = [
  { code: 'MMC201', name: 'COMPUTER ORGANIZATION AND ARCHITECTURE',   type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC202', name: 'DATA STRUCTURES AND ALGORITHMS',          type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC203', name: 'SOFTWARE ENGINEERING',                   type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC204', name: 'ARTIFICIAL INTELLIGENCE',                 type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC205', name: 'COMPUTER NETWORKS',                      type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMCL206', name: 'DSA AND AI LABORATORY',                  type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
];

// Sem 2 Jun 2026 (REGULAR) — 6 different subjects
const SUBJECTS_SEM2_JUN2026 = [
  { code: 'MMC301', name: 'THEORY OF COMPUTATION',                   type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC302', name: 'COMPILER DESIGN',                         type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC303', name: 'CLOUD COMPUTING',                        type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC304', name: 'CRYPTOGRAPHY AND NETWORK SECURITY',      type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMC305', name: 'MACHINE LEARNING',                       type: 'theory', credits: 4, max_internal: 50, max_external: 50, max_marks: 100 },
  { code: 'MMCL306', name: 'ML AND CC LABORATORY',                  type: 'lab',    credits: 4, max_internal: 50, max_external: 50, max_marks: 100 }
];

// Map session label → subjects array
function getSubjectsForSession(sessionLabel) {
  if (sessionLabel === 'Sem 1 Dec 2025 (REGULAR)') return SUBJECTS_SEM1_DEC2025;
  if (sessionLabel === 'Sem 1 Jun 2026 (BACKLOG)') return SUBJECTS_SEM1_JUN2026;
  if (sessionLabel === 'Sem 2 Jun 2026 (REGULAR)') return SUBJECTS_SEM2_JUN2026;
  return SUBJECTS_SEM1_DEC2025;
}

// ── Grade helpers ───────────────────────────────────────────────
function computeGrade(total) {
  if (total >= 90) return 'S';
  if (total >= 80) return 'A';
  if (total >= 70) return 'B';
  if (total >= 60) return 'C';
  if (total >= 50) return 'D';
  if (total >= 45) return 'E';
  return 'F';
}

function computeSGPA(subjectResults, subjects) {
  const gradePoints = { S: 10, A: 9, B: 8, C: 7, D: 6, E: 4, F: 0 };
  let totalPoints = 0, totalCredits = 0;
  for (const sr of subjectResults) {
    const sub = subjects.find(s => s.id === sr.subjectId);
    if (!sub) continue;
    totalPoints   += (gradePoints[sr.grade] || 0) * (sub.credits || 0);
    totalCredits  += sub.credits || 0;
  }
  return totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : null;
}

// ── Marks generation (seeded by usn + subject) ─────────────────
function generateMarks(usn, subjectCode, maxInternal, maxExternal) {
  let h = 0;
  for (let i = 0; i < usn.length + subjectCode.length; i++) {
    h = ((h << 5) - h) + (usn.charCodeAt(i % usn.length) ^ subjectCode.charCodeAt(i % subjectCode.length));
    h |= 0;
  }
  const rng = Math.abs(h) / 2147483647;
  const failRng = Math.abs(Math.sin(h * 3.14));

  const passMark = 0.35;

  let internal = Math.floor(rng * (maxInternal * 0.9)) + Math.floor(maxInternal * passMark);
  internal = Math.min(internal, maxInternal);

  let external = Math.floor(((rng * 1.3) % 1) * (maxExternal * 0.95)) + Math.floor(maxExternal * passMark);
  external = Math.min(external, maxExternal);

  // 5% chance of a failing subject (DBMS for demonstration)
  if (failRng < 0.05 && subjectCode === 'MMC102') {
    internal = Math.floor(maxInternal * 0.3);
    external = Math.floor(maxExternal * 0.25);
  }

  return { internal, external, total: internal + external };
}

module.exports = {
  uuid, REAL_STUDENTS, generateRandomStudents,
  SESSIONS,
  SUBJECTS_SEM1_DEC2025, SUBJECTS_SEM1_JUN2026, SUBJECTS_SEM2_JUN2026,
  getSubjectsForSession,
  computeGrade, computeSGPA, generateMarks
};
