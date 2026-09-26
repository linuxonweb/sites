import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
if (!process.env.SITES_RUNTIME_INPUT) throw new Error('SITES_RUNTIME_INPUT must name the pinned staging snapshot');
const snapshot=resolve(process.env.SITES_RUNTIME_INPUT), temporary=join(root,'.dist-hybrid.tmp');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const lock=JSON.parse(await readFile(join(root,'runtime-lock.json')));
const manifest=await readFile(join(root,'runtime-assets.mjs'),'utf8');
if (lock.schema!==1 || hash(manifest)!==lock.runtimeManifestSHA256) throw new Error('pinned manifest mismatch');
for (const [path,sha] of [['asset-manifest.mjs',lock.inputManifestSHA256],['build-report.json',lock.inputBuildReportSHA256]]) {
  if(hash(await readFile(join(snapshot,'generated',path)))!==sha)throw new Error('pinned metadata mismatch: '+path);
}
await rm(temporary,{recursive:true,force:true});
for(const directory of ['server','client','client/_runtime_assets','.openai'])await mkdir(join(temporary,directory),{recursive:true});
let bytesCopied=0;
try {
  const copied=new Set();
  for(const part of lock.parts){
    if(!/^\/_runtime_assets\/[a-f0-9]{64}\.bin$/.test(part.path)||!part.source.startsWith('/')||part.source.includes('..'))throw new Error('invalid pinned path');
    const bytes=await readFile(resolve(snapshot,'public','.'+part.source));
    if(bytes.length!==part.size||hash(bytes)!==part.sha256)throw new Error('pinned part mismatch: '+part.source);
    if(!copied.has(part.path)){await writeFile(join(temporary,'client',part.path),bytes);copied.add(part.path);bytesCopied+=bytes.length;}
  }
  const assetCode=(await readFile(join(root,'asset-handler.mjs'),'utf8')).replace(/^export /gm,'');
  const worker=(await readFile(join(root,'worker.mjs'),'utf8')).replace(/^import .* from '\.\/(?:asset-handler|runtime-assets)\.mjs';\n/gm,'').replace(/^export (?!default\b)/gm,'');
  await writeFile(join(temporary,'server/index.js'),manifest.replace('export default ','const runtimeAssets = ')+assetCode+'\n'+worker);
  await writeFile(join(temporary,'.openai/hosting.json'),await readFile(join(root,'.openai/hosting.json')));
  await writeFile(join(temporary,'client/index.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/linux/index.html?firefox=1"><title>Linux on Web</title>\n');
  await rm(join(root,'dist'),{recursive:true,force:true});await rename(temporary,join(root,'dist'));
  console.log(JSON.stringify({parentCommit:lock.parentCommit,routes:lock.routes,parts:copied.size,bytesCopied,manifestSHA256:lock.runtimeManifestSHA256}));
}catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
