import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicIP,safeURL,normalize,validate,day,degraded } from '../src/core.mjs';
import { LocalStore } from '../src/storage.mjs';
import { collect } from '../src/collect.mjs';
import { buildReport } from '../src/report.mjs';
const site={id:'demo',name:'<script>bad</script>',url:'https://example.com/',enabled:true,public:true,screenshotsPublic:false,hosts:['example.com']};
const config={sites:[site],maxStorageBytes:10000000};
const now=new Date('2026-01-01T16:00:00Z');
const good={scores:{performance:90},lab:{lcp:1000,cls:0,fcp:500,tbt:0},field:null};
async function local(){return new LocalStore(await mkdtemp(join(tmpdir(),'speedwatch-test-')));}
test('blocks local, metadata, reserved and mapped addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.0.1','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1','192.0.2.1','ff02::1'])assert.equal(publicIP(ip),false,ip);
  assert.equal(publicIP('8.8.8.8'),true);
});
test('only approved credential-free https URLs and bounded config',()=>{
  for(const url of ['http://example.com/','https://user:pass@example.com/','https://example.com:444/','https://example.com/?token=x','https://example.com/#secret','https://evil.com/'])assert.throws(()=>safeURL(url,site.hosts));
  assert.equal(validate(config),config);assert.throws(()=>validate({...config,sites:[site,site]}));assert.throws(()=>validate({...config,maxStorageBytes:Infinity}));
});
test('JST day boundary',()=>assert.equal(day(now),'2026-01-02'));
test('missing values remain null and runtime errors are failures',()=>{
  const r=normalize({lighthouseResult:{categories:{performance:{score:0}},audits:{}}});assert.equal(r.scores.performance,0);assert.equal(r.lab.lcp,null);assert.equal(r.field,null);
  assert.throws(()=>normalize({lighthouseResult:{runtimeError:{code:'NO_FCP'}}}));
});
test('decline requires three consecutive successful low observations',()=>{
  const rows=[95,94,96,80,82,81].map((v,i)=>({day:`2026-01-0${i+1}`,psi:{status:'ok',scores:{performance:v}}}));
  assert.equal(degraded(rows),true);rows[5].psi={status:'error'};assert.equal(degraded(rows),false);
});
test('partial failures saved independently; same day rerun never overwrites',async()=>{
  const store=await local();let calls=0;
  const options={now,measure:async()=>{throw new Error('secret token');},capture:async()=>{calls++;return Buffer.from('image');}};
  assert.equal((await collect(config,store,options)).failures,2);
  const row=JSON.parse(await store.get('records/demo/2026-01-02/mobile.json'));assert.equal(row.psi.code,'FAILED');assert.equal(row.screenshot.status,'ok');
  assert.equal((await collect(config,store,options)).skipped,2);assert.equal(calls,2);
  await assert.rejects(()=>store.put('records/demo/2026-01-02/mobile.json',Buffer.from('{}')));
});
test('capacity stops before any network work',async()=>{
  const store={list:async()=>[{size:9000000,key:'existing'}]};let called=false;
  await assert.rejects(()=>collect(config,store,{now,measure:async()=>{called=true;}}),/STORAGE_BUDGET_STOP/);assert.equal(called,false);
});
test('public report excludes private sites and unapproved images, escapes content',async()=>{
  const store=await local();const cfg={...config,sites:[site,{...site,id:'private',public:false}]};
  await collect(cfg,store,{now,measure:async()=>good,capture:async()=>Buffer.from('image')});
  const dir=await mkdtemp(join(tmpdir(),'speedwatch-report-'));
  const r=await buildReport(cfg,store,dir,{publicOnly:true,now});
  assert.equal(r.groups.length,2);assert.equal(r.storage,undefined);assert.equal(r.groups[0].latest.screenshot.image,undefined);
  const html=await readFile(`${dir}/index.html`,'utf8');assert.ok(!html.includes('<script>bad'));assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!(await readFile(`${dir}/report.json`,'utf8')).includes('"siteId": "private"'));
});
test('report refuses a previously populated destination',async()=>{
  const store=await local(),dir=await mkdtemp(join(tmpdir(),'speedwatch-output-'));
  await buildReport(config,store,dir,{publicOnly:false,now});
  await assert.rejects(()=>buildReport(config,store,dir,{publicOnly:true,now}),/OUTPUT_MUST_BE_EMPTY/);
});
test('weekly report counts missing observations and computes median',async()=>{
  const store=await local();await collect(config,store,{now,measure:async()=>good,capture:async()=>Buffer.from('image')});
  const dir=await mkdtemp(join(tmpdir(),'speedwatch-weekly-'));await buildReport(config,store,dir,{now});
  const week=JSON.parse(await readFile(`${dir}/weekly.json`));assert.equal(week.groups[0].successful,1);assert.equal(week.groups[0].expected,7);assert.equal(week.groups[0].medianPerformance,90);
});
test('weekly median averages the two central values for even sample counts',async()=>{
  const store=await local();
  await collect(config,store,{now:new Date('2026-01-01T01:00:00Z'),measure:async()=>({...good,scores:{performance:80}}),capture:async()=>Buffer.from('image')});
  await collect(config,store,{now:new Date('2026-01-02T01:00:00Z'),measure:async()=>({...good,scores:{performance:91}}),capture:async()=>Buffer.from('image')});
  const dir=await mkdtemp(join(tmpdir(),'speedwatch-median-'));await buildReport(config,store,dir,{now});
  const week=JSON.parse(await readFile(`${dir}/weekly.json`));assert.equal(week.groups[0].medianPerformance,85.5);
});
test('browser mode makes no PSI calls and reports local metrics without a score',async()=>{
  const store=await local();let apiCalls=0;
  const localResult={status:'ok',source:'browser-local',profile:'unthrottled-allowlisted',lab:{lcp:123,fcp:100,cls:0,load:456,tbt:null}};
  await collect(config,store,{now,mode:'browser',measure:async()=>{apiCalls++;throw new Error('unexpected API');},capture:async()=>({image:Buffer.from('image'),local:localResult})});
  assert.equal(apiCalls,0);
  const dir=await mkdtemp(join(tmpdir(),'speedwatch-local-'));
  const report=await buildReport(config,store,dir,{now,publicOnly:true});
  assert.equal(report.groups[0].latest.psi.status,'not_requested');assert.equal(report.groups[0].latest.psi.scores,undefined);
  assert.equal(report.groups[0].latest.local.lab.lcp,123);
  const weekly=JSON.parse(await readFile(`${dir}/weekly.json`));assert.equal(weekly.groups[0].medianPerformance,null);assert.equal(weekly.groups[0].localMedianLcp,123);
});
