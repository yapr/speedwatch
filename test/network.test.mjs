import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolvePublic, requestResource } from '../src/browser.mjs';
test('mixed public/private DNS answers are rejected',async()=>{
  await assert.rejects(()=>resolvePublic('example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/NETWORK_BLOCKED/);
});
test('transport is pinned to validated DNS for both Node lookup modes',async()=>{
  const address={address:'8.8.8.8',family:4};let calls=0;
  const result=await requestResource('https://example.com/file',['example.com'],{
    resolve:async()=>address,
    get:(url,options,callback)=>{
      calls++;assert.equal(url.hostname,'example.com');
      options.lookup('example.com',{all:true},(err,values)=>{assert.equal(err,null);assert.deepEqual(values,[address]);});
      options.lookup('example.com',{},(err,ip,family)=>{assert.equal(ip,address.address);assert.equal(family,4);});
      const req=new EventEmitter();req.setTimeout=()=>{};
      queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'text/plain','set-cookie':'secret'};callback(res);res.emit('data',Buffer.from('ok'));res.emit('end');});return req;
    }
  });assert.equal(result.body.toString(),'ok');assert.equal(result.headers['set-cookie'],undefined);assert.equal(calls,1);
});
test('unapproved redirect/resource host cannot reach transport',async()=>{
  let called=false;
  await assert.rejects(()=>requestResource('https://internal.example/',['example.com'],{resolve:async()=>{called=true;}}),/NETWORK_BLOCKED/);assert.equal(called,false);
});

import { CaptureBudget } from '../src/budget.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function transport() {
  const requests=[];
  return {requests,get:(_url,_options,callback)=>{
    const req=new EventEmitter(),res=new EventEmitter();
    req.destroyed=false;req.setTimeout=()=>{};
    req.destroy=error=>{req.destroyed=true;queueMicrotask(()=>req.emit('error',error));};
    res.statusCode=200;res.headers={};req.response=res;requests.push(req);
    queueMicrotask(()=>callback(res));return req;
  }};
}
function fetchWith(budget,t,resolve=async()=>({address:'8.8.8.8',family:4})) {
  return requestResource('https://example.com/',['example.com'],{budget,get:t.get,resolve});
}
test('aggregate streamed bytes abort all active requests and reject queued/future requests',async()=>{
  const budget=new CaptureBudget(10,2),t=transport();
  const results=Promise.allSettled([fetchWith(budget,t),fetchWith(budget,t),fetchWith(budget,t)]);
  await tick();assert.equal(t.requests.length,2);
  t.requests[0].response.emit('data',Buffer.alloc(6));
  t.requests[1].response.emit('data',Buffer.alloc(5));
  assert.equal(budget.received,11); // Threshold-crossing chunk already arrived.
  assert.ok(t.requests.every(r=>r.destroyed));
  assert.deepEqual((await results).map(r=>r.reason.message),Array(3).fill('NETWORK_BUDGET'));
  // Simulate events already queued by the transport: none are retained/fulfilled.
  t.requests[0].response.emit('data',Buffer.alloc(20));t.requests[0].response.emit('end');
  await assert.rejects(()=>fetchWith(budget,t),/NETWORK_BUDGET/);
  assert.equal(t.requests.length,2);assert.equal(budget.active,0);
});
test('abort during DNS prevents a late transport connection',async()=>{
  const budget=new CaptureBudget(10),t=transport();let finishDNS;
  const result=fetchWith(budget,t,()=>new Promise(resolve=>{finishDNS=resolve;}));
  const checked=assert.rejects(result,/NETWORK_BUDGET/);
  await tick();budget.stop();finishDNS({address:'8.8.8.8',family:4});await checked;
  assert.equal(t.requests.length,0);assert.equal(budget.active,0);
});
test('failed partial responses still consume the shared budget',async()=>{
  const budget=new CaptureBudget(10),t=transport();
  const first=fetchWith(budget,t),check=assert.rejects(first,/broken/);
  await tick();t.requests[0].response.emit('data',Buffer.alloc(6));t.requests[0].response.emit('error',new Error('broken'));await check;
  const second=fetchWith(budget,t),checkSecond=assert.rejects(second,/NETWORK_BUDGET/);
  await tick();t.requests[1].response.emit('data',Buffer.alloc(4));await checkSecond;
  assert.equal(budget.received,10);
});
test('completed requests release slots while all bytes accumulate',async()=>{
  const budget=new CaptureBudget(10,1),t=transport();
  const first=fetchWith(budget,t),second=fetchWith(budget,t);
  await tick();assert.equal(t.requests.length,1);
  t.requests[0].response.emit('data',Buffer.alloc(3));t.requests[0].response.emit('end');await first;
  await tick();assert.equal(t.requests.length,2);
  t.requests[1].response.emit('data',Buffer.alloc(4));t.requests[1].response.emit('end');await second;
  assert.equal(budget.received,7);assert.equal(budget.active,0);assert.equal(budget.signal.aborted,false);
});
