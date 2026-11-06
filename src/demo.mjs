import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from './storage.mjs';
import { buildReport } from './report.mjs';
const store=new LocalStore(await mkdtemp(join(tmpdir(),'speedwatch-demo-')));
for(let n=1;n<=12;n++)for(const device of ['desktop','mobile']) {
  const date=`2026-01-${String(n).padStart(2,'0')}`;
  const row={siteId:'demo',url:'https://example.com/',device,day:date,measuredAt:`${date}T00:00:00Z`,psi:n===6?{status:'error'}:{status:'ok',scores:{performance:(device==='mobile'?70:87)+n%5,accessibility:98,'best-practices':100,seo:100},lab:{lcp:device==='mobile'?2800-n*35:1500-n*20,cls:.02,fcp:800,tbt:120},field:null},screenshot:{status:'error'}};
  await store.put(`records/demo/${date}/${device}.json`,Buffer.from(JSON.stringify(row)));
}
await mkdir('output',{recursive:true});
const dir=process.env.OUTPUT_DIR??await mkdtemp('output/demo-');
await buildReport({sites:[{id:'demo',name:'DEMO — 架空のデータ',url:'https://example.com/',enabled:true,public:true,screenshotsPublic:false}],maxStorageBytes:1e9},store,dir,{publicOnly:true,now:new Date('2026-01-12T01:00:00Z')});
console.log(`Demo: ${dir}/index.html (synthetic data, not production measurements)`);
