import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { day, devices, degraded, median, escapeHTML as h } from './core.mjs';
export async function buildReport(config,store,dir='output',{publicOnly=false,now=new Date()}={}) {
  await mkdir(dir,{recursive:true});
  if ((await readdir(dir)).length) throw new Error('OUTPUT_MUST_BE_EMPTY');
  const objects=await store.list(),rows=[];
  const sites=config.sites.filter(s=>s.enabled&&(!publicOnly||s.public));
  const byId=new Map(sites.map(s=>[s.id,s]));
  for(const o of objects.filter(o=>o.key.startsWith('records/'))) {
    const id=o.key.split('/')[1];if(!byId.has(id))continue;
    const r=JSON.parse((await store.get(o.key)).toString());
    if(r.siteId!==id||r.url!==byId.get(id).url)continue;
    // Only explicit fields cross the publication boundary.
    rows.push({siteId:r.siteId,device:r.device,day:r.day,measuredAt:r.measuredAt,psi:r.psi,local:r.local??null,screenshot:{status:r.screenshot.status,bytes:r.screenshot.bytes??null}});
  }
  rows.sort((a,b)=>a.day.localeCompare(b.day));
  await mkdir(dir,{recursive:true});
  const selectedImages=new Set(sites.flatMap(s=>devices.flatMap(d=>rows.filter(r=>r.siteId===s.id&&r.device===d&&r.screenshot.status==='ok').slice(-2))));
  for(const r of rows) {
    const site=byId.get(r.siteId);
    if(selectedImages.has(r)&&(!publicOnly||site.screenshotsPublic)){
      const file=`${r.siteId}-${r.day}-${r.device}.jpg`;
      await writeFile(`${dir}/${file}`,await store.get(`screenshots/${r.siteId}/${r.day}/${r.device}.jpg`));r.screenshot.image=file;
    }
  }
  const totalBytes=objects.reduce((n,o)=>n+o.size,0);
  const groups=sites.flatMap(s=>devices.map(device=>{
    const history=rows.filter(r=>r.siteId===s.id&&r.device===device),latest=history.at(-1);
    return {siteId:s.id,name:s.name,url:s.url,device,latest:latest??null,stale:!latest||latest.day!==day(now),degraded:degraded(history),history};
  }));
  const report={version:1,generatedAt:now.toISOString(),mode:publicOnly?'public':'private',groups,...(!publicOnly?{storage:{totalBytes,capBytes:config.maxStorageBytes,estimatedStorageUSD:Math.max(0,totalBytes/1e9-10)*.015}}:{})};
  await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
  const csv=['site,device,date,status,source,performance,lcp_ms,cls,fcp_ms,tbt_ms',...rows.map(r=>[r.siteId,r.device,r.day,r.psi.status,r.psi.status==='ok'?'pagespeed':r.local?.source??'',r.psi.scores?.performance??'',(r.psi.status==='ok'?r.psi.lab:r.local?.lab)?.lcp??'',(r.psi.status==='ok'?r.psi.lab:r.local?.lab)?.cls??'',(r.psi.status==='ok'?r.psi.lab:r.local?.lab)?.fcp??'',(r.psi.status==='ok'?r.psi.lab:r.local?.lab)?.tbt??''].join(','))].join('\n');
  await writeFile(`${dir}/history.csv`,csv);
  const weekStart = new Date(now); weekStart.setUTCDate(weekStart.getUTCDate()-6);
  const weekly = groups.map(g=>{const samples=g.history.filter(r=>r.day>=day(weekStart)&&r.day<=day(now));const scores=samples.filter(r=>r.psi.status==='ok').map(r=>r.psi.scores.performance).sort((a,b)=>a-b);return {siteId:g.siteId,device:g.device,expected:7,observed:samples.length,successful:scores.length,medianPerformance:median(scores),localSuccessful:samples.filter(r=>r.local?.status==='ok').length,localMedianLcp:median(samples.filter(r=>r.local?.status==='ok'&&Number.isFinite(r.local.lab.lcp)).map(r=>r.local.lab.lcp))};});
  await writeFile(`${dir}/weekly.json`,JSON.stringify({from:day(weekStart),to:day(now),groups:weekly},null,2));
  await writeFile(`${dir}/weekly.md`,['# SpeedWatch — 7日間',...weekly.map(g=>`- ${g.siteId} / ${g.device}: PageSpeed ${g.successful}/7日、Performance中央値 ${g.medianPerformance??'未取得'} / ローカル ${g.localSuccessful}/7日、LCP中央値 ${g.localMedianLcp??'未取得'} ms`)].join('\n'));
  await writeFile(`${dir}/summary.md`,['# SpeedWatch',`Generated: ${report.generatedAt}`,...groups.map(g=>`- ${g.name} / ${g.device}: PageSpeed ${g.latest?.psi.scores?.performance??'unavailable'} / ローカルLCP ${g.latest?.local?.lab?.lcp??'unavailable'} ms${g.stale?' · missing today':''}${g.degraded?' · sustained decline':''}`)].join('\n'));
  await writeFile(`${dir}/index.html`,render(report));return report;
}
export function chart(history,metric,endDay) {
  const end=Date.parse(endDay+'T00:00:00Z'),width=640,height=150;
  const byDay=new Map(history.map(r=>[r.day,r]));
  const values=Array.from({length:30},(_,i)=>{
    const date=new Date(end-(29-i)*86400000).toISOString().slice(0,10);
    return byDay.get(date)??{day:date,psi:{status:'missing'}};
  });
  const value=r=>{const n=metric==='performance'?r.psi.scores?.performance:(r.psi.status==='ok'?r.psi.lab:r.local?.lab)?.lcp;return typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;};
  const max=metric==='performance'?100:Math.max(2500,...values.map(r=>value(r)??0));
  const points=values.map((r,i)=>({x:28+i*(width-56)/Math.max(1,values.length-1),y:height-24-(value(r)??0)/max*(height-48),value:value(r),day:r.day,source:r.psi.status==='ok'?'pagespeed':r.local?.source}));
  const segments=[];let previous;
  for(const p of points){if(p.value==null){previous=null;continue;}if(previous&&previous.source===p.source)segments.push(`<line x1="${previous.x}" y1="${previous.y}" x2="${p.x}" y2="${p.y}"/>`);previous=p;}
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric} 履歴。数値は下の表にも表示"><text x="0" y="16">${max.toFixed(0)}</text><path class="axis" d="M28 16 V126 H620"/>${segments.join('')}${points.filter(p=>p.value!=null).map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4"><title>${h(p.day)}: ${p.value}</title></circle>`).join('')}<text x="28" y="148">${h(values[0]?.day??'未取得')}</text><text x="520" y="148">${h(values.at(-1)?.day??'')}</text></svg>`;
}
export function render(report) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>SpeedWatch — Yapr</title><style>
  :root{font-family:system-ui,sans-serif;color:#172c3d;background:#f2f5f6}*{box-sizing:border-box}body{max-width:1160px;margin:auto;padding:32px 24px}header{display:flex;justify-content:space-between;gap:24px;align-items:center;border-bottom:1px solid #cbd5da;padding-bottom:24px}.brand{letter-spacing:.14em;font-size:13px;font-weight:750;color:#11695e}h1{text-wrap:balance;font-size:clamp(32px,6vw,60px);letter-spacing:-.05em;margin:12px 0}h2{margin:0;font-size:24px}p{line-height:1.7;color:#506474}.tag{border:1px solid #b9ccc7;border-radius:30px;padding:6px 12px;font-size:12px}nav{margin:24px 0;display:flex;gap:20px;flex-wrap:wrap}a{color:#11695e}article{background:white;border:1px solid #d9e1e5;border-radius:18px;padding:24px;margin:24px 0}.top{display:flex;align-items:center;justify-content:space-between;gap:16px}.score{white-space:nowrap;flex-shrink:0;font-size:48px;font-weight:750;color:#11695e}.score small{font-size:14px;color:#607580}.charts{display:grid;grid-template-columns:1fr 1fr;gap:24px}svg{width:100%;overflow:visible}svg line{stroke:#168e7c;stroke-width:3}svg circle{fill:#168e7c}svg text{font-size:11px;fill:#697b86}.axis{fill:none;stroke:#dbe3e6}table{border-collapse:collapse;width:100%;font-size:13px}td,th{white-space:nowrap;text-align:left;padding:12px 8px;border-bottom:1px solid #edf0f2}.scroll{overflow:auto}.warn{color:#984c14}details{margin-top:20px}summary{cursor:pointer;padding:12px 0}img{max-width:100%;max-height:480px;object-fit:contain;object-position:top;border:1px solid #dde4e7}.shots{display:flex;gap:20px;flex-wrap:wrap}.shots figure{max-width:42%;margin:10px 0}footer{padding:30px 0;color:#627783;font-size:12px}@media(max-width:700px){.score{font-size:36px}.top{align-items:flex-start}.charts{grid-template-columns:1fr}header{display:block}.shots figure{max-width:100%}}
  </style><header><div><div class="brand">YAPR / SPEEDWATCH</div><h1>サイトの変化を、記録する。</h1><p>毎日のスクリーンショットと表示速度を、ひとつの履歴に。</p></div><span class="tag">${report.mode==='public'?'公開用レポート':'プライベートレポート'}</span></header><nav><a href="report.json" download>JSON</a><a href="history.csv" download>CSV</a><a href="summary.md" download>日次サマリー</a><a href="weekly.md" download>週間サマリー</a></nav><p>更新 ${h(report.generatedAt)} · 日本時間の日付 · ラボ計測（実利用者の体験とは異なります）</p><p>ローカルブラウザ計測は通信速度・CPUの制限なし、許可ホストのみ取得。PageSpeedスコアや実利用者データとは別の観測値です。グラフは直近30日。実行されなかった日・取得失敗の日は空白で表示します。</p>${report.groups.map(g=>`<article><div class="top"><div><span class="brand">${h(g.device.toUpperCase())}</span><h2>${h(g.name)}</h2><p>${h(g.url)}</p></div><div class="score">${h(g.latest?.psi.status==='ok'?g.latest.psi.scores.performance:g.latest?.local?.lab?.lcp??'—')}<small> ${g.latest?.psi.status==='ok'?'/ 100':'LCP ms'}</small></div></div>${g.stale?'<p class="warn">本日分がありません。定期実行を確認してください。</p>':''}${g.degraded?'<p class="warn">直近3回が基準より10点以上低下しています。要確認。</p>':''}<div class="charts"><section><h3>Performance / 直近30日</h3>${chart(g.history,'performance',day(new Date(report.generatedAt)))}</section><section><h3>LCP / ms</h3>${chart(g.history,'lcp',day(new Date(report.generatedAt)))}</section></div><details><summary>スクリーンショットを比較</summary><div class="shots">${g.history.filter(r=>r.screenshot.image).slice(-2).map(r=>`<figure><figcaption>${h(r.day)}</figcaption><a href="${h(r.screenshot.image)}"><img src="${h(r.screenshot.image)}" loading="lazy" alt="${h(g.name)} ${h(g.device)} ${h(r.day)}"></a></figure>`).join('')||'<p>公開が許可された画像はありません。</p>'}</div></details><details open><summary>計測履歴（直近30回）</summary><div class="scroll"><table><thead><tr><th>日付</th><th>PSI</th><th>指標ソース</th><th>撮影</th><th>Performance</th><th>A11y</th><th>BP</th><th>SEO</th><th>LCP ms</th><th>CLS</th><th>FCP ms</th><th>TBT ms</th></tr></thead><tbody>${g.history.slice(-30).reverse().map(r=>`<tr><td>${h(r.day)}</td><td>${h(r.psi.status)}</td><td>${h(r.psi.status==='ok'?'PageSpeed':r.local?.status==='ok'?'ローカルブラウザ':'未取得')}</td><td>${h(r.screenshot.status)}</td>${['performance','accessibility','best-practices','seo'].map(k=>`<td>${h(r.psi.scores?.[k]??'—')}</td>`).join('')}${['lcp','cls','fcp','tbt'].map(k=>`<td>${h((r.psi.status==='ok'?r.psi.lab:r.local?.lab)?.[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></article>`).join('')}${report.storage?`<p>保管量 ${(report.storage.totalBytes/1e6).toFixed(2)} MB / 上限 ${report.storage.capBytes/1e6} MB · R2保管料の参考値 $${report.storage.estimatedStorageUSD.toFixed(3)}/月（操作料・他用途・税は含みません）</p>`:''}<footer>SpeedWatch by Yapr · 欠測は0点として扱いません。データはJSON/CSVで持ち出せます。</footer></html>`;
}
