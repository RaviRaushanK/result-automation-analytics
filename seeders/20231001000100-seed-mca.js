'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {

    // ============================================================
    // CONSTANT IDs
    // ============================================================

    const departmentId = 1;
    const batchId = 1;
    const sessionId = 1;

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    let seed = 12345;

    function random() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    function randomInt(min, max) {
      return Math.floor(random() * (max - min + 1)) + min;
    }

    // Convert marks to grade and grade point
    function getGrade(marks) {
      if (marks >= 90) return { grade: 'O', point: 10 };
      if (marks >= 80) return { grade: 'A+', point: 9 };
      if (marks >= 70) return { grade: 'A', point: 8 };
      if (marks >= 60) return { grade: 'B+', point: 7 };
      if (marks >= 50) return { grade: 'B', point: 6 };
      if (marks >= 40) return { grade: 'C', point: 5 };
      return { grade: 'F', point: 0 };
    }

    // ============================================================
    // 1. DEPARTMENT
    // ============================================================

    await queryInterface.bulkInsert('departments', [
      {
        department_id: departmentId,

        department_uuid:
          '11111111-1111-1111-1111-111111111111',

        department_code: 'MCA',

        department_name:
          'Master of Computer Applications',

        description:
          'MCA Department',

        status: 'active',

        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ============================================================
    // 2. BATCH
    // ============================================================

    await queryInterface.bulkInsert('batches', [
      {
        batch_id: batchId,

        batch_uuid:
          '22222222-2222-2222-2222-222222222222',

        department_id: departmentId,

        batch_name:
          'MCA 2025-2027',

        start_year: 2025,

        end_year: 2027,

        status: 'active',

        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ============================================================
    // 3. FACULTY - 7 FACULTY
    // ============================================================

    const facultyNames = [
      'Dr. Ananya Sharma',
      'Dr. Rajesh Kumar',
      'Prof. Priya Singh',
      'Dr. Vikram Rao',
      'Prof. Neha Verma',
      'Dr. Arjun Mehta',
      'Prof. Sneha Reddy'
    ];

    const designations = [
      'Professor',
      'Associate Professor',
      'Assistant Professor'
    ];

    const faculty = [];

    for (let i = 0; i < 7; i++) {

      faculty.push({

        faculty_id: i + 1,

        faculty_uuid:
          `33333333-3333-3333-3333-${String(i + 1).padStart(12, '0')}`,

        department_id: departmentId,

        faculty_code:
          `FAC${String(i + 1).padStart(3, '0')}`,

        faculty_name:
          facultyNames[i],

        email:
          `faculty${i + 1}@example.com`,

        designation:
          designations[
            randomInt(0, designations.length - 1)
          ],

        status: 'active',

        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await queryInterface.bulkInsert(
      'faculty',
      faculty
    );

    // ============================================================
    // 4. RESULT SESSION
    // ============================================================

    await queryInterface.bulkInsert('result_sessions', [
      {
        session_id: sessionId,

        session_uuid:
          '44444444-4444-4444-4444-444444444444',

        batch_id: batchId,

        semester: 'Semester 1',

        exam_session: 'DEC',

        exam_year: 2025,

        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ============================================================
    // 5. SUBJECTS - ACTUAL SUBJECTS FROM MARKS CARD
    // ============================================================

    await queryInterface.bulkInsert('subjects', [

      {
        subject_id: 1,

        subject_uuid:
          '55555555-5555-5555-5555-555555555555',

        session_id: sessionId,

        subject_code: 'MMC101',

        subject_name:
          'PROGRAMMING AND PROBLEM SOLVING IN C',

        subject_type: 'theory',

        credits: 4,

        max_internal: 50,

        max_external: 50,

        max_marks: 100,

        created_at: new Date(),
        updated_at: new Date()
      },

      {
        subject_id: 2,

        subject_uuid:
          '66666666-6666-6666-6666-666666666666',

        session_id: sessionId,

        subject_code: 'MMC102',

        subject_name:
          'DISCRETE MATHEMATICS AND GRAPH THEORY',

        subject_type: 'theory',

        credits: 4,

        max_internal: 50,

        max_external: 50,

        max_marks: 100,

        created_at: new Date(),
        updated_at: new Date()
      },

      {
        subject_id: 3,

        subject_uuid:
          '66666666-6666-6666-6666-666666666667',

        session_id: sessionId,

        subject_code: 'MMC103',

        subject_name:
          'DATABASE MANAGEMENT SYSTEMS (DBMS)',

        subject_type: 'theory',

        credits: 4,

        max_internal: 50,

        max_external: 50,

        max_marks: 100,

        created_at: new Date(),
        updated_at: new Date()
      },

      {
        subject_id: 4,

        subject_uuid:
          '66666666-6666-6666-6666-666666666668',

        session_id: sessionId,

        subject_code: 'MMC104',

        subject_name:
          'OPERATING SYSTEM',

        subject_type: 'theory',

        credits: 4,

        max_internal: 50,

        max_external: 50,

        max_marks: 100,

        created_at: new Date(),
        updated_at: new Date()
      },

      {
        subject_id: 5,

        subject_uuid:
          '66666666-6666-6666-6666-666666666669',

        session_id: sessionId,

        subject_code: 'MMC105',

        subject_name:
          'WEB TECHNOLOGIES',

        subject_type: 'theory',

        credits: 4,

        max_internal: 50,

        max_external: 50,

        max_marks: 100,

        created_at: new Date(),
        updated_at: new Date()
      },

      {
        subject_id: 6,

        subject_uuid:
          '66666666-6666-6666-6666-666666666670',

        session_id: sessionId,

        subject_code: 'MMCL106',

        subject_name:
          'DBMS AND WEB TECHNOLOGIES LABORATORY',

        subject_type: 'lab',

        credits: 4,

        max_internal: 50,

        max_external: 50,

        max_marks: 100,

        created_at: new Date(),
        updated_at: new Date()
      }

    ]);

    // ============================================================
    // 6. STUDENTS - 76 STUDENTS
    // ============================================================

    const firstNames = [
      'Ravi',
      'Aarav',
      'Aditya',
      'Arjun',
      'Rahul',
      'Rohan',
      'Karan',
      'Vivek',
      'Akash',
      'Nikhil',
      'Sahil',
      'Ankit',
      'Varun',
      'Aman',
      'Rishabh',
      'Abhishek',
      'Ayush',
      'Manish',
      'Rajat',
      'Mohit'
    ];

    const lastNames = [
      'Kumar',
      'Sharma',
      'Singh',
      'Verma',
      'Reddy',
      'Rao',
      'Patel',
      'Mehta',
      'Gupta',
      'Yadav',
      'Mishra',
      'Joshi',
      'Das',
      'Nair',
      'Shah',
      'Agarwal',
      'Bhat',
      'Iyer',
      'Pillai',
      'Choudhary'
    ];

    const students = [];

    for (let i = 1; i <= 76; i++) {

      // ----------------------------------------------------------
      // Real student from uploaded marks card
      // ----------------------------------------------------------

      if (i === 1) {

        students.push({

          student_id: 1,

          student_uuid:
            '77777777-7777-7777-7777-000000000001',

          batch_id: batchId,

          usn:
            '1MV25MC061',

          student_name:
            'RAVI RAUSHAN KUMAR',

          email:
            'student1@example.com',

          status: 'active',

          created_at: new Date(),
          updated_at: new Date()
        });

        continue;
      }

      // ----------------------------------------------------------
      // Dummy students for analytics/demo data
      // ----------------------------------------------------------

      const firstName =
        firstNames[(i - 1) % firstNames.length];

      const lastName =
        lastNames[
          randomInt(0, lastNames.length - 1)
        ];

      students.push({

        student_id: i,

        student_uuid:
          `77777777-7777-7777-7777-${String(i).padStart(12, '0')}`,

        batch_id: batchId,

        usn:
          `MCA2025${String(i).padStart(3, '0')}`,

        student_name:
          `${firstName} ${lastName}`,

        email:
          `student${i}@example.com`,

        status: 'active',

        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await queryInterface.bulkInsert(
      'students',
      students
    );

    // ============================================================
    // 7. RESULTS + SUBJECT RESULTS
    // ============================================================

    const results = [];
    const subjectResults = [];

    for (let studentId = 1; studentId <= 76; studentId++) {

      // ----------------------------------------------------------
      // IMPORTANT
      //
      // Student 1 is the real student from the uploaded
      // marks card.
      //
      // Do NOT create a result for this student here.
      //
      // The upload/extraction module will create the result
      // after admin confirmation.
      // ----------------------------------------------------------

      if (studentId === 1) {
        continue;
      }

      // ----------------------------------------------------------
      // Generate marks for 6 subjects
      // ----------------------------------------------------------

      const marks = [];

      for (let i = 0; i < 6; i++) {

        marks.push(
          randomInt(35, 98)
        );
      }

      // ----------------------------------------------------------
      // Generate grades
      // ----------------------------------------------------------

      const grades =
        marks.map(mark => getGrade(mark));

      // ----------------------------------------------------------
      // Count failed subjects
      // ----------------------------------------------------------

      const failedSubjectCount =
        marks.filter(mark => mark < 40).length;

      // ----------------------------------------------------------
      // Overall result status
      // ----------------------------------------------------------

      const resultStatus =
        failedSubjectCount === 0
          ? 'pass'
          : 'fail';

      // ----------------------------------------------------------
      // Calculate SGPA
      //
      // TEMPORARY DEMO CALCULATION
      //
      // Official credits should be added later.
      // ----------------------------------------------------------

      let totalGradePoints = 0;
      let totalCredits = 0;

      for (let i = 0; i < 6; i++) {

        // Temporary 4-credit assumption
        totalGradePoints +=
          grades[i].point * 4;

        totalCredits += 4;
      }

      const sgpa =
        totalGradePoints / totalCredits;

      const roundedSGPA =
        Number(sgpa.toFixed(2));

      // ----------------------------------------------------------
      // Result ID
      // ----------------------------------------------------------

      const resultId = studentId;

      // ----------------------------------------------------------
      // Insert Result
      // ----------------------------------------------------------

      results.push({

        result_id: resultId,

        result_uuid:
          `88888888-8888-8888-8888-${String(studentId).padStart(12, '0')}`,

        student_id: studentId,

        session_id: sessionId,

        sgpa: roundedSGPA,

        cgpa: roundedSGPA,

        result_status:
          resultStatus,

        failed_subject_count:
          failedSubjectCount,

        created_at: new Date(),

        updated_at: new Date()
      });

      // ----------------------------------------------------------
      // Insert 6 Subject Results
      // ----------------------------------------------------------

      for (let i = 0; i < 6; i++) {

        subjectResults.push({

          result_id: resultId,

          subject_id: i + 1,

          marks: marks[i],

          grade:
            grades[i].grade,

          result_status:
            marks[i] >= 40
              ? 'pass'
              : 'fail',

          created_at: new Date(),

          updated_at: new Date()
        });
      }
    }

    // ============================================================
    // INSERT RESULTS
    // ============================================================

    await queryInterface.bulkInsert(
      'results',
      results
    );

    // ============================================================
    // INSERT SUBJECT RESULTS
    // ============================================================

    await queryInterface.bulkInsert(
      'subject_results',
      subjectResults
    );
  },

  // ============================================================
  // DOWN
  // ============================================================

  down: async (queryInterface, Sequelize) => {

    await queryInterface.bulkDelete(
      'subject_results',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'results',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'students',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'subjects',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'result_sessions',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'faculty',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'batches',
      null,
      {}
    );

    await queryInterface.bulkDelete(
      'departments',
      null,
      {}
    );
  }
};
