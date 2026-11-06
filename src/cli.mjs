import { readFile } from 'node:fs/promises';
import { validate } from './core.mjs';
import { storeFromEnv } from './storage.mjs';
import { collect } from './collect.mjs';
import { buildReport } from './report.mjs';
try {
  const config=validate(JSON.parse(await readFile(process.env.CONFIG??'config/sites.json','utf8'))),store=storeFromEnv();
  if(process.argv[2]==='collect') {
    const result=await collect(config,store);console.log(JSON.stringify(result));if(result.failures)process.exitCode=1;
  } else if(process.argv[2]==='report') {
    const dir=process.env.OUTPUT_DIR??`output/${process.argv.includes('--public')?'public':'private'}`;
    await buildReport(config,store,dir,{publicOnly:process.argv.includes('--public')});console.log('Report created');
  } else throw new Error('COMMAND');
} catch { console.error('SpeedWatch failed. Check configuration, connectivity, quota and storage budget. Raw errors are withheld to protect credentials.');process.exitCode=1; }
