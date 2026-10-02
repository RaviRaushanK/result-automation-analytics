'use strict';
const path = require('node:path');
const { guard } = require('./academic/safety');
const DATABASE = 'academic_result_analytics_db';

function configuration(env, verify = false) {
  // Only this explicitly named demo shortcut supplies a development default.
  // Never overwrite a production environment or confirm an arbitrary database.
  const environment = { ...env, NODE_ENV: env.NODE_ENV === undefined ? 'development' : env.NODE_ENV };
  guard(environment, { database: DATABASE, reset: !verify, verify });
  return { environment, args: [verify ? '--verify' : '--reset', '--confirm-db', DATABASE] };
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(`npm run demo: back up and replace ALL academic data in local ${DATABASE}, then insert and verify the full demo dataset.\nnpm run demo:verify: read-only verification.\nProduction environments, remote hosts and other database names are refused.\nNODE_ENV defaults to development only when absent for these shortcuts.`);
    return;
  }
  if (args.length && !(args.length === 1 && args[0] === '--verify')) throw new Error('Use npm run demo or npm run demo:verify without additional arguments.');
  require('dotenv').config({ path: path.resolve(__dirname, '../config/.env') });
  const config = configuration(process.env, args[0] === '--verify');
  process.env.NODE_ENV = config.environment.NODE_ENV;
  console.log(`Explicit local demo command: ${DATABASE}; NODE_ENV=${process.env.NODE_ENV}.`);
  return require('./seed_demo').main(config.args);
}

if (require.main === module) main().catch(error => {
  console.error('DEMO COMMAND FAILED:', error.message, error.original?.message || '');
  process.exitCode = 1;
});
module.exports = { configuration, main };
