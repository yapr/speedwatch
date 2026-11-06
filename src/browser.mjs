import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { chromium } from 'playwright';
import { publicIP } from './core.mjs';
import { CaptureBudget } from './budget.mjs';
export async function resolvePublic(host, resolver=lookup) {
  const addresses = await resolver(host,{all:true});
  if (!addresses.length || addresses.some(a=>!publicIP(a.address))) throw new Error('NETWORK_BLOCKED');
  return addresses[0];
}
// Every request is re-resolved, checked, and pinned to the checked address.
export async function requestResource(url, hosts, {resolve=resolvePublic, get=https.get, budget=new CaptureBudget()}={}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !hosts.includes(u.hostname)) throw new Error('NETWORK_BLOCKED');
  await budget.acquire();
  try {
    budget.check();
    const address = await resolve(u.hostname);
    budget.check(); // DNS may finish after another response exhausts the budget.
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,result)=>{
        if(settled)return;
        settled=true;
        budget.signal.removeEventListener('abort',abort);
        if(error)reject(error);else resolve(result);
      };
      const abort=()=>{req.destroy(budget.signal.reason);finish(budget.signal.reason);};
      const req = get(u,{lookup:(_h,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,address.family),headers:{'user-agent':'SpeedWatch/0.1'}},res=>{
        const chunks=[]; let bytes=0;
        res.on('data',chunk=>{
          if(settled)return;
          try {
            budget.consume(chunk.length); // Count before retaining or fulfilling anything.
            bytes+=chunk.length;
            if(bytes>8000000)throw new Error('RESOURCE_LIMIT');
            chunks.push(chunk);
          } catch(error) {req.destroy(error);finish(error);}
        });
        res.on('end',()=>finish(null,{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).filter(([k,v])=>v && !['set-cookie','transfer-encoding','content-length'].includes(k)).map(([k,v])=>[k,String(v)])),body:Buffer.concat(chunks)}));
        res.on('error',error=>{req.destroy(error);finish(error);});
        res.on('aborted',()=>finish(new Error('NETWORK_ABORTED')));
      });
      req.setTimeout(15000,()=>{const error=new Error('NETWORK_TIMEOUT');req.destroy(error);finish(error);});
      req.on('error',error=>finish(error));
      budget.signal.addEventListener('abort',abort,{once:true});
      if(budget.signal.aborted)abort();
    });
  } finally { budget.release(); }
}
export async function screenshot(site, device) {
  const budget = new CaptureBudget();
  const browser = await chromium.launch();
  try {
    const context=await browser.newContext({viewport:device==='mobile'?{width:390,height:844}:{width:1440,height:1000},isMobile:device==='mobile',deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false});
    let count=0;
    await context.routeWebSocket('**/*',ws=>ws.close());
    await context.route('**/*',async route=>{
      try {
        if (++count>160 || route.request().method() !== 'GET') return await route.abort();
        const result=await requestResource(route.request().url(),site.hosts,{budget});
        budget.check();
        await route.fulfill(result);
      } catch { await route.abort().catch(()=>{}); }
    });
    const page=await context.newPage(); page.setDefaultTimeout(15000);
    const response=await page.goto(site.url,{waitUntil:'load',timeout:45000});
    if (!response || response.status()>=400) throw new Error('CAPTURE_HTTP');
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))])); await page.waitForTimeout(1000);
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);
    if(height>16000) throw new Error('CAPTURE_HEIGHT');
    budget.check();
    const image=await page.screenshot({type:'jpeg',quality:75,fullPage:true,animations:'disabled',timeout:15000});
    budget.check();
    if(image.length>3000000) throw new Error('CAPTURE_SIZE');
    return image;
  } catch(error) {
    if(budget.signal.aborted)throw budget.signal.reason;
    throw error;
  } finally { budget.stop(new Error('NETWORK_CLOSED')); await browser.close(); }
}
