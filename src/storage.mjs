import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
function keyCheck(key) { if(!/^(records|screenshots)\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\/(desktop|mobile)\.(json|jpg)$/.test(key)) throw new Error('STORAGE_KEY'); }
export class LocalStore {
  constructor(root='data') {this.root=root;}
  async list() {
    const out=[];
    const walk=async (dir,prefix='')=>{
      let entries; try {entries=await readdir(dir,{withFileTypes:true});} catch(e) {if(e.code==='ENOENT')return;throw e;}
      for(const e of entries) {
        if(e.isSymbolicLink()) throw new Error('STORAGE_SYMLINK');
        const key=prefix+e.name;
        if(e.isDirectory()) await walk(path.join(dir,e.name),key+'/');
        else {out.push({key,size:(await stat(path.join(dir,e.name))).size}); if(out.length>100000)throw new Error('OBJECT_LIMIT');}
      }
    }; await walk(this.root); return out;
  }
  async get(key) {keyCheck(key);return readFile(path.join(this.root,key));}
  async put(key,body) {keyCheck(key);const file=path.join(this.root,key);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,body,{flag:'wx'});}
}
export class R2Store {
  constructor(env=process.env) {
    if(!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID??'') || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error('R2_CONFIG');
    this.bucket=env.R2_BUCKET;
    this.client=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},maxAttempts:2});
  }
  async list() {
    const out=[];let token;
    do {const r=await this.client.send(new ListObjectsV2Command({Bucket:this.bucket,ContinuationToken:token}));for(const o of r.Contents??[])out.push({key:o.Key,size:o.Size});token=r.NextContinuationToken;if(out.length>100000)throw new Error('OBJECT_LIMIT');}while(token);
    return out;
  }
  async get(key) {keyCheck(key);return Buffer.from(await (await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}))).Body.transformToByteArray());}
  async put(key,body) {keyCheck(key);await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:body,ContentType:key.endsWith('.jpg')?'image/jpeg':'application/json',IfNoneMatch:'*'}));}
}
export function storeFromEnv() {return process.env.STORAGE==='r2'?new R2Store():new LocalStore(process.env.DATA_DIR??'data');}
