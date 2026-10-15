'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const data = require('./data');
const policy = require('../../services/academicPolicy');
const outcomes = require('../../services/academicOutcomeService');

async function inspect(db, transaction) {
  const rows = {};

  for (
    const name of [
      'Batch',
      'Student',
      'AcademicCourse',
      'ResultSession',
      'Subject',
      'Result',
      'SubjectResult',
      'RevaluationResult',
      'Faculty',
      'SubjectFaculty'
    ]
  ) {
    rows[name] =
      await db[name].findAll({
        raw: true,
        transaction
      });
  }

  return rows;
}

function references(rows) {
  const by = (list, id) =>
    new Map(
      list.map(row => [
        String(row[id]),
        row
      ])
    );

  return {
    batches:
      by(rows.Batch, 'batch_id'),

    students:
      by(rows.Student, 'student_id'),

    sessions:
      by(
        rows.ResultSession,
        'session_id'
      ),

    courses:
      by(
        rows.AcademicCourse,
        'course_id'
      ),

    subjects:
      by(rows.Subject, 'subject_id'),

    results:
      by(rows.Result, 'result_id'),

    subjectResults:
      by(
        rows.SubjectResult,
        'subject_result_id'
      ),

    faculty:
      by(rows.Faculty, 'faculty_id')
  };
}

function logicalDigest(rows) {
  const ref = references(rows);

  const resultKey =
    result => result.result_uuid;

  const subjectKey =
    subject => subject.subject_uuid;

  const courseKey = course => {
    const batch =
      ref.batches.get(
        String(course.batch_id)
      );

    return (
      `${batch.batch_name}:` +
      `${course.semester}:` +
      `${course.subject_code}`
    );
  };

  const sorted = list =>
    list.sort(
      (a, b) =>
        a.key.localeCompare(b.key)
    );

  const payload = {
    students: sorted(
      rows.Student.map(row => ({
        key: row.usn,
        name: row.student_name,
        email: row.email,

        batch:
          ref.batches.get(
            String(row.batch_id)
          ).batch_name,

        category: row.category
      }))
    ),

    courses: sorted(
      rows.AcademicCourse.map(
        row => ({
          key: courseKey(row),
          credits: row.credits,
          max: row.max_marks,
          name: row.subject_name,

          verified:
            Number(
              row.roster_verified
            ),

          scheme:
            row.grading_scheme_version
        })
      )
    ),

    subjects: sorted(
      rows.Subject.map(row => ({
        key: subjectKey(row),

        course:
          courseKey(
            ref.courses.get(
              String(row.course_id)
            )
          ),

        session:
          ref.sessions.get(
            String(row.session_id)
          ).session_uuid
      }))
    ),

    results: sorted(
      rows.Result.map(row => ({
        key: resultKey(row),

        usn:
          ref.students.get(
            String(row.student_id)
          ).usn,

        session:
          ref.sessions.get(
            String(row.session_id)
          ).session_uuid,

        type: row.exam_type,
        attempt: row.attempt_no,

        sgpa:
          row.sgpa == null
            ? null
            : Number(row.sgpa),

        cgpa:
          row.cgpa == null
            ? null
            : Number(row.cgpa),

        sgpa_source:
          row.sgpa_source,

        cgpa_source:
          row.cgpa_source,

        cumulative:
          Number(
            row.cgpa_is_cumulative
          ),

        status:
          row.result_status,

        failed:
          row.failed_subject_count
      }))
    ),

    marks: sorted(
      rows.SubjectResult.map(row => ({
        key:
          `${resultKey(
            ref.results.get(
              String(row.result_id)
            )
          )}:` +
          `${subjectKey(
            ref.subjects.get(
              String(row.subject_id)
            )
          )}`,

        ia: row.internal_marks,
        ex: row.external_marks,
        total: row.marks,
        grade: row.grade,
        status: row.result_status,

        points:
          row.grade_point == null
            ? null
            : Number(row.grade_point),

        credits:
          row.credits_snapshot,

        scheme:
          row.grading_scheme_version
      }))
    ),

    revaluation: sorted(
      rows.RevaluationResult.map(
        row => {
          const sr =
            ref.subjectResults.get(
              String(
                row.subject_result_id
              )
            );

          return {
            key:
              `${resultKey(
                ref.results.get(
                  String(sr.result_id)
                )
              )}:` +
              `${subjectKey(
                ref.subjects.get(
                  String(sr.subject_id)
                )
              )}:` +
              `${row.revaluation_no}`,

            status:
              row.revaluation_status,

            effective:
              Number(row.is_effective),

            old:
              row.original_marks,

            revised:
              row.revised_marks,

            old_status:
              row.original_status,

            revised_status:
              row.revised_status,

            grade:
              row.revised_grade
          };
        }
      )
    ),

    staff: sorted(
      rows.SubjectFaculty.map(
        row => ({
          key:
            `${subjectKey(
              ref.subjects.get(
                String(row.subject_id)
              )
            )}:` +
            `${ref.faculty.get(
              String(row.faculty_id)
            ).faculty_code}`
        })
      )
    )
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function verify(
  db,
  transaction
) {
  const plan = data.plan();

  const rows =
    await inspect(
      db,
      transaction
    );

  const ref =
    references(rows);

  assert.equal(
    rows.Student.length,
    plan.students.length,
    'Student count must match seed plan'
  );

  const distinct = (
    list,
    key
  ) => {
    assert.equal(
      new Set(
        list.map(key)
      ).size,
      list.length,
      'Duplicate logical identity'
    );
  };

  distinct(
    rows.Student,
    row => row.usn
  );

  distinct(
    rows.AcademicCourse,
    row =>
      `${row.batch_id}:` +
      `${row.semester}:` +
      `${row.subject_code}`
  );

  distinct(
    rows.ResultSession,
    row =>
      `${row.batch_id}:` +
      `${row.semester}:` +
      `${row.exam_session}:` +
      `${row.exam_year}`
  );

  distinct(
    rows.Result,
    row =>
      `${row.student_id}:` +
      `${row.session_id}:` +
      `${row.attempt_no}`
  );

  distinct(
    rows.RevaluationResult,
    row =>
      `${row.subject_result_id}:` +
      `${row.revaluation_no}`
  );

  const primaryBatch =
    rows.Batch.find(
      batch =>
        batch.batch_name ===
        'MCA 2025'
    );

  assert.ok(
    primaryBatch,
    'MCA 2025 batch must exist'
  );

  // Real students:
  // identity exists exactly once,
  // belongs to MCA 2025,
  // and has ZERO seeded results.
  for (
    const identity of
    data.REAL_STUDENTS
  ) {
    const matches =
      rows.Student.filter(
        student =>
          student.usn ===
          identity.usn
      );

    assert.equal(
      matches.length,
      1,
      `${identity.usn} must exist exactly once`
    );

    const student =
      matches[0];

    assert.equal(
      student.student_name,
      identity.name
    );

    assert.equal(
      student.email,
      identity.email
    );

    assert.equal(
      String(student.batch_id),
      String(
        primaryBatch.batch_id
      ),
      `${identity.usn} must belong to MCA 2025`
    );

    const academicResults =
      rows.Result.filter(
        result =>
          String(
            result.student_id
          ) ===
          String(
            student.student_id
          )
      );

    assert.equal(
      academicResults.length,
      0,
      `${identity.usn} must not have seeded academic results`
    );
  }

  for (
    const student of
    rows.Student.filter(
      row =>
        !data.REAL_STUDENTS.some(
          real =>
            real.usn === row.usn
        )
    )
  ) {
    assert.match(
      student.student_name,
      /^DEMO /
    );

    assert.match(
      student.email,
      /@example\.com$/
    );
  }

  assert.equal(
    rows.AcademicCourse.length,
    48
  );

  assert.equal(
    rows.ResultSession.length,
    12
  );

  assert.equal(
    rows.Subject.length,
    72
  );

  assert.equal(
    rows.Result.length,
    plan.results.length
  );

  assert.equal(
    rows.RevaluationResult.length,
    plan.revaluations.length
  );

  // Double-check no result references a real student.
  const realStudentIds =
    new Set(
      rows.Student
        .filter(
          student =>
            data.isRealStudent(
              student.usn
            )
        )
        .map(
          student =>
            String(
              student.student_id
            )
        )
    );

  for (
    const result of rows.Result
  ) {
    assert.ok(
      !realStudentIds.has(
        String(
          result.student_id
        )
      ),
      'Real students must not receive demo Result rows'
    );
  }

  for (
    const subject of rows.Subject
  ) {
    const course =
      ref.courses.get(
        String(
          subject.course_id
        )
      );

    const session =
      ref.sessions.get(
        String(
          subject.session_id
        )
      );

    assert.ok(course);

    assert.equal(
      String(course.batch_id),
      String(session.batch_id)
    );

    assert.equal(
      course.semester,
      session.semester
    );

    for (
      const field of [
        'subject_code',
        'subject_name',
        'subject_type',
        'credits',
        'max_internal',
        'max_external',
        'max_marks'
      ]
    ) {
      assert.equal(
        String(subject[field]),
        String(course[field])
      );
    }

    const batch =
      ref.batches.get(
        String(course.batch_id)
      );

    if (
      batch.batch_name !==
      'TEST UNVERIFIED MCA'
    ) {
      assert.equal(
        Number(
          course.roster_verified
        ),
        1
      );
    }
  }

  const states = {};

  for (
    const batchSpec of
    plan.batches
  ) {
    const row =
      rows.Batch.find(
        batch =>
          batch.batch_name ===
          batchSpec.name
      );

    assert.ok(row);

    const ids =
      rows.Student
        .filter(
          student =>
            String(
              student.batch_id
            ) ===
            String(row.batch_id)
        )
        .map(
          student =>
            student.student_id
        );

    states[batchSpec.key] = {
      original:
        await outcomes.load(
          row.batch_id,
          ids,
          'original',
          transaction
        ),

      effective:
        await outcomes.load(
          row.batch_id,
          ids,
          'effective',
          transaction
        )
    };
  }

  for (
    const header of
    rows.Result
  ) {
    const marks =
      rows.SubjectResult.filter(
        sr =>
          String(
            sr.result_id
          ) ===
          String(
            header.result_id
          )
      );

    const session =
      ref.sessions.get(
        String(
          header.session_id
        )
      );

    const student =
      ref.students.get(
        String(
          header.student_id
        )
      );

    assert.ok(
      !data.isRealStudent(
        student.usn
      ),
      `${student.usn} must not have demo results`
    );

    const sessionSpec =
      plan.sessions.find(
        item =>
          data.uuid(item.key) ===
          session.session_uuid
      );

    const spec =
      plan.results.find(
        item =>
          item.usn ===
            student.usn &&
          item.session ===
            sessionSpec.key &&
          item.attempt_no ===
            header.attempt_no
      );

    assert.ok(spec);

    assert.equal(
      marks.length,
      Object.keys(
        spec.values
      ).length,
      'No invented retake rows'
    );

    const failed =
      marks.filter(
        sr =>
          sr.result_status ===
          'fail'
      ).length;

    assert.equal(
      header.failed_subject_count,
      failed
    );

    assert.equal(
      header.result_status,
      failed
        ? 'fail'
        : 'pass'
    );

    for (const sr of marks) {
      const subject =
        ref.subjects.get(
          String(
            sr.subject_id
          )
        );

      assert.equal(
        String(
          subject.session_id
        ),
        String(
          header.session_id
        )
      );

      assert.ok(
        sr.marks > 0 &&
        sr.marks <=
          subject.max_marks
      );

      const expected =
        policy.gradeFromPercent(
          Math.floor(
            sr.marks *
            100 /
            subject.max_marks
          )
        );

      assert.equal(
        sr.grade,
        expected.grade
      );

      assert.equal(
        sr.result_status,
        expected.status
      );

      if (
        sr.internal_marks !== null &&
        sr.external_marks !== null
      ) {
        assert.equal(
          sr.internal_marks +
            sr.external_marks,
          sr.marks
        );

        assert.ok(
          sr.internal_marks >= 0 &&
          sr.internal_marks <=
            subject.max_internal
        );

        assert.ok(
          sr.external_marks >= 0 &&
          sr.external_marks <=
            subject.max_external
        );
      } else {
        assert.ok(
          student.usn ===
            '1MV25MC012' &&
          sessionSpec.key ===
            'p1' &&
          subject.subject_code ===
            'MMC101',
          'Only the explicit historical fixture lacks components'
        );
      }

      if (
        sessionSpec.batch !==
        'unknown'
      ) {
        assert.equal(
          sr.grading_scheme_version,
          policy.SCHEME
        );

        assert.equal(
          Number(
            sr.grade_point
          ),
          expected.point
        );

        assert.equal(
          sr.credits_snapshot,
          subject.credits
        );

        assert.equal(
          String(
            sr.course_id_snapshot
          ),
          String(
            subject.course_id
          )
        );
      }
    }

    if (
      policy.isRegularAttempt(
        header.exam_type
      )
    ) {
      assert.equal(
        marks.length,
        data.courses(
          Number(
            session.semester
          )
        ).length,
        'Full regular roster'
      );

      if (
        sessionSpec.batch !==
        'unknown'
      ) {
        const credits =
          marks.reduce(
            (sum, sr) =>
              sum +
              Number(
                sr.credits_snapshot
              ),
            0
          );

        const expected =
          Number(
            (
              marks.reduce(
                (sum, sr) =>
                  sum +
                  Number(
                    sr.grade_point
                  ) *
                  sr.credits_snapshot,
                0
              ) /
              credits
            ).toFixed(2)
          );

        assert.equal(
          Number(
            header.sgpa
          ),
          expected
        );

        assert.equal(
          header.sgpa_source,
          'CALCULATED'
        );
      }
    } else {
      assert.equal(
        header.sgpa,
        null,
        'Retake SGPA remains unavailable'
      );
    }

    const original =
      states[
        sessionSpec.batch
      ].original;

    const published = {
      ...original,

      results:
        original.results.filter(
          result =>
            BigInt(
              result.result_id
            ) <=
            BigInt(
              header.result_id
            )
        ),

      subjects:
        original.subjects.filter(
          subjectResult =>
            BigInt(
              subjectResult.result_id
            ) <=
            BigInt(
              header.result_id
            )
        )
    };

    const expected =
      outcomes.cumulative(
        published,
        header.student_id,
        session.semester,
        policy.period(session)
      );

    assert.equal(
      header.cgpa === null
        ? null
        : Number(
          header.cgpa
        ),
      expected,
      'Cumulative snapshot follows existing service at publication'
    );

    assert.equal(
      Number(
        header.cgpa_is_cumulative
      ),
      expected === null
        ? 0
        : 1
    );
  }

  for (
    const event of
    rows.RevaluationResult
  ) {
    const sr =
      ref.subjectResults.get(
        String(
          event.subject_result_id
        )
      );

    const result =
      ref.results.get(
        String(
          sr.result_id
        )
      );

    const student =
      ref.students.get(
        String(
          result.student_id
        )
      );

    assert.ok(
      !data.isRealStudent(
        student.usn
      ),
      `${student.usn} must not have demo revaluation data`
    );

    assert.equal(
      event.original_marks,
      sr.marks
    );

    assert.equal(
      event.original_status,
      sr.result_status
    );

    const subject =
      ref.subjects.get(
        String(
          sr.subject_id
        )
      );

    const expected =
      policy.gradeFromPercent(
        Math.floor(
          event.revised_marks *
          100 /
          subject.max_marks
        )
      );

    assert.equal(
      event.revised_status,
      expected.status
    );

    if (
      event.revaluation_status !==
      'approved'
    ) {
      assert.equal(
        Number(
          event.is_effective
        ),
        0
      );
    }
  }

  const effective =
    rows.RevaluationResult.filter(
      row =>
        Number(
          row.is_effective
        )
    );

  distinct(
    effective,
    row =>
      row.subject_result_id
  );

  const check = (
    usn,
    semester,
    mode,
    first,
    supplementary,
    cleared
  ) => {
    assert.ok(
      !data.isRealStudent(usn),
      'Demo outcome checks cannot use real students'
    );

    const person =
      rows.Student.find(
        student =>
          student.usn === usn
      );

    const batch =
      plan.students.find(
        student =>
          student.usn === usn
      ).batch;

    const actual =
      outcomes.semesterOutcome(
        states[batch][mode],
        person.student_id,
        String(semester)
      );

    assert.equal(
      actual.firstAttempt,
      first,
      usn
    );

    assert.equal(
      actual.supplementaryPass,
      supplementary,
      usn
    );

    assert.equal(
      actual.cleared,
      cleared,
      usn
    );

    return actual;
  };

  check(
    '1MV25MC002',
    1,
    'original',
    'F',
    'P',
    true
  );

  check(
    '1MV25MC003',
    1,
    'original',
    'F',
    'F',
    false
  );

  const multiple =
    check(
      '1MV25MC004',
      1,
      'original',
      'F',
      'P',
      true
    );

  assert.equal(
    multiple.courses[2]
      .attempts.length,
    3
  );

  check(
    '1MV25MC005',
    1,
    'original',
    'F',
    'P',
    true
  );

  check(
    '1MV25MC017',
    1,
    'original',
    'F',
    'P',
    true
  );

  for (
    const semester of [1, 2, 3]
  ) {
    check(
      '1MV25MC009',
      semester,
      'original',
      semester === 2
        ? 'F'
        : 'P',
      semester === 2
        ? 'P'
        : '-',
      true
    );
  }

  check(
    '1MV25MC008',
    1,
    'original',
    'F',
    '-',
    false
  );

  check(
    '1MV25MC008',
    1,
    'effective',
    'P',
    '-',
    true
  );

  for (
    const suffix of [
      '006',
      '007'
    ]
  ) {
    for (
      const mode of [
        'original',
        'effective'
      ]
    ) {
      check(
        `1MV25MC${suffix}`,
        1,
        mode,
        'F',
        '-',
        false
      );
    }
  }

  check(
    '1MV25MC015',
    1,
    'original',
    'P',
    '-',
    true
  );

  check(
    '1MV25MC015',
    1,
    'effective',
    'F',
    '-',
    false
  );

  check(
    '1MV25MC016',
    1,
    'original',
    'F',
    'F',
    false
  );

  check(
    '1MV25MC016',
    1,
    'effective',
    'F',
    'P',
    true
  );

  for (
    const usn of [
      '1MV24MC901',
      '1MV24MC902'
    ]
  ) {
    check(
      usn,
      1,
      'original',
      '-',
      '-',
      null
    );

    const person =
      rows.Student.find(
        student =>
          student.usn === usn
      );

    assert.equal(
      outcomes.cumulative(
        states.unknown.original,
        person.student_id,
        1
      ),
      null
    );
  }

  const normal =
    rows.Student.find(
      student =>
        student.usn ===
        '1MV25MC001'
    );

  assert.equal(
    outcomes.cumulative(
      states.primary.original,
      normal.student_id,
      3
    ),
    8.16,
    'Cumulative GPA differs from latest semester SGPA'
  );

  const future =
    check(
      '1MV25MC026',
      3,
      'original',
      '-',
      '-',
      null
    );

  assert.equal(
    future.firstRegularResult,
    null
  );

  const counts = {
    students:
      rows.Student.length,

    courses:
      rows.AcademicCourse.length,

    sessions:
      rows.ResultSession.length,

    subjects:
      rows.Subject.length,

    subjectResults:
      rows.SubjectResult.length,

    results:
      Object.fromEntries(
        policy.EXAM_TYPES.map(
          type => [
            type,
            rows.Result.filter(
              row =>
                row.exam_type === type
            ).length
          ]
        )
      ),

    revaluations:
      Object.fromEntries(
        [
          'approved',
          'pending',
          'rejected'
        ].map(
          status => [
            status,
            rows.RevaluationResult
              .filter(
                row =>
                  row.revaluation_status ===
                  status
              ).length
          ]
        )
      )
  };

  return {
    counts,
    digest:
      logicalDigest(rows),
    rows,
    states
  };
}

async function verifyReports(db) {
  const reports =
    require(
      '../../services/reportsService'
    );

  const primary =
    await db.Batch.findOne({
      where: {
        batch_name:
          'MCA 2025'
      }
    });

  assert.ok(primary);

  const session =
    await db.ResultSession.findOne({
      where: {
        batch_id:
          primary.batch_id,

        semester: '1',
        exam_session: 'Dec',
        exam_year: 2025
      }
    });

  assert.ok(session);

  const subject =
    await db.Subject.findOne({
      where: {
        session_id:
          session.session_id,

        subject_code:
          'MMC103'
      }
    });

  assert.ok(subject);

  const common = {
    batch_id:
      String(
        primary.batch_id
      ),

    semester: '1',

    session_id:
      String(
        session.session_id
      ),

    pageSize: '100'
  };

  // Reports must remain populated using demo students.
  for (
    const type of [
      'subject',
      'consolidated',
      'toppers',
      'result-analysis',
      'revaluation'
    ]
  ) {
    const report =
      await reports.getReport(
        type,
        {
          ...common,

          ...(type === 'subject'
            ? {
              subject_id:
                String(
                  subject.subject_id
                )
            }
            : {})
        }
      );

    assert.ok(
      report.rows.length,
      `${type} populated`
    );
  }

  const progress =
    await reports.getReport(
      'student-progress',
      {
        batch_id:
          String(
            primary.batch_id
          ),

        pageSize: '100',
        mode: 'original'
      }
    );

  assert.deepEqual(
    progress.semesters.map(
      semester =>
        String(
          semester.semester
        )
    ),
    ['1', '2', '3'],
    'Upcoming Semester 4 is excluded'
  );

  assert.equal(
    progress.rows.find(
      row =>
        row.usn ===
        '1MV25MC026'
    ).semesters['3']
      .first_attempt,
    '-'
  );

  assert.equal(
    progress.rows.find(
      row =>
        row.usn ===
        '1MV25MC025'
    ).semesters['1']
      .marks,
    null
  );

  assert.equal(
    progress.rows.find(
      row =>
        row.usn ===
        '1MV25MC001'
    ).latest_cgpa,
    8.16
  );

  // Real students may appear in the roster/progress report,
  // but they must not have seeded academic values.
  for (
    const identity of
    data.REAL_STUDENTS
  ) {
    const student =
      await db.Student.findOne({
        where: {
          usn: identity.usn
        }
      });

    assert.ok(student);

    const resultCount =
      await db.Result.count({
        where: {
          student_id:
            student.student_id
        }
      });

    assert.equal(
      resultCount,
      0,
      `${identity.usn} must have zero seeded results`
    );
  }

  const analytics =
    require(
      '../../services/analyticsService'
    );

  const overview =
    await analytics.getOverview({
      batch_id:
        String(
          primary.batch_id
        ),

      mode: 'effective',
      attempt: 'all'
    });

  assert.ok(
    overview.parent.resultTotal > 0
  );

  return (
    'Reports and Analytics verified; ' +
    'real students remain identity-only.'
  );
}

module.exports = {
  inspect,
  logicalDigest,
  verify,
  verifyReports
};