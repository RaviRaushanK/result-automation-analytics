'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {

    // ----------------------------
    // 1. Departments
    // ----------------------------
    const departmentId = 1;
    const batchId = 1;
    const facultyId = 1;
    const sessionId = 1;
    const studentId = 1;
    const resultId = 1;

    // Clear existing data to avoid duplicate key errors
    try {
      // Disable foreign key checks temporarily
      await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
      
      await queryInterface.bulkDelete('subject_results', null, {});
      await queryInterface.bulkDelete('results', null, {});
      await queryInterface.bulkDelete('students', null, {});
      await queryInterface.bulkDelete('subjects', null, {});
      await queryInterface.bulkDelete('result_sessions', null, {});
      await queryInterface.bulkDelete('faculty', null, {});
      await queryInterface.bulkDelete('batches', null, {});
      await queryInterface.bulkDelete('departments', null, {});
      
      // Re-enable foreign key checks
      await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (err) {
      console.log('Cleanup warning:', err.message);
      // Ensure FK checks are re-enabled even if error occurs
      try {
        await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch (e) {
        // Ignore
      }
    }

    await queryInterface.bulkInsert('departments', [
      {
        department_id: departmentId,
        department_uuid: '11111111-1111-1111-1111-111111111111',
        department_code: 'MCA',
        department_name: 'Master of Computer Applications',
        description: 'MCA Department',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 2. Batches
    // ----------------------------
    await queryInterface.bulkInsert('batches', [
      {
        batch_id: batchId,
        batch_uuid: '22222222-2222-2222-2222-222222222222',
        department_id: departmentId,
        batch_name: 'MCA 2025-2027',
        start_year: 2025,
        end_year: 2027,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 3. Faculty
    // ----------------------------
    await queryInterface.bulkInsert('faculty', [
      {
        faculty_id: facultyId,
        faculty_uuid: '33333333-3333-3333-3333-333333333333',
        department_id: departmentId,
        faculty_code: 'FAC001',
        faculty_name: 'Dr. Ananya Sharma',
        email: 'ananya.sharma@example.com',
        designation: 'Professor',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 4. Result Session
    // ----------------------------
    await queryInterface.bulkInsert('result_sessions', [
      {
        session_id: sessionId,
        session_uuid: '44444444-4444-4444-4444-444444444444',
        batch_id: batchId,
        semester: 'Semester 1',
        exam_session: 'DEC',
        exam_year: 2026,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 5. Subjects
    // ----------------------------
    await queryInterface.bulkInsert('subjects', [
      {
        subject_id: 1,
        subject_uuid: '55555555-5555-5555-5555-555555555555',
        session_id: sessionId,
        subject_code: 'MCA101',
        subject_name: 'Programming Fundamentals',
        subject_type: 'theory',
        credits: 4,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        subject_id: 2,
        subject_uuid: '66666666-6666-6666-6666-666666666666',
        session_id: sessionId,
        subject_code: 'MCA102',
        subject_name: 'Data Structures',
        subject_type: 'theory',
        credits: 4,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 6. Students
    // ----------------------------
    await queryInterface.bulkInsert('students', [
      {
        student_id: studentId,
        student_uuid: '77777777-7777-7777-7777-777777777777',
        batch_id: batchId,
        usn: 'MCA2025001',
        student_name: 'Ravi Kumar',
        email: 'ravi.kumar@example.com',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 7. Results
    // ----------------------------
    await queryInterface.bulkInsert('results', [
      {
        result_id: resultId,
        result_uuid: '88888888-8888-8888-8888-888888888888',
        student_id: studentId,
        session_id: sessionId,
        sgpa: 8.5,
        cgpa: 8.5,
        result_status: 'pass',
        failed_subject_count: 0,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // ----------------------------
    // 8. Subject Results
    // ----------------------------
    await queryInterface.bulkInsert('subject_results', [
      {
        result_id: resultId,
        subject_id: 1,
        marks: 85,
        grade: 'A',
        result_status: 'pass',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        result_id: resultId,
        subject_id: 2,
        marks: 78,
        grade: 'B',
        result_status: 'pass',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('subject_results', null, {});
    await queryInterface.bulkDelete('results', null, {});
    await queryInterface.bulkDelete('students', null, {});
    await queryInterface.bulkDelete('subjects', null, {});
    await queryInterface.bulkDelete('result_sessions', null, {});
    await queryInterface.bulkDelete('faculty', null, {});
    await queryInterface.bulkDelete('batches', null, {});
    await queryInterface.bulkDelete('departments', null, {});
  }
};