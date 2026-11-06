import ipaddr from 'ipaddr.js';
export const devices = ['desktop', 'mobile'];
export const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
export function publicIP(address) { try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; } }
export function safeURL(value, hosts) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || u.search || u.hash || !hosts.includes(u.hostname)) throw new Error('URL_BLOCKED');
  return u;
}
export function validate(config) {
  if (!Array.isArray(config.sites) || config.sites.length < 1 || config.sites.length > 30) throw new Error('SITE_LIMIT');
  if (!Number.isSafeInteger(config.maxStorageBytes) || config.maxStorageBytes < 10000000 || config.maxStorageBytes > 10000000000) throw new Error('STORAGE_LIMIT');
  const ids = new Set();
  for (const s of config.sites) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id) || ids.has(s.id)) throw new Error('SITE_ID');
    ids.add(s.id);
    if (!Array.isArray(s.hosts) || !s.hosts.length || s.hosts.length > 10 || s.hosts.some(h => !/^[a-z0-9.-]+$/.test(h) || !h.includes('.'))) throw new Error('HOSTS');
    safeURL(s.url, s.hosts);
    for (const key of ['enabled','public','screenshotsPublic']) if (typeof s[key] !== 'boolean') throw new Error('FLAGS');
    if (typeof s.name !== 'string' || s.name.length > 100) throw new Error('NAME');
  }
  return config;
}
export function day(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric',month:'2-digit',day:'2-digit' }).format(now); }
const numeric = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
export function normalize(body) {
  const l = body.lighthouseResult;
  if (!l || l.runtimeError) throw new Error('PSI_INVALID');
  const scores = Object.fromEntries(categories.map(k => [k, numeric(l.categories?.[k]?.score) === null ? null : Math.round(l.categories[k].score * 100)]));
  if (scores.performance === null) throw new Error('PSI_INVALID');
  return { scores, lab: Object.fromEntries(Object.entries({lcp:'largest-contentful-paint',cls:'cumulative-layout-shift',fcp:'first-contentful-paint',tbt:'total-blocking-time'}).map(([k,v])=>[k,numeric(l.audits?.[v]?.numericValue)])), field: body.loadingExperience?.metrics ? {source:'CrUX',inp:numeric(body.loadingExperience.metrics.INTERACTION_TO_NEXT_PAINT?.percentile)} : null, lighthouseVersion:l.lighthouseVersion ?? null };
}
export function degraded(rows) {
  const sorted = [...rows].sort((a,b)=>a.day.localeCompare(b.day));
  if (sorted.length < 6 || sorted.slice(-6).some(r=>r.psi.status !== 'ok')) return false;
  const values=sorted.slice(-6).map(r=>r.psi.scores.performance);
  const baseline=values.slice(0,3).sort((a,b)=>a-b)[1];
  return values.slice(3).every(v=>v <= baseline-10);
}
export const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
