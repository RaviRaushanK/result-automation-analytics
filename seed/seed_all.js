'use strict';
// Preserve the old entry point with the same explicit guards as the demo CLI.
require('./seed_demo').main().catch(error=>{
  console.error('DEMO SEED FAILED:',error.stack||error.message);
  process.exitCode=1;
});
