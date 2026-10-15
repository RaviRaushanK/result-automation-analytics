'use strict';

const { createHash } = require('node:crypto');

const legacy = require('../seed_data');
const policy = require('../../services/academicPolicy');

const REAL_STUDENTS = legacy.REAL_STUDENTS;

const REAL_STUDENT_USNS = new Set(
  REAL_STUDENTS.map(student => student.usn)
);

const STAMP = new Date('2025-01-01T00:00:00Z');

function isRealStudent(usn) {
  return REAL_STUDENT_USNS.has(usn);
}

function uuid(key) {
  const hex = createHash('sha256')
    .update(`academic-demo-v1:${key}`)
    .digest('hex');

  return (
    `${hex.slice(0, 8)}-` +
    `${hex.slice(8, 12)}-` +
    `5${hex.slice(13, 16)}-` +
    `a${hex.slice(17, 20)}-` +
    `${hex.slice(20, 32)}`
  );
}

const batches = [
  {
    key: 'primary',
    name: 'MCA 2025',
    start: 2025,
    end: 2027,
    verified: true
  },
  {
    key: 'current',
    name: 'MCA 2026',
    start: 2026,
    end: 2028,
    verified: true
  },
  {
    key: 'unknown',
    name: 'TEST UNVERIFIED MCA',
    start: 2024,
    end: 2026,
    verified: false
  }
];

const courseLists = {
  1: legacy.SUBJECTS_SEM1_DEC2025,
  2: legacy.SUBJECTS_SEM1_JUN2026,
  3: legacy.SUBJECTS_SEM2_JUN2026,

  4: [
    ['MMC401', 'BIG DATA ANALYTICS'],
    ['MMC402', 'INTERNET OF THINGS'],
    ['MMC403', 'SOFTWARE PROJECT MANAGEMENT'],
    ['MMC404', 'DATA SCIENCE'],
    ['MMC405', 'DISTRIBUTED SYSTEMS'],
    ['MMCL406', 'BIG DATA AND DATA SCIENCE LABORATORY']
  ].map(([code, name]) => ({
    code,
    name,
    type: code.includes('L') ? 'lab' : 'theory',
    credits: 4,
    max_internal: 50,
    max_external: 50,
    max_marks: 100
  }))
};

function courses(semester) {
  return courseLists[semester].map(course => ({
    subject_code: course.code,
    subject_name: course.name,
    subject_type: course.type,

    credits:
      course.type === 'lab'
        ? 2
        : (
          semester === 3 &&
          course.code === 'MMC305'
            ? 5
            : course.credits
        ),

    max_internal: course.max_internal,

    max_external:
      semester === 3 &&
      course.code === 'MMC305'
        ? 100
        : course.max_external,

    max_marks:
      semester === 3 &&
      course.code === 'MMC305'
        ? 150
        : course.max_marks
  }));
}

const sessions = [
  ['p1', 'primary', 1, 'Dec', 2025],
  ['p1jun', 'primary', 1, 'Jun', 2026],
  ['p2', 'primary', 2, 'Jun', 2026],
  ['p1aug', 'primary', 1, 'Aug', 2026],
  ['p2dec', 'primary', 2, 'Dec', 2026],
  ['p3', 'primary', 3, 'Dec', 2026],
  ['p4', 'primary', 4, 'Jun', 2027, true],

  ['c1', 'current', 1, 'Dec', 2026],
  ['c2', 'current', 2, 'Jun', 2027],
  ['c3', 'current', 3, 'Dec', 2027, true],

  ['u1', 'unknown', 1, 'Dec', 2024],
  ['u1jun', 'unknown', 1, 'Jun', 2025]
].map(
  ([
    key,
    batch,
    semester,
    exam_session,
    exam_year,
    upcoming = false
  ]) => ({
    key,
    batch,
    semester: String(semester),
    exam_session,
    exam_year,
    upcoming
  })
);

const scenarios = {
  1: 'clean pass',
  2: 'two failures cleared in supplementary',
  3: 'unresolved backlog',
  4: 'multiple retakes',
  5: 'repeat clearance',
  6: 'pending revaluation',
  7: 'rejected revaluation',
  8: 'multiple revaluation events',
  9: 'Semester 2 backlog clearance',
  10: 'grade boundaries',
  11: 'topper tie',
  12: 'historical NULL components',
  14: 'marks-only revaluation',
  15: 'pass-to-fail revaluation',
  16: 'retake cleared by revaluation',
  17: 'same-session attempt 2',
  25: 'no results',
  26: 'in progress through Semester 2',
  27: 'in progress / upload fixture'
};

function students() {
  const realStudents = REAL_STUDENTS.map(
    (student, index) => ({
      ...student,

      // All 3 real students belong to MCA 2025.
      batch: 'primary',

      scenario: 'real student identity only',

      category:
        index === 2
          ? 'MGT'
          : 'PGCET'
    })
  );

  const primaryDemoStudents = Array.from(
    { length: 27 },
    (_, i) => ({
      usn:
        `1MV25MC${String(i + 1).padStart(3, '0')}`,

      name:
        `DEMO STUDENT ${String(i + 1).padStart(3, '0')}`,

      email:
        `demo25-${i + 1}@example.com`,

      batch: 'primary',

      scenario:
        scenarios[i + 1] ||
        'deterministic normal pass',

      category:
        i % 2
          ? 'MGT'
          : 'PGCET'
    })
  );

  const currentDemoStudents = Array.from(
    { length: 4 },
    (_, i) => ({
      usn:
        `1MV26MC${String(i + 1).padStart(3, '0')}`,

      name:
        `DEMO CURRENT ${i + 1}`,

      email:
        `demo26-${i + 1}@example.com`,

      batch: 'current',

      scenario:
        'current batch; future semesters unavailable',

      category:
        i % 2
          ? 'MGT'
          : 'PGCET'
    })
  );

  const unverifiedDemoStudents = Array.from(
    { length: 2 },
    (_, i) => ({
      usn: `1MV24MC90${i + 1}`,

      name: `DEMO UNVERIFIED ${i + 1}`,

      email:
        `demo-unknown-${i + 1}@example.com`,

      batch: 'unknown',

      scenario:
        i
          ? 'retake-only incomplete history'
          : 'unverified roster and legacy provenance',

      category: null
    })
  );

  return [
    ...realStudents,
    ...primaryDemoStudents,
    ...currentDemoStudents,
    ...unverifiedDemoStudents
  ];
}

function percentages(usn, semester) {
  // Demo fixtures only.
  if (isRealStudent(usn)) {
    throw new Error(
      `Refusing to generate demo percentages for real student ${usn}.`
    );
  }

  if (usn === '1MV25MC011') {
    return [95, 94, 93, 92, 91, 90];
  }

  if (usn === '1MV25MC010') {
    if (semester === 1) {
      return [49, 50, 54, 55, 59, 60];
    }

    if (semester === 2) {
      return [64, 65, 69, 70, 79, 80];
    }

    return [84, 85, 89, 90, 99, 100];
  }

  const n = Number(usn.slice(-3));

  const values = Array.from(
    { length: 6 },
    (_, i) =>
      58 +
      (n * 3 + semester * 5 + i * 4) % 32
  );

  const failed =
    semester === 1
      ? {
        '002': { 1: 41, 3: 44 },
        '003': { 2: 35 },
        '004': { 2: 38 },
        '005': { 4: 40 },
        '006': { 1: 46 },
        '007': { 3: 44 },
        '008': { 2: 40 },
        '016': { 2: 30 },
        '017': { 4: 49 }
      }
      : semester === 2
        ? {
          '009': { 1: 40 }
        }
        : {};

  if (usn.startsWith('1MV25MC')) {
    Object.assign(
      values,
      failed[usn.slice(-3)] || {}
    );
  }

  if (
    semester === 1 &&
    usn.endsWith('014')
  ) {
    values[0] = 65;
  }

  if (
    semester === 1 &&
    usn.endsWith('015')
  ) {
    values[0] = 55;
  }

  return values;
}

function marks(definition, percentage) {
  const total = Math.ceil(
    percentage *
    definition.max_marks /
    100
  );

  const internal = Math.min(
    definition.max_internal,
    Math.max(
      total - definition.max_external,
      Math.floor(total * 0.55)
    )
  );

  const external = total - internal;

  const grade = policy.gradeFromPercent(
    Math.floor(
      total *
      100 /
      definition.max_marks
    )
  );

  return {
    internal_marks: internal,
    external_marks: external,
    marks: total,
    grade: grade.grade,
    result_status: grade.status,
    grade_point: grade.point
  };
}

function plan() {
  const people = students();
  const results = [];

  const add = (
    usn,
    session,
    exam_type,
    values,
    attempt_no = 1
  ) => {
    if (isRealStudent(usn)) {
      throw new Error(
        `Refusing to add demo result for real student ${usn}.`
      );
    }

    results.push({
      usn,
      session,
      exam_type,
      values,
      attempt_no
    });
  };

  // Regular demo results for MCA 2025.
  // Real students are explicitly excluded.
  for (
    const student of people.filter(
      person =>
        person.batch === 'primary' &&
        !person.usn.endsWith('025') &&
        !isRealStudent(person.usn)
    )
  ) {
    for (
      let semester = 1;
      semester <= 3;
      semester++
    ) {
      if (
        semester === 3 &&
        ['026', '027'].includes(
          student.usn.slice(-3)
        )
      ) {
        continue;
      }

      add(
        student.usn,
        `p${semester}`,
        'REGULAR',
        percentages(
          student.usn,
          semester
        )
      );
    }
  }

  // Demo retakes/backlogs only.
  // No entries for 052, 061 or 074.
  for (
    const [
      suffix,
      session,
      type,
      values,
      attempt
    ] of [
      [
        '002',
        'p1jun',
        'SUPPLEMENTARY',
        { 1: 62, 3: 67 }
      ],
      [
        '003',
        'p1jun',
        'BACKLOG',
        { 2: 43 }
      ],
      [
        '004',
        'p1jun',
        'BACKLOG',
        { 2: 45 }
      ],
      [
        '004',
        'p1aug',
        'SUPPLEMENTARY',
        { 2: 66 }
      ],
      [
        '005',
        'p1jun',
        'REPEAT',
        { 4: 70 }
      ],
      [
        '009',
        'p2dec',
        'BACKLOG',
        { 1: 62 }
      ],
      [
        '016',
        'p1jun',
        'BACKLOG',
        { 2: 45 }
      ],
      [
        '017',
        'p1',
        'BACKLOG',
        { 4: 55 },
        2
      ]
    ]
  ) {
    add(
      `1MV25MC${suffix}`,
      session,
      type,
      values,
      attempt || 1
    );
  }

  for (
    const [i, student] of people
      .filter(
        person =>
          person.batch === 'current'
      )
      .entries()
  ) {
    for (
      let semester = 1;
      semester <= (i < 2 ? 1 : 2);
      semester++
    ) {
      add(
        student.usn,
        `c${semester}`,
        'REGULAR',
        percentages(
          student.usn,
          semester
        )
      );
    }
  }

  add(
    '1MV24MC901',
    'u1',
    'REGULAR',
    [65, 66, 67, 68, 69, 70]
  );

  add(
    '1MV24MC902',
    'u1jun',
    'REPEAT',
    { 2: 70 }
  );

  results.sort(
    (a, b) =>
      sessions.findIndex(
        session => session.key === a.session
      ) -
        sessions.findIndex(
          session => session.key === b.session
        ) ||
      a.attempt_no - b.attempt_no ||
      a.usn.localeCompare(b.usn)
  );

  // Demo revaluation scenarios only.
  // Real student 074 has been removed.
  const revaluations = [
    [
      '006',
      'p1',
      1,
      1,
      'pending',
      false,
      65
    ],
    [
      '007',
      'p1',
      3,
      1,
      'rejected',
      false,
      64
    ],
    [
      '008',
      'p1',
      2,
      1,
      'approved',
      false,
      45
    ],
    [
      '008',
      'p1',
      2,
      2,
      'approved',
      true,
      58
    ],
    [
      '008',
      'p1',
      2,
      3,
      'pending',
      false,
      80
    ],
    [
      '014',
      'p1',
      0,
      1,
      'approved',
      true,
      75
    ],
    [
      '015',
      'p1',
      0,
      1,
      'approved',
      true,
      49
    ],
    [
      '016',
      'p1jun',
      2,
      1,
      'approved',
      true,
      65
    ]
  ].map(
    ([
      suffix,
      session,
      courseIndex,
      revaluation_no,
      revaluation_status,
      is_effective,
      percentage
    ]) => {
      const usn = `1MV25MC${suffix}`;

      if (isRealStudent(usn)) {
        throw new Error(
          `Refusing to add demo revaluation for real student ${usn}.`
        );
      }

      return {
        usn,
        session,
        courseIndex,
        revaluation_no,
        revaluation_status,
        is_effective,
        percentage
      };
    }
  );

  return {
    batches,
    sessions,
    students: people,
    results,
    revaluations
  };
}

function eventDate(
  sessionKey,
  eventNo = 0
) {
  const session = sessions.find(
    item => item.key === sessionKey
  );

  const months = {
    Jun: 5,
    Aug: 7,
    Dec: 11
  };

  return new Date(
    Date.UTC(
      session.exam_year,
      months[session.exam_session],
      25 + eventNo
    )
  );
}

module.exports = {
  REAL_STUDENTS,
  REAL_STUDENT_USNS,
  isRealStudent,
  STAMP,
  uuid,
  batches,
  sessions,
  courses,
  students,
  marks,
  plan,
  percentages,
  eventDate
};