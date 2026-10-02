import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pinned from './runtime-assets.mjs';
const assets=JSON.parse(await readFile(new URL('./dist/runtime-assets.json',import.meta.url)));
const graph=JSON.parse(await readFile(new URL('./dist/worker-graph-build.json',import.meta.url)));

// Validation only: use the parent's existing locked Miniflare dependency.
const { Miniflare, convertV4MiniflareOptions } = createRequire(new URL('../cloudflare/package.json',import.meta.url))('miniflare');
let runtime;
before(async()=>{
  const path=fileURLToPath(new URL('./dist/server/index.js',import.meta.url));
  const source=await readFile(path,'utf8');
  assert.doesNotMatch(source,/^import\s/m,'built Worker must be self-contained');
  assert.doesNotMatch(source,/cloudflare:sockets|ASSETS_PROBE_PATH/);
  runtime=new Miniflare(convertV4MiniflareOptions({
    name:'sites-runtime-test',compatibilityDate:'2026-09-26',modules:[{type:'ESModule',path}],
    assets:{directory:fileURLToPath(new URL('./dist/client',import.meta.url)),binding:'ASSETS',run_worker_first:true,
      routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none',not_found_handling:'none'}},
  }));
  await runtime.ready;
});
after(async()=>{await runtime?.dispose();});
const request=(path,init={})=>runtime.dispatchFetch('http://sites-runtime.test'+path,{redirect:'manual',...init});
function isolated(response){
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
}
test('built Worker streams all pinned and derived routes with exact SHA/length and isolation',async()=>{
  for(const [path,entry]of Object.entries(pinned))if(path!=='/linux/dist/platform.js')assert.deepEqual(assets[path],entry,'accepted route changed: '+path);
  for(const [path,entry] of Object.entries(assets)){
    const response=await request(path);assert.equal(response.status,200,path);isolated(response);
    const hash=createHash('sha256');let size=0;
    for await(const bytes of response.body){hash.update(bytes);size+=bytes.byteLength;}
    assert.equal(size,entry.size,path);assert.equal(hash.digest('hex'),entry.sha256,path);
  }
});
test('worker graph is immutable while stable update paths revalidate',async()=>{
  for(const path of Object.keys(graph.outputs)){
    const response=await request(path+'?run=qa&firefox_diagnostics=1',{method:'HEAD'});assert.equal(response.status,200);isolated(response);
    assert.equal(response.headers.get('Cache-Control'),path.startsWith(graph.prefix+'/')?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
    assert.equal(response.headers.get('ETag'),'"'+assets[path].sha256+'"');
  }
  const platform=await(await request('/linux/dist/platform.js')).text();assert.ok(platform.includes(graph.prefix+'/linux/dist/worker.js'));
  const versionedPlatform=await(await request(graph.prefix+'/linux/dist/platform.js')).text();assert.ok(versionedPlatform.includes("import('/linux/boot-assets.mjs')"));
  const path=graph.prefix+'/linux/dist/worker.js';
  const range=await request(path,{headers:{Range:'bytes=0-31'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);isolated(range);
  assert.equal((await request('/_runtime_worker/'+'0'.repeat(64)+'/linux/dist/worker.js')).status,404);
  assert.equal((await request(graph.prefix+'/linux/dist/%2e%2e/private.js')).status,404);
  for(const path of ['/linux/boot-assets.mjs','/linux/boot-manifest.json','/linux/main.js'])assert.equal((await request(path,{method:'HEAD'})).headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
});
test('built Worker handles archive HEAD, cross-part range, ETag, root and missing routes',async()=>{
  const path='/linux/initramfs-firefox.cpio.gz',entry=assets[path];
  const head=await request(path,{method:'HEAD'});assert.equal(head.status,200);isolated(head);
  assert.equal(Number(head.headers.get('Content-Length')),entry.size);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await request(path,{headers:{'If-None-Match':'"'+entry.sha256+'"'}})).status,304);
  const start=entry.parts[0].size-32,end=start+63;
  const response=await request(path,{headers:{Range:`bytes=${start}-${end}`}});
  assert.equal(response.status,206);isolated(response);assert.equal(response.headers.get('Content-Range'),`bytes ${start}-${end}/${entry.size}`);
  const first=await readFile(new URL('./dist/client'+entry.parts[0].path,import.meta.url));
  const second=await readFile(new URL('./dist/client'+entry.parts[1].path,import.meta.url));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.concat([first.subarray(first.length-32),second.subarray(0,32)]));
  const root=await request('/?check=1');assert.equal(root.status,302);assert.equal(root.headers.get('Location'),'/linux/index.html?check=1&firefox=1');isolated(root);
  for(const path of ['/linux/tests/guest-graphics.html','/__runtime-assets-probe-20260926','/source/private']){const response=await request(path);assert.equal(response.status,404,path);isolated(response);}
  const manifest=await(await request('/linux/boot-manifest.json')).json();
  const expected=JSON.parse(Buffer.concat(await Promise.all(pinned['/linux/boot-manifest.json'].parts.map(part=>readFile(new URL('./dist/client'+part.path,import.meta.url))))));
  assert.deepEqual(manifest,expected);
  for(const image of Object.values(manifest.assets)){
    const entry=assets[new URL(image.url,'http://sites-runtime.test/linux/boot-manifest.json').pathname];
    assert.equal(entry.sha256,image.sha256);assert.equal(entry.size,image.bytes);
  }
});
