'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {options,guard}=require('./academic/safety');
function summary(result,backup) {
  console.log('\nDEMO ACADEMIC DATA READY\n');
  console.log('Batches: MCA 2025; MCA 2026; TEST UNVERIFIED MCA (isolated)');
  console.log(JSON.stringify(result.counts,null,2));
  console.log('Logical dataset SHA-256:',result.digest);
  if(backup)console.log('Pre-reset academic backup:',backup);
  console.log('1MV25MC061 - RAVI RAUSHAN KUMAR: strong three-semester history / CGPA 10.00');
  console.log('1MV25MC052 - PRAFUL KRISHNAPPA VAJJARAMATTI: Semester 1 F/P cross-session backlog clearance');
  console.log('1MV25MC074 - SINDHUKUMAR S: Semester 1 Original F/-; Effective P/- after approved revaluation');
  console.log('Scenario manifest: seed/README.md');
  console.log('Development login: demo_admin / DemoAdmin2026!; faculty login is created only if the existing role column supports it.');
}
async function main(args=process.argv.slice(2)) {
  const config=options(args);
  if(config.help){console.log('NODE_ENV=development node seed/seed_demo.js --reset --confirm-db <DB_NAME>\nReplace ALL local development academic data, retain the 3 required identity rows, back up first.\nUse --verify instead of --reset for read-only verification.');return;}
  require('dotenv').config({path:path.resolve(__dirname,'../config/.env')});
  guard(process.env,config);
  const {BACKUP_TABLES,reset,persist}=require('./academic/persist');
  const {verify,verifyReports}=require('./academic/verify');
  const db=require('../database/models');let backup;
  try{
    await db.sequelize.authenticate();
    if(config.reset){
      console.log(`EXPLICIT DEVELOPMENT RESET: ${process.env.DB_NAME}. Existing academic results, revaluation/staging, offerings and other student identities will be replaced. Required identity rows, accounts and configuration are retained.`);
      await db.sequelize.transaction({isolationLevel:require('sequelize').Transaction.ISOLATION_LEVELS.SERIALIZABLE},async transaction=>{
        const contents={database:process.env.DB_NAME,capturedAt:new Date().toISOString(),tables:{}};
        for(const table of BACKUP_TABLES){const [rows]=await db.sequelize.query(`SELECT * FROM ${table}`,{transaction});contents.tables[table]=rows;}
        backup=path.join(os.tmpdir(),`sraas-demo-backup-${require('node:crypto').randomUUID()}.json`);
        await fs.writeFile(backup,JSON.stringify(contents,null,2),{flag:'wx',mode:0o600});
        console.log('Backup created before deletion:',backup);
        await reset(db,transaction);await persist(db,transaction);const verified=await verify(db,transaction);
        console.log('Pre-commit integrity verification passed:',verified.digest);
      });
    }
    const result=await verify(db);console.log(await verifyReports(db));summary(result,backup);
    return {counts:result.counts,digest:result.digest,backup};
  }finally{await db.sequelize.close();}
}
if(require.main===module)main().catch(error=>{console.error('DEMO SEED FAILED:',error.message,error.original?.message||'',error.stack||'');process.exitCode=1;});
module.exports={main};
