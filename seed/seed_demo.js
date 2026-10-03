'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Transaction } = require('sequelize');

const {
  options,
  guard
} = require('./academic/safety');

function summary(result, backup) {
  console.log(
    '\nDEMO ACADEMIC DATA READY\n'
  );

  console.log(
    'Batches: MCA 2025; MCA 2026; ' +
    'TEST UNVERIFIED MCA (isolated)'
  );

  console.log(
    JSON.stringify(
      result.counts,
      null,
      2
    )
  );

  console.log(
    'Logical dataset SHA-256:',
    result.digest
  );

  if (backup) {
    console.log(
      'Pre-reset academic backup:',
      backup
    );
  }

  console.log(
    '\nREAL STUDENTS — MCA 2025 — IDENTITY ONLY'
  );

  console.log(
    '1MV25MC061 - RAVI RAUSHAN KUMAR'
  );

  console.log(
    '1MV25MC052 - PRAFUL KRISHNAPPA VAJJARAMATTI'
  );

  console.log(
    '1MV25MC074 - SINDHUKUMAR S'
  );

  console.log(
    'No demo results, marks, SGPA, CGPA, ' +
    'backlogs or revaluations are generated ' +
    'for the real students.'
  );

  console.log(
    '\nDemo academic scenarios are attached ' +
    'only to demo students.'
  );

  console.log(
    'Scenario manifest: seed/README.md'
  );

  console.log(
    'Development login: demo_admin / ' +
    'DemoAdmin2026!; faculty login is ' +
    'created only if the existing role ' +
    'column supports it.'
  );
}

async function main(
  args = process.argv.slice(2)
) {
  const config =
    options(args);

  if (config.help) {
    console.log(
      'NODE_ENV=development ' +
      'node seed/seed_demo.js ' +
      '--reset --confirm-db <DB_NAME>\n\n' +

      'Reset local development academic demo data.\n' +
      'The 3 required real students remain in ' +
      'MCA 2025 as identity/profile rows only.\n' +
      'No demo academic results are generated for them.\n' +
      'A backup is created before reset.\n\n' +

      'Use --verify instead of --reset ' +
      'for read-only verification.'
    );

    return;
  }

  require('dotenv').config({
    path: path.resolve(
      __dirname,
      '../config/.env'
    )
  });

  guard(
    process.env,
    config
  );

  const {
    BACKUP_TABLES,
    reset,
    persist
  } = require(
    './academic/persist'
  );

  const {
    verify,
    verifyReports
  } = require(
    './academic/verify'
  );

  const db =
    require('../database/models');

  let backup;

  try {
    await db.sequelize.authenticate();

    if (config.reset) {
      console.log(
        `EXPLICIT DEVELOPMENT RESET: ` +
        `${process.env.DB_NAME}.`
      );

      console.log(
        'Existing demo academic data will be replaced.'
      );

      console.log(
        'The 3 required real student identities ' +
        'will remain assigned to MCA 2025, with ' +
        'no seeded academic results.'
      );

      await db.sequelize.transaction(
        {
          isolationLevel:
            Transaction
              .ISOLATION_LEVELS
              .SERIALIZABLE
        },

        async transaction => {
          const contents = {
            database:
              process.env.DB_NAME,

            capturedAt:
              new Date()
                .toISOString(),

            tables: {}
          };

          for (
            const table of
            BACKUP_TABLES
          ) {
            const [rows] =
              await db.sequelize.query(
                `SELECT * FROM ${table}`,
                { transaction }
              );

            contents.tables[table] =
              rows;
          }

          backup = path.join(
            os.tmpdir(),

            `sraas-demo-backup-` +
            `${randomUUID()}.json`
          );

          await fs.writeFile(
            backup,

            JSON.stringify(
              contents,
              null,
              2
            ),

            {
              flag: 'wx',
              mode: 0o600
            }
          );

          console.log(
            'Backup created before deletion:',
            backup
          );

          await reset(
            db,
            transaction
          );

          await persist(
            db,
            transaction
          );

          const verified =
            await verify(
              db,
              transaction
            );

          console.log(
            'Pre-commit integrity verification passed:',
            verified.digest
          );
        }
      );
    }

    const result =
      await verify(db);

    console.log(
      await verifyReports(db)
    );

    summary(
      result,
      backup
    );

    return {
      counts:
        result.counts,

      digest:
        result.digest,

      backup
    };
  } finally {
    await db.sequelize.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      'DEMO SEED FAILED:',
      error.message,
      error.original?.message || '',
      error.stack || ''
    );

    process.exitCode = 1;
  });
}

module.exports = {
  main
};