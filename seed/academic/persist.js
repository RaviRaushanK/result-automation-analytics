'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

const data = require('./data');
const policy = require('../../services/academicPolicy');
const outcomes = require('../../services/academicOutcomeService');

const BACKUP_TABLES = [
  'ocr_extractions',
  'import_logs',
  'revaluation_results',
  'subject_results',
  'results',
  'subject_faculty',
  'subjects',
  'result_sessions',
  'academic_courses',
  'students',
  'batches'
];

async function reset(db, transaction) {
  // Delete academic/demo dependent data first.
  // Foreign keys remain enabled.
  for (
    const table of BACKUP_TABLES.slice(0, 9)
  ) {
    await db.sequelize.query(
      `DELETE FROM ${table}`,
      { transaction }
    );
  }

  // Keep only the three required real identities.
  await db.Student.destroy({
    where: {
      usn: {
        [Op.notIn]:
          data.REAL_STUDENTS.map(
            student => student.usn
          )
      }
    },
    force: true,
    transaction
  });
}

async function accounts(db, transaction) {
  const rows = {};

  const columns =
    await db.sequelize
      .getQueryInterface()
      .describeTable('admin_users');

  const roles = [
    ['admin', 'DemoAdmin2026!']
  ];

  if (
    !/^ENUM/i.test(columns.role.type) ||
    /['"]faculty['"]/i.test(
      columns.role.type
    )
  ) {
    roles.push([
      'faculty',
      'DemoFaculty2026!'
    ]);
  } else {
    console.log(
      'Faculty login unavailable: existing ' +
      'admin_users.role enum supports admin only. ' +
      'Schema/authentication unchanged.'
    );
  }

  for (
    const [role, password] of roles
  ) {
    const username = `demo_${role}`;
    const email =
      `demo-${role}@example.com`;

    const [row, created] =
      await db.AdminUser.findOrCreate({
        where: { username },

        defaults: {
          admin_uuid:
            data.uuid(username),

          email,

          password_hash:
            await bcrypt.hash(
              password,
              10
            ),

          role,
          status: 'active'
        },

        transaction,
        paranoid: false
      });

    if (
      row.email !== email ||
      row.role !== role ||
      row.deleted_at
    ) {
      throw new Error(
        `Demo login collision: ${username}; ` +
        'existing account was not overwritten.'
      );
    }

    if (
      !created &&
      !await bcrypt.compare(
        password,
        row.password_hash
      )
    ) {
      throw new Error(
        `Demo login password changed: ${username}; ` +
        'refusing to overwrite it.'
      );
    }

    rows[role] = row;
  }

  return rows;
}

async function persist(db, transaction) {
  const plan = data.plan();

  const realStudentUsns =
    new Set(
      data.REAL_STUDENTS.map(
        student => student.usn
      )
    );

  const users =
    await accounts(db, transaction);

  const [department] =
    await db.Department.findOrCreate({
      where: {
        department_code: 'MCA'
      },

      defaults: {
        department_uuid:
          data.uuid('MCA'),

        department_name:
          'Master of Computer Applications',

        description: 'MCA',
        status: 'active'
      },

      transaction
    });

  const faculty = [];

  for (let i = 1; i <= 3; i++) {
    const faculty_code =
      `DEMO-F${i}`;

    const [row] =
      await db.Faculty.findOrCreate({
        where: { faculty_code },

        defaults: {
          faculty_uuid:
            data.uuid(faculty_code),

          department_id:
            department.department_id,

          faculty_name:
            `DEMO FACULTY ${i}`,

          email:
            `demo-faculty-${i}@example.com`,

          designation:
            'Demo Teaching Faculty',

          status: 'active'
        },

        transaction
      });

    if (
      row.faculty_name !==
        `DEMO FACULTY ${i}` ||
      Number(row.department_id) !==
        Number(
          department.department_id
        )
    ) {
      throw new Error(
        `Demo faculty collision: ${faculty_code}`
      );
    }

    faculty.push(row);
  }

  const batches = {};
  const sessions = {};
  const courses = {};
  const offerings = {};
  const students = {};
  const results = {};
  const subjectResults = {};

  for (const spec of plan.batches) {
    const [row] =
      await db.Batch.findOrCreate({
        where: {
          department_id:
            department.department_id,

          batch_name: spec.name
        },

        defaults: {
          batch_uuid:
            data.uuid(spec.key),

          start_year: spec.start,
          end_year: spec.end,
          status: 'active'
        },

        paranoid: false,
        transaction
      });

    if (row.deleted_at) {
      throw new Error(
        `Batch ${spec.name} is soft-deleted; ` +
        'review it before seeding.'
      );
    }

    batches[spec.key] = row;
  }

  for (
    const session of plan.sessions
  ) {
    const batch =
      batches[session.batch];

    for (
      const definition of
      data.courses(
        Number(session.semester)
      )
    ) {
      const key =
        `${session.batch}:` +
        `${session.semester}:` +
        `${definition.subject_code}`;

      if (courses[key]) {
        continue;
      }

      const batchSpec =
        plan.batches.find(
          item =>
            item.key ===
            session.batch
        );

      const verified =
        batchSpec.verified;

      courses[key] =
        await db.AcademicCourse.create({
          ...definition,

          batch_id:
            batch.batch_id,

          semester:
            session.semester,

          is_required: true,
          roster_verified: verified,

          grading_scheme_version:
            verified
              ? policy.SCHEME
              : null,

          reviewed_by:
            verified
              ? users.admin.admin_id
              : null,

          reviewed_at:
            verified
              ? data.STAMP
              : null,

          created_at: data.STAMP,
          updated_at: data.STAMP
        }, {
          transaction
        });
    }

    const row =
      await db.ResultSession.create({
        session_uuid:
          data.uuid(session.key),

        batch_id:
          batch.batch_id,

        semester:
          session.semester,

        exam_session:
          session.exam_session,

        exam_year:
          session.exam_year,

        created_at:
          data.STAMP,

        updated_at:
          data.STAMP
      }, {
        transaction
      });

    sessions[session.key] = row;
    offerings[session.key] = [];

    const definitions =
      data.courses(
        Number(session.semester)
      );

    for (
      const [i, definition]
      of definitions.entries()
    ) {
      const course =
        courses[
          `${session.batch}:` +
          `${session.semester}:` +
          `${definition.subject_code}`
        ];

      const offering =
        await db.Subject.create({
          ...definition,

          subject_uuid:
            data.uuid(
              `${session.key}:` +
              definition.subject_code
            ),

          course_id:
            course.course_id,

          session_id:
            row.session_id,

          created_at:
            data.STAMP,

          updated_at:
            data.STAMP
        }, {
          transaction
        });

      offerings[session.key]
        .push(offering);

      if (
        definition.subject_type !==
        'lab'
      ) {
        await db.SubjectFaculty.create({
          subject_id:
            offering.subject_id,

          faculty_id:
            faculty[
              i % 3
            ].faculty_id,

          created_at:
            data.STAMP
        }, {
          transaction
        });
      }

      if (i === 0) {
        await db.SubjectFaculty.create({
          subject_id:
            offering.subject_id,

          faculty_id:
            faculty[
              (i + 1) % 3
            ].faculty_id,

          created_at:
            data.STAMP
        }, {
          transaction
        });
      }
    }
  }

  // Create/update student identities.
  //
  // Real students are deliberately included here.
  // All three are assigned to primary = MCA 2025.
  for (
    const spec of plan.students
  ) {
    const identity =
      data.REAL_STUDENTS.find(
        student =>
          student.usn === spec.usn
      );

    let row = identity
      ? await db.Student.findOne({
        where: {
          usn: spec.usn
        },
        paranoid: false,
        transaction
      })
      : null;

    if (row) {
      if (
        row.student_name !==
          identity.name ||
        row.email !==
          identity.email ||
        row.deleted_at
      ) {
        throw new Error(
          `Required student identity mismatch: ` +
          `${spec.usn}; refusing to rename ` +
          'or recreate it.'
        );
      }

      await row.update({
        batch_id:
          batches[
            spec.batch
          ].batch_id,

        category:
          spec.category,

        status: 'active'
      }, {
        transaction
      });
    } else {
      row =
        await db.Student.create({
          student_uuid:
            data.uuid(spec.usn),

          usn:
            spec.usn,

          student_name:
            spec.name,

          email:
            spec.email,

          category:
            spec.category,

          batch_id:
            batches[
              spec.batch
            ].batch_id,

          status:
            'active',

          created_at:
            data.STAMP,

          updated_at:
            data.STAMP
        }, {
          transaction
        });
    }

    students[spec.usn] = row;
  }

  // Demo results.
  //
  // Hard guard: a real student can never receive
  // seeded academic results.
  for (
    const spec of plan.results
  ) {
    if (
      realStudentUsns.has(
        spec.usn
      )
    ) {
      throw new Error(
        `Refusing to seed demo result ` +
        `for real student ${spec.usn}.`
      );
    }

    const session =
      sessions[spec.session];

    const person =
      students[spec.usn];

    if (!person) {
      throw new Error(
        `Student ${spec.usn} was not ` +
        'created before result seeding.'
      );
    }

    const studentSpec =
      plan.students.find(
        student =>
          student.usn === spec.usn
      );

    const verified =
      studentSpec.batch !==
      'unknown';

    const selected =
      Object.entries(
        spec.values
      ).map(
        ([index, pct]) => ({
          subject:
            offerings[
              spec.session
            ][Number(index)],

          pct
        })
      );

    const marks =
      selected.map(
        ({ subject, pct }) => ({
          ...data.marks(
            subject,
            pct
          ),

          subject
        })
      );

    const failures =
      marks.filter(
        mark =>
          mark.result_status ===
          'fail'
      ).length;

    const regular =
      policy.isRegularAttempt(
        spec.exam_type
      );

    const credits =
      marks.reduce(
        (total, mark) =>
          total +
          Number(
            mark.subject.credits
          ),
        0
      );

    const sgpa =
      regular &&
      verified &&
      credits > 0
        ? Number(
          (
            marks.reduce(
              (total, mark) =>
                total +
                mark.grade_point *
                Number(
                  mark.subject.credits
                ),
              0
            ) /
            credits
          ).toFixed(2)
        )
        : null;

    const key =
      `${spec.usn}:` +
      `${spec.session}:` +
      `${spec.attempt_no}`;

    const header =
      await db.Result.create({
        result_uuid:
          data.uuid(key),

        student_id:
          person.student_id,

        session_id:
          session.session_id,

        attempt_no:
          spec.attempt_no,

        exam_type:
          spec.exam_type,

        sgpa,
        cgpa: null,

        sgpa_source:
          sgpa === null
            ? (
              verified
                ? 'UNKNOWN'
                : 'LEGACY'
            )
            : 'CALCULATED',

        cgpa_source:
          verified
            ? 'UNKNOWN'
            : 'LEGACY',

        cgpa_is_cumulative:
          false,

        grading_scheme_version:
          verified
            ? policy.SCHEME
            : null,

        result_status:
          failures
            ? 'fail'
            : 'pass',

        failed_subject_count:
          failures,

        created_at:
          data.STAMP,

        updated_at:
          data.STAMP
      }, {
        transaction
      });

    results[key] = header;

    for (const mark of marks) {
      const historical =
        spec.usn ===
          '1MV25MC012' &&
        spec.session ===
          'p1' &&
        mark.subject.subject_code ===
          'MMC101';

      const row =
        await db.SubjectResult.create({
          result_id:
            header.result_id,

          subject_id:
            mark.subject.subject_id,

          internal_marks:
            historical
              ? null
              : mark.internal_marks,

          external_marks:
            historical
              ? null
              : mark.external_marks,

          marks:
            mark.marks,

          grade:
            mark.grade,

          result_status:
            mark.result_status,

          grading_scheme_version:
            verified
              ? policy.SCHEME
              : null,

          grade_point:
            verified
              ? mark.grade_point
              : null,

          credits_snapshot:
            verified
              ? mark.subject.credits
              : null,

          course_id_snapshot:
            verified
              ? mark.subject.course_id
              : null,

          created_at:
            data.STAMP,

          updated_at:
            data.STAMP
        }, {
          transaction
        });

      subjectResults[
        `${key}:` +
        mark.subject.subject_code
      ] = row;
    }

    const cumulative =
      await outcomes.calculateCumulative(
        person.batch_id,
        person.student_id,
        session.semester,
        policy.period(session),
        transaction
      );

    if (cumulative !== null) {
      await header.update({
        cgpa: cumulative,
        cgpa_source:
          'CALCULATED',
        cgpa_is_cumulative:
          true
      }, {
        transaction
      });
    }
  }

  // Demo revaluation data.
  //
  // Again, hard-block real students.
  for (
    const spec of plan.revaluations
  ) {
    if (
      realStudentUsns.has(
        spec.usn
      )
    ) {
      throw new Error(
        `Refusing to seed demo revaluation ` +
        `for real student ${spec.usn}.`
      );
    }

    const offering =
      offerings[
        spec.session
      ][spec.courseIndex];

    const original =
      subjectResults[
        `${spec.usn}:` +
        `${spec.session}:1:` +
        `${offering.subject_code}`
      ];

    if (!original) {
      throw new Error(
        `Missing original subject result ` +
        `for demo revaluation ${spec.usn} ` +
        `${spec.session} ` +
        `${offering.subject_code}.`
      );
    }

    const revision =
      data.marks(
        offering,
        spec.percentage
      );

    await db.RevaluationResult.create({
      subject_result_id:
        original.subject_result_id,

      revaluation_no:
        spec.revaluation_no,

      is_effective:
        spec.is_effective,

      original_marks:
        original.marks,

      original_status:
        original.result_status,

      revised_marks:
        revision.marks,

      revised_status:
        revision.result_status,

      revised_grade:
        revision.grade,

      revaluation_status:
        spec.revaluation_status,

      uploaded_by:
        users.admin.admin_id,

      reviewed_by:
        spec.revaluation_status ===
        'pending'
          ? null
          : users.admin.admin_id,

      reviewed_at:
        spec.revaluation_status ===
        'pending'
          ? null
          : data.eventDate(
            spec.session,
            spec.revaluation_no + 1
          ),

      upload_date:
        data.eventDate(
          spec.session,
          spec.revaluation_no
        ),

      file_name: null,
      file_path: null,

      remarks: JSON.stringify({
        source:
          'DEMO_SEED_V1',

        decision:
          spec.revaluation_status,

        was_manual_correction:
          false,

        event_ids: [],
        import_id: null,

        base_remarks:
          'Synthetic canonical ledger event; ' +
          'no OCR or uploaded document is claimed.'
      })
    }, {
      transaction
    });
  }

  return {
    plan,
    batches,
    sessions,
    students,
    results,
    offerings,
    subjectResults,
    users
  };
}

module.exports = {
  BACKUP_TABLES,
  reset,
  persist
};