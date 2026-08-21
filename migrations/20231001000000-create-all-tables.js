'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {

    // -------------------------------------------------
    // 1. departments
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS departments (
        department_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        department_uuid CHAR(36) NOT NULL UNIQUE,
        department_code VARCHAR(20) NOT NULL UNIQUE,
        department_name VARCHAR(100) NOT NULL,
        description TEXT,
        status ENUM('active','inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 2. admin_users
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        admin_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        admin_uuid CHAR(36) NOT NULL UNIQUE,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin') DEFAULT 'admin',
        status ENUM('active','inactive') DEFAULT 'active',
        last_login TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 3. activity_logs
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        admin_id BIGINT NOT NULL,
        activity VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES admin_users(admin_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 4. batches
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS batches (
        batch_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        batch_uuid CHAR(36) NOT NULL UNIQUE,
        department_id BIGINT NOT NULL,
        batch_name VARCHAR(100) NOT NULL,
        start_year INT NOT NULL,
        end_year INT NOT NULL,
        status ENUM('active','inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 5. faculty
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS faculty (
        faculty_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        faculty_uuid CHAR(36) NOT NULL UNIQUE,
        department_id BIGINT NOT NULL,
        faculty_code VARCHAR(20) NOT NULL UNIQUE,
        faculty_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE,
        designation VARCHAR(100),
        status ENUM('active','inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 6. result_sessions
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS result_sessions (
        session_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_uuid CHAR(36) NOT NULL UNIQUE,
        batch_id BIGINT NOT NULL,
        semester VARCHAR(20) NOT NULL,
        exam_session VARCHAR(20) NOT NULL,
        exam_year INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES batches(batch_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 7. subjects
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        subject_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        subject_uuid CHAR(36) NOT NULL UNIQUE,
        session_id BIGINT NOT NULL,
        subject_code VARCHAR(20) NOT NULL UNIQUE,
        subject_name VARCHAR(100) NOT NULL,
        subject_type ENUM('theory','lab','project') NOT NULL,
        credits INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES result_sessions(session_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 8. subject_faculty
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS subject_faculty (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        subject_id BIGINT NOT NULL,
        faculty_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_subject_faculty (subject_id, faculty_id),
        FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (faculty_id) REFERENCES faculty(faculty_id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 9. students
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS students (
        student_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        student_uuid CHAR(36) NOT NULL UNIQUE,
        batch_id BIGINT NOT NULL,
        usn VARCHAR(50) NOT NULL UNIQUE,
        student_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE,
        status ENUM('active','inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL,
        FOREIGN KEY (batch_id) REFERENCES batches(batch_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 10. results
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS results (
        result_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        result_uuid CHAR(36) NOT NULL UNIQUE,
        student_id BIGINT NOT NULL,
        session_id BIGINT NOT NULL,
        sgpa DECIMAL(3,2) NOT NULL,
        cgpa DECIMAL(3,2) NOT NULL,
        result_status ENUM('pass','fail') NOT NULL,
        failed_subject_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        FOREIGN KEY (session_id) REFERENCES result_sessions(session_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 11. subject_results
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS subject_results (
        subject_result_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        result_id BIGINT NOT NULL,
        subject_id BIGINT NOT NULL,
        marks INT NOT NULL,
        grade VARCHAR(5),
        result_status ENUM('pass','fail') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_result_subject (result_id, subject_id),
        FOREIGN KEY (result_id) REFERENCES results(result_id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 12. revaluation_results
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS revaluation_results (
        revaluation_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        subject_result_id BIGINT NOT NULL,
        original_marks INT NOT NULL,
        revised_marks INT NOT NULL,
        original_status ENUM('pass','fail') NOT NULL,
        revised_status ENUM('pass','fail') NOT NULL,
        revaluation_status ENUM('pending','approved','rejected') DEFAULT 'pending',
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subject_result_id) REFERENCES subject_results(subject_result_id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 13. import_logs
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS import_logs (
        import_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id BIGINT NOT NULL,
        uploaded_by BIGINT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_type ENUM('pdf','jpg','jpeg','png') NOT NULL,
        total_records INT DEFAULT 0,
        imported_records INT DEFAULT 0,
        skipped_records INT DEFAULT 0,
        status ENUM('success','failed') DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES result_sessions(session_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES admin_users(admin_id) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 14. ocr_extractions
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ocr_extractions (
        extraction_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        import_id BIGINT NOT NULL,
        raw_text TEXT,
        extracted_json JSON,
        confidence_score DECIMAL(5,2) DEFAULT 0.00,
        validation_status ENUM('pending','validated','rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (import_id) REFERENCES import_logs(import_id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // 15. system_settings
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) NOT NULL UNIQUE,
        setting_value VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // -------------------------------------------------
    // Indexes – one query per index
    // -------------------------------------------------
    await queryInterface.sequelize.query(`CREATE INDEX idx_department_code ON departments(department_code);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_batch_department ON batches(department_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_faculty_department ON faculty(department_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_session_batch ON result_sessions(batch_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_subject_session ON subjects(session_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_student_batch ON students(batch_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_result_student ON results(student_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_result_session ON results(session_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_subject_result_result ON subject_results(result_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_revaluation_subject_result ON revaluation_results(subject_result_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_import_session ON import_logs(session_id);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_import_uploader ON import_logs(uploaded_by);`);
    await queryInterface.sequelize.query(`CREATE INDEX idx_ocr_import ON ocr_extractions(import_id);`);

    // -------------------------------------------------
    // View
    // -------------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE VIEW effective_student_results AS
      SELECT
        rr.result_id,
        rr.student_id,
        rr.session_id,
        srs.subject_id,
        COALESCE(rr_rev.revised_marks, srs.marks) AS effective_marks,
        srs.grade AS effective_grade,
        rr.result_status,
        rr.cgpa,
        rr.sgpa,
        rr.failed_subject_count,
        rr.created_at
      FROM results rr
      JOIN subject_results srs ON rr.result_id = srs.result_id
      LEFT JOIN revaluation_results rr_rev ON srs.subject_result_id = rr_rev.subject_result_id;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query('DROP VIEW IF EXISTS effective_student_results;');
    await queryInterface.dropAllTables();
  }
};