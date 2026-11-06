import test from 'node:test';
import assert from 'node:assert/strict';
import {chart} from '../src/report.mjs';
import {median} from '../src/core.mjs';
const row=(date,value=90)=>({day:date,psi:{status:'ok',scores:{performance:value},lab:{lcp:1000}}});
const count=(svg,tag)=>(svg.match(new RegExp(`<${tag} `,'g'))??[]).length;
test('missing calendar day leaves a gap instead of joining observations',()=>{
  const rows=[row('2026-01-01'),row('2026-01-03'),row('2026-01-04')];
  for(const metric of ['performance','lcp']){
    const svg=chart(rows,metric,'2026-01-05');assert.equal(count(svg,'circle'),3);assert.equal(count(svg,'line'),1);
    const x=[...svg.matchAll(/<circle cx="([^"]+)"/g)].map(m=>Number(m[1]));
    assert.ok(Math.abs((x[1]-x[0])-2*(x[2]-x[1]))<1e-9);
    assert.ok(svg.includes('2026-01-05')); // Trailing missing days remain on the axis.
  }
});
test('failure rows and days outside the 30-day window do not form lines',()=>{
  const svg=chart([row('2025-12-01'),row('2026-01-01'),{day:'2026-01-02',psi:{status:'error'}},row('2026-01-03')],'performance','2026-01-03');
  assert.equal(count(svg,'circle'),2);assert.equal(count(svg,'line'),0);
  const empty=chart([],'performance','2026-01-03');assert.equal(count(empty,'circle'),0);assert.equal(count(empty,'line'),0);
});
test('median handles empty, odd, even and zero-valued sets without mutation',()=>{
  const values=[100,0,80,20];assert.equal(median(values),50);assert.deepEqual(values,[100,0,80,20]);
  assert.equal(median([]),null);assert.equal(median([0]),0);assert.equal(median([30,10,20]),20);
});
