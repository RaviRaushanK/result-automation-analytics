'use strict';
console.error('Standalone academic cleanup is retired. Use the backed-up, transactional demo reset: NODE_ENV=development node seed/seed_demo.js --reset --confirm-db <DB_NAME>.');
process.exitCode=1;
