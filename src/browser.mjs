import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { chromium } from 'playwright';
import { publicIP } from './core.mjs';
export async function resolvePublic(host, resolver=lookup) {
  const addresses = await resolver(host,{all:true});
  if (!addresses.length || addresses.some(a=>!publicIP(a.address))) throw new Error('NETWORK_BLOCKED');
  return addresses[0];
}
// Every request is re-resolved, checked, and pinned to the checked address.
export async function requestResource(url, hosts, {resolve=resolvePublic, get=https.get}={}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !hosts.includes(u.hostname)) throw new Error('NETWORK_BLOCKED');
  const address = await resolve(u.hostname);
  return new Promise((resolve,reject)=>{
    const req = get(u,{lookup:(_h,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,address.family),headers:{'user-agent':'SpeedWatch/0.1'}},res=>{
      const chunks=[]; let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length; if(bytes>8000000) req.destroy(new Error('RESOURCE_LIMIT')); else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).filter(([k,v])=>v && !['set-cookie','transfer-encoding','content-length'].includes(k)).map(([k,v])=>[k,String(v)])),body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    req.setTimeout(15000,()=>req.destroy(new Error('NETWORK_TIMEOUT'))); req.on('error',reject);
  });
}
export async function screenshot(site, device) {
  const browser = await chromium.launch();
  try {
    const context=await browser.newContext({viewport:device==='mobile'?{width:390,height:844}:{width:1440,height:1000},isMobile:device==='mobile',deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false});
    let count=0,total=0;
    await context.routeWebSocket('**/*',ws=>ws.close());
    await context.route('**/*',async route=>{
      try {
        if (++count>160 || route.request().method() !== 'GET') return await route.abort();
        const result=await requestResource(route.request().url(),site.hosts);
        total+=result.body.length; if(total>30000000) return await route.abort();
        await route.fulfill(result);
      } catch { await route.abort().catch(()=>{}); }
    });
    const page=await context.newPage(); page.setDefaultTimeout(15000);
    const response=await page.goto(site.url,{waitUntil:'load',timeout:45000});
    if (!response || response.status()>=400) throw new Error('CAPTURE_HTTP');
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))])); await page.waitForTimeout(1000);
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);
    if(height>16000) throw new Error('CAPTURE_HEIGHT');
    const image=await page.screenshot({type:'jpeg',quality:75,fullPage:true,animations:'disabled',timeout:15000});
    if(image.length>3000000) throw new Error('CAPTURE_SIZE');
    return image;
  } finally { await browser.close(); }
}
