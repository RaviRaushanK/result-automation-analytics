'use strict';
function options(args) {
  const out={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(['--reset','--verify','--help'].includes(key)) out[key.slice(2)]=true;
    else if(key==='--confirm-db' && args[i+1] && !args[i+1].startsWith('--')) out.database=args[++i];
    else throw new Error(`Unknown or incomplete seed argument: ${key}`);
  }
  return out;
}
function guard(env, config) {
  if(!['development','test'].includes(String(env.NODE_ENV||'').trim().toLowerCase())) throw new Error('Demo seed requires NODE_ENV=development or test; production and unspecified environments are refused.');
  if(/prod|production|live/i.test(`${env.APP_ENV||''} ${env.DB_NAME||''}`)) throw new Error('Production-like database/environment refused.');
  if(!['localhost','127.0.0.1','::1'].includes(String(env.DB_HOST||'localhost').toLowerCase())) throw new Error('Demo seeding is restricted to a local MySQL server.');
  if(!env.DB_NAME || config.database!==env.DB_NAME) throw new Error('Explicit --confirm-db must exactly match DB_NAME.');
  if(!config.reset && !config.verify) throw new Error('Use --reset to explicitly replace DEVELOPMENT academic data, or --verify for read-only checks.');
  if(config.reset && config.verify) throw new Error('Choose either --reset or --verify.');
}
module.exports={options,guard};
