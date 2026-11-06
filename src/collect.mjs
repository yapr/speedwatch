import { day, devices, categories, normalize } from './core.mjs';
import { resolvePublic, screenshot } from './browser.mjs';
export async function pagespeed(site,device,fetcher=fetch) {
  await resolvePublic(new URL(site.url).hostname);
  const url=new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  url.searchParams.set('url',site.url);url.searchParams.set('strategy',device);
  categories.forEach(c=>url.searchParams.append('category',c));
  if(process.env.PAGESPEED_API_KEY)url.searchParams.set('key',process.env.PAGESPEED_API_KEY);
  for(let attempt=0;attempt<2;attempt++) {
    const r=await fetcher(url,{signal:AbortSignal.timeout(90000),redirect:'error'});
    if((r.status===429||r.status>=500)&&attempt===0){await new Promise(r=>setTimeout(r,2000));continue;}
    if(!r.ok)throw new Error(`PSI_HTTP_${r.status}`);
    // Raw results can include page text and URLs: normalize in memory, never retain them.
    const reader=r.body.getReader();let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10000000){await reader.cancel();throw new Error('PSI_SIZE');}chunks.push(value);}
    return normalize(JSON.parse(Buffer.concat(chunks).toString()));
  }
}
const errorCode = e => /^(PSI_[A-Z0-9_]+|CAPTURE_[A-Z_]+|NETWORK_[A-Z_]+)$/.test(e.message) ? e.message : 'FAILED';
export async function collect(config,store,{capture=screenshot,measure=pagespeed,now=new Date()}={}) {
  const objects=await store.list();let bytes=objects.reduce((n,o)=>n+o.size,0);const keys=new Set(objects.map(o=>o.key));
  let failures=0,created=0,skipped=0;
  for(const site of config.sites.filter(s=>s.enabled))for(const device of devices){
    const date=day(now),suffix=`${site.id}/${date}/${device}`,recordKey=`records/${suffix}.json`,imageKey=`screenshots/${suffix}.jpg`;
    if(keys.has(recordKey)){skipped++;continue;}
    if(bytes+3100000>config.maxStorageBytes)throw new Error('STORAGE_BUDGET_STOP');
    const row={version:1,siteId:site.id,url:site.url,device,day:date,measuredAt:new Date().toISOString(),psi:{status:'error'},screenshot:{status:'error'}};
    try{row.psi={status:'ok',...await measure(site,device)};}catch(e){row.psi={status:'error',code:errorCode(e)};failures++;}
    try{
      if(!keys.has(imageKey)){const image=await capture(site,device);if(image.length>3000000)throw new Error('CAPTURE_SIZE');await store.put(imageKey,image);bytes+=image.length;row.screenshot={status:'ok',key:imageKey,bytes:image.length};}
      else row.screenshot={status:'ok',key:imageKey,bytes:objects.find(o=>o.key===imageKey).size};
    }catch(e){row.screenshot={status:'error',code:errorCode(e)};failures++;}
    const body=Buffer.from(JSON.stringify(row));await store.put(recordKey,body);bytes+=body.length;created++;
  }
  return {created,skipped,failures,totalBytes:bytes};
}
