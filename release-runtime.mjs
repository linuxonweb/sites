// Explicit release preparation. No deployment, credential access, or live-tree mutation.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const chunkSize = 20 * 1024 * 1024;
export const decoderInput = Object.freeze({
  path: '/mnt/p6/build/firefox-webgpu-w3-20260929/decoder-build-run2/firefox-webgpu-decoder.wasm',
  size: 377315, sha256: '2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e',
});
const linux = [
  'index.html', 'main.js', 'keyboard.mjs', 'mobile-keyboard.mjs', 'touch-gesture.mjs',
  'log-viewer.mjs', 'persistent-home.mjs', 'boot-assets.mjs', 'boot-manifest.json',
  'storage-panel.mjs', 'gputest.mjs', 'vmlinux.wasm', 'initramfs.cpio', 'initramfs-firefox.cpio.gz',
  'node_modules/@xterm/xterm/css/xterm.css', 'node_modules/@xterm/xterm/lib/xterm.js',
  'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  'dist/audio.js', 'dist/bytes.js', 'dist/devicetree.js', 'dist/firefox-callback-adapter.mjs',
  'dist/firefox-callback-diagnostics.mjs', 'dist/framebuffer-presenter.js', 'dist/framebuffer.js',
  'dist/guest-gpu-hostcall.js', 'dist/guest-gpu-owner.js', 'dist/guest-gpu-vk.js',
  'dist/guest-gpu-wgpu.js', 'dist/guest-jit.js', 'dist/index.js', 'dist/platform.js',
  'dist/user-memory-growth-adapter.js', 'dist/util.js', 'dist/wasm.js', 'dist/wasm_binary.js', 'dist/worker.js',
  'dist/network/gateway.js', 'dist/network/index.js', 'dist/network/ws-tcp.js',
  'dist/virtio/block.js', 'dist/virtio/console.js', 'dist/virtio/core.js', 'dist/virtio/entropy.js',
  'dist/virtio/fs.js', 'dist/virtio/input.js', 'dist/virtio/net.js', 'dist/virtio/vsock.js',
  'gpu/wgsl.wasm', 'gpu/glsl.wasm', 'gpu/gputest.cpio', 'gpu/gputest-glgears.cpio', 'gpu/gputest-vkgears.cpio',
  // These runtime modules happen to live under tests. No fixture pages, runners,
  // candidate directories, shader sources, profiles, or build trees are allowed.
  'tests/guest-gpu/host.mjs',
  'tests/guest-vulkan-graphics/renderer.mjs', 'tests/guest-vulkan-graphics/translator/index.mjs',
  'tests/guest-vulkan-graphics/translator/worker.mjs', 'tests/guest-vulkan-graphics/translator/abi.mjs',
  'tests/guest-vulkan-webgl/renderer.mjs', 'tests/guest-vulkan-webgl/translator/index.mjs',
  'tests/guest-vulkan-webgl/translator/worker.mjs', 'tests/guest-vulkan-webgl/translator/abi.mjs',
  'tests/firefox-webgpu-decoder/decoder.mjs', 'dist/firefox-webgpu-decoder.wasm',
];
const desktop = ['index.html', 'browser-posix-websocket.js', 'aurora-runner.js', 'xvfb-runner.js',
  'artifacts/xvfb/Xvfb.js', 'artifacts/xvfb/Xvfb.wasm', 'artifacts/xvfb/Xvfb.data',
  'artifacts/aurora/aurora-wm.js', 'artifacts/aurora/aurora-wm.wasm'];
export const runtimeSources = Object.freeze([...linux.map(p => ({ source: 'web/linux/'+p, path: '/linux/'+p })),
  ...desktop.map(p => ({ source: 'web/desktop/'+p, path: '/desktop/'+p }))].sort((a,b)=>a.path.localeCompare(b.path)));
export const runtimeAliases = Object.freeze(Object.fromEntries(desktop.filter(p=>p.startsWith('artifacts/'))
  .map(p=>['/upstream/'+p.slice(10),'/desktop/'+p])
  .concat(['browser-posix-websocket.js','aurora-runner.js','xvfb-runner.js'].map(p=>['/upstream/'+p,'/desktop/'+p]))));
export const approvedRoutes = Object.freeze([...runtimeSources.map(s=>s.path),...Object.keys(runtimeAliases)].sort());
const mime = { '.html':'text/html; charset=utf-8', '.json':'application/json', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm' };
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const here=dirname(fileURLToPath(import.meta.url));
function git(root,args) {
  const result=spawnSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.status!==0)throw new Error('Git source verification failed: '+args.join(' '));
  return result.stdout.trim();
}
async function scratchDirectory(path) {
  const target=resolve(path);
  if(!target.startsWith('/mnt/p6/build/'))throw new Error('Release outputs must be under /mnt/p6/build');
  await mkdir(dirname(target),{recursive:true});
  if(!(await realpath(dirname(target))).startsWith('/mnt/p6/build/'))throw new Error('Output parent escapes build storage');
  return target;
}
async function hashFile(path) {
  const before=await lstat(path); if(!before.isFile()||before.size<=0)throw new Error('Not a nonempty regular input: '+path);
  const hash=createHash('sha256'),gitHash=createHash('sha1');gitHash.update('blob '+before.size+'\0');let size=0;
  for await(const bytes of createReadStream(path)){hash.update(bytes);gitHash.update(bytes);size+=bytes.length;}
  const after=await stat(path);
  if(size!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw new Error('Input changed: '+path);
  return {size,sha256:hash.digest('hex'),gitBlobSHA1:gitHash.digest('hex')};
}
export async function reviewDependencies(readSource) {
  const dependencies=[];
  const selected=runtimeSources.filter(s=>/\.(?:m?js)$/.test(s.path)&&s.path.startsWith('/linux/')&&!s.path.includes('/node_modules/'));
  const host=await readSource('/linux/tests/guest-gpu/host.mjs');
  if(!/allowCompute = false/.test(host))throw new Error('Production compute default changed; review the dependency allowlist');
  for(const caller of ['/linux/gputest.mjs','/linux/dist/guest-gpu-vk.js']){
    if(/\ballowCompute\b/.test(await readSource(caller)))throw new Error('Production compute enablement requires a new reviewed allowlist');
  }
  for(const entry of selected){
    const source=await readSource(entry.path);
    const statics=[...source.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/gm)].map(m=>m[1]);
    const dynamics=[...source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)].map(m=>m[2]);
    const computed=[...source.matchAll(/\bimport\s*\(/g)].length-dynamics.length;
    if(computed){
      if(entry.path!=='/linux/dist/guest-gpu-wgpu.js'||computed!==1||!source.includes('import(new URL("decoder.mjs", base).href)'))throw new Error('Unreviewed computed runtime import: '+entry.path);
      dependencies.push({from:entry.path,path:'/linux/tests/firefox-webgpu-decoder/decoder.mjs',kind:'reviewed computed import'});
    }
    for(const specifier of [...statics,...dynamics]){
      const path=new URL(specifier,'https://release.invalid'+entry.path).pathname;
      if(entry.path==='/linux/tests/guest-gpu/host.mjs'&&specifier==='../guest-vulkan-compute/translator/index.mjs'){
        dependencies.push({from:entry.path,path,kind:'inactive: allowCompute=false'});continue;
      }
      if(!specifier.startsWith('./')&&!specifier.startsWith('../'))throw new Error('Unreviewed runtime module import: '+specifier);
      if(!approvedRoutes.includes(path))throw new Error('Unallowlisted runtime import: '+entry.path+' -> '+path);
      dependencies.push({from:entry.path,path,kind:'module import'});
    }
    for(const match of source.matchAll(/new URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)/g)){
      const path=new URL(match[2],'https://release.invalid'+entry.path).pathname;
      if(path.endsWith('/')&&entry.path==='/linux/dist/guest-gpu-wgpu.js'&&path==='/linux/tests/firefox-webgpu-decoder/')continue;
      if(!approvedRoutes.includes(path))throw new Error('Unallowlisted runtime URL: '+entry.path+' -> '+path);
      dependencies.push({from:entry.path,path,kind:'module-relative asset/worker URL'});
    }
  }
  dependencies.push({from:'/linux/dist/platform.js',path:'/linux/dist/worker.js',kind:'reviewed kernel-worker constructor'},
    {from:'/linux/dist/guest-gpu-wgpu.js',path:'/linux/dist/firefox-webgpu-decoder.wasm',kind:'decoder binary fetch'});
  return dependencies;
}
function verifySource(root,commit,sources) {
  if(!/^[a-f0-9]{40}$/.test(commit)||git(root,['rev-parse','HEAD'])!==commit)throw new Error('Source HEAD must equal the reviewed full parent commit');
  const paths=sources.filter(s=>!s.external).map(s=>s.source);
  // This checks working bytes against the commit, including staged changes.
  git(root,['diff','--no-ext-diff','--exit-code',commit,'--',...paths]);
  for(const path of paths)git(root,['cat-file','-e',commit+':'+path]);
}
export async function auditRelease(root,commit) {
  root=await realpath(root);const sources=[];
  for(const entry of runtimeSources){
    let input=join(root,entry.source),external=false;
    if(entry.path==='/linux/dist/firefox-webgpu-decoder.wasm'){
      try{await stat(input);}catch(error){if(error.code!=='ENOENT')throw error;input=decoderInput.path;external=true;}
    }
    if(!external&&(await realpath(input))!==input)throw new Error('Committed source must not traverse a symlink: '+entry.source);
    sources.push({...entry,input,external});
  }
  verifySource(root,commit,sources);
  for(const entry of sources){Object.assign(entry,await hashFile(entry.input));
    if(!entry.external&&git(root,['rev-parse',commit+':'+entry.source])!==entry.gitBlobSHA1)throw new Error('Working bytes differ from committed blob: '+entry.source);
    if(entry.path==='/linux/dist/firefox-webgpu-decoder.wasm'&&(entry.size!==decoderInput.size||entry.sha256!==decoderInput.sha256))throw new Error('Decoder differs from accepted W3 artifact');}
  verifySource(root,commit,sources);
  const bootManifest=JSON.parse(await readFile(join(root,'web/linux/boot-manifest.json'),'utf8'));
  if(bootManifest.schema!==1||typeof bootManifest.version!=='string'||JSON.stringify(Object.keys(bootManifest.assets).sort())!==JSON.stringify(['firefox','kernel','plain']))throw new Error('Unexpected boot manifest schema/image set');
  for(const image of Object.values(bootManifest.assets)){
    const path=new URL(image.url,'https://release.invalid/linux/boot-manifest.json').pathname,source=sources.find(s=>s.path===path);
    if(!source||source.size!==image.bytes||source.sha256!==image.sha256)throw new Error('Boot manifest/image mismatch: '+path);
  }
  for(const [name,sha256]of [['wgsl','56b232004f08ae50381b6b8f68a0a9df521fa59ddfb1d1139c9c0dfcdcc2ebb2'],['glsl','5bf9d0be09b14b2ffdf40efcc4fabf872b2717b658c87039c76ae51efc3740c5']]){
    if(sources.find(s=>s.path==='/linux/gpu/'+name+'.wasm').sha256!==sha256)throw new Error('Accepted translator changed: '+name);
  }
  const dependencies=await reviewDependencies(async path=>(await readFile(sources.find(s=>s.path===path).input)).toString('utf8'));
  return {schema:1,parentCommit:commit,sourceRoot:root,helperSHA256:digest(await readFile(join(here,'release-runtime.mjs'))),
    approvedRoutes,aliases:runtimeAliases,sources,bootManifest,dependencies,chunkSize,
    exclusions:['profiles','candidate archives','source/build trees','fixture pages','test runners'],
    inactiveDependency:'guest-vulkan-compute translator is not enabled by either production serveGPU caller (allowCompute defaults false)'};
}
export async function stageRelease(auditPath,output) {
  const auditBytes=await readFile(auditPath),audit=JSON.parse(auditBytes);
  if(audit.schema!==1||audit.helperSHA256!==digest(await readFile(join(here,'release-runtime.mjs')))||
    JSON.stringify(audit.approvedRoutes)!==JSON.stringify(approvedRoutes)||JSON.stringify(audit.aliases)!==JSON.stringify(runtimeAliases))throw new Error('Release audit does not match current reviewed helper');
  const fresh=await auditRelease(audit.sourceRoot,audit.parentCommit);
  if(JSON.stringify(fresh)!==JSON.stringify(audit))throw new Error('Release inputs changed since audit');
  output=await scratchDirectory(output);
  await mkdir(output); // Never overwrite an existing frozen snapshot.
  const publicDir=join(output,'public'),generated=join(output,'generated');await mkdir(publicDir);await mkdir(generated);
  const assets={},parts=new Map();
  const report={chunkSize,sourceFiles:[],sourceBytes:0,stagedFiles:0,stagedBytes:0,routes:0,largeFiles:0};
  for(const source of audit.sources){
    const handle=await open(source.input,'r'),hash=createHash('sha256'),mapped=[];let offset=0;
    try{
      while(offset<source.size){
        const bytes=Buffer.allocUnsafe(Math.min(chunkSize,source.size-offset));let filled=0;
        while(filled<bytes.length){const r=await handle.read(bytes,filled,bytes.length-filled,offset+filled);if(!r.bytesRead)throw new Error('Truncated input: '+source.path);filled+=r.bytesRead;}
        hash.update(bytes);
        const path=source.size<=chunkSize?source.path:'/__chunks/'+source.sha256+'/'+mapped.length;
        const target=join(publicDir,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
        mapped.push({path,size:bytes.length});parts.set(path,{size:bytes.length,hash:createHash('md5').update(bytes).digest('hex')});offset+=bytes.length;
      }
    }finally{await handle.close();}
    if(hash.digest('hex')!==source.sha256)throw new Error('Source changed while staging: '+source.path);
    assets[source.path]={size:source.size,sha256:source.sha256,contentType:mime[extname(source.source)]||'application/octet-stream',parts:mapped};
    report.sourceFiles.push({source:source.source,path:source.path,size:source.size,sha256:source.sha256,parts:mapped.length});
    report.sourceBytes+=source.size;if(mapped.length>1)report.largeFiles++;
  }
  for(const [alias,path]of Object.entries(runtimeAliases))assets[alias]=assets[path];
  report.routes=Object.keys(assets).length;report.stagedFiles=parts.size;report.stagedBytes=[...parts.values()].reduce((n,p)=>n+p.size,0);
  verifySource(audit.sourceRoot,audit.parentCommit,audit.sources);
  const ordered=Object.fromEntries(Object.entries(assets).sort(([a],[b])=>a.localeCompare(b)));
  const manifestBytes='// Generated by stage-assets.mjs. Do not edit.\nexport default '+JSON.stringify(ordered,null,2)+';\n';
  const reportBytes=JSON.stringify(report,null,2)+'\n';
  const provenance={schema:1,parentCommit:audit.parentCommit,auditSHA256:digest(auditBytes),helperSHA256:audit.helperSHA256,
    approvedRoutes,aliases:runtimeAliases,counts:{sourceFiles:report.sourceFiles.length,routes:report.routes,stagedFiles:report.stagedFiles,stagedBytes:report.stagedBytes,sourceBytes:report.sourceBytes},
    inputManifestSHA256:digest(manifestBytes),inputBuildReportSHA256:digest(reportBytes),bootManifest:audit.bootManifest,
    externalInputs:audit.sources.filter(s=>s.external),sources:audit.sources.map(({input,...s})=>s),dependencies:audit.dependencies};
  await writeFile(join(generated,'asset-manifest.mjs'),manifestBytes);await writeFile(join(generated,'build-report.json'),reportBytes);
  await writeFile(join(generated,'upload-manifest.json'),JSON.stringify(Object.fromEntries(parts),null,2)+'\n');
  await writeFile(join(generated,'release-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
  return provenance;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action,...args]=process.argv.slice(2);
  if(action==='audit'&&args.length===3){const audit=await auditRelease(args[0],args[1]);const path=await scratchDirectory(args[2]);await writeFile(path,JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({audit:path,parentCommit:audit.parentCommit,sources:audit.sources.length,routes:approvedRoutes.length,externalInputs:audit.sources.filter(s=>s.external)}));}
  else if(action==='stage'&&args.length===2)console.log(JSON.stringify(await stageRelease(args[0],args[1])));
  else throw new Error('usage: node release-runtime.mjs audit SOURCE_ROOT FULL_COMMIT AUDIT_JSON | stage AUDIT_JSON NEW_SNAPSHOT_DIRECTORY');
}
