const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../config/.env") });

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  await c.query(`
    ALTER TABLE admin_users ADD COLUMN mobile VARCHAR(20) NULL AFTER email;

    CREATE TABLE IF NOT EXISTS admin_otps (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_id BIGINT NOT NULL,
      otp_hash VARCHAR(255) NOT NULL,
      type ENUM('password_reset','email_change','mobile_change') NOT NULL,
      target_value VARCHAR(255) NULL,
      expires_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 5,
      is_used TINYINT(1) NOT NULL DEFAULT 0,
      resend_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admin_users(admin_id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  console.log("Schema updated: mobile column + admin_otps table");
  await c.end();
}

main().catch((err) => {
  console.error("Schema update failed:", err);
  process.exit(1);
});
