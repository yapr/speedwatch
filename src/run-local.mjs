import {mkdir,readFile,readdir,stat,rmdir} from 'node:fs/promises';
import {day,validate} from './core.mjs';
import {LocalStore} from './storage.mjs';
import {collect} from './collect.mjs';
import {buildReport} from './report.mjs';

// Local operation deliberately does not read cloud credentials or call PSI.
const root='output/live',lock=`${root}/.lock`;
async function size(dir) {
  let bytes=0;
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('OUTPUT_SYMLINK');
    const file=`${dir}/${entry.name}`;
    bytes+=entry.isDirectory()?await size(file):(await stat(file)).size;
  }
  return bytes;
}
await mkdir(root,{recursive:true});
let locked=false;
try {
  await mkdir(lock);locked=true;
  if(await size(root)>90_000_000)throw new Error('REPORT_BUDGET');
  const config=validate(JSON.parse(await readFile('config/sites.json','utf8')));
  if(config.sites.length!==1||config.sites[0].url!=='https://yapr.jp/'||config.sites[0].id!=='yapr')throw new Error('LOCAL_TARGET_REVIEW');
  const store=new LocalStore('data/live');
  const result=await collect(config,store,{mode:'browser'});
  const directory=`${root}/${day()}-${Date.now()}`;
  const report=await buildReport(config,store,`${directory}/private`);
  await buildReport(config,store,`${directory}/public`,{publicOnly:true});
  const healthy=report.groups.every(g=>!g.stale&&g.latest?.local?.status==='ok'&&g.latest?.screenshot.status==='ok');
  console.log(JSON.stringify({healthy,...result,privateReport:`${directory}/private/index.html`,publicReport:`${directory}/public/index.html`,measurements:report.groups.map(g=>({device:g.device,day:g.latest?.day,source:g.latest?.local?.source,lab:g.latest?.local?.lab}))},null,2));
  if(!healthy||result.failures)process.exitCode=1;
} catch(error) {
  console.error('Local monitor stopped. Check lock, data/output budgets, configuration and connectivity. No secrets are required.');
  process.exitCode=1;
} finally {if(locked)await rmdir(lock);}
