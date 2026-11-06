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
