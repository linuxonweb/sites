import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleAsset } from './asset-handler.mjs';
import worker from './worker.mjs';

// Node unit shim enforces the same length invariant; integration uses workerd.
globalThis.FixedLengthStream = class extends TransformStream {
  constructor(expected) {
    let seen=0;
    super({transform(chunk,controller){seen+=chunk.byteLength;if(seen>expected)throw new Error('oversized');controller.enqueue(chunk);},flush(){if(seen!==expected)throw new Error('truncated');}});
  }
};
const origin='https://linuxonweb.example';
const chunks=[new Uint8Array([0,1,2]),new Uint8Array([3,4,5,6])];
const expected=Buffer.concat(chunks);
const sha=createHash('sha256').update(expected).digest('hex');
const manifest={'/linux/archive':{size:7,sha256:sha,contentType:'application/octet-stream',parts:[{path:'/a',size:3},{path:'/b',size:4}]}};
function binding({nativeOnly=false,missing=false}={}) {
  let pipes=0,requests=0;
  return {env:{ASSETS:{async fetch(input){
    requests++;const url=new URL(typeof input==='string'?input:input.url);
    if(missing)return new Response('missing',{status:404});
    const response=new Response(chunks[url.pathname==='/a'?0:1]);
    if(nativeOnly){const pipe=response.body.pipeTo.bind(response.body);response.body.pipeTo=(...args)=>{pipes++;return pipe(...args);};response.body.getReader=()=>{throw new Error('full path must use native pipeTo');};}
    return response;
  }}},counts:()=>({pipes,requests})};
}
const request=(path='/linux/archive',init)=>new Request(origin+path,init);
test('native multipart pumps preserve bytes/hash, isolation and ETag; HEAD/304 need no asset reads',async()=>{
  const fixture=binding({nativeOnly:true});
  const response=await handleAsset(request(),fixture.env,manifest);
  const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,expected);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);assert.equal(fixture.counts().pipes,2);
  for(const [name,value] of [['Cross-Origin-Opener-Policy','same-origin'],['Cross-Origin-Embedder-Policy','require-corp'],['Cross-Origin-Resource-Policy','same-origin']])assert.equal(response.headers.get(name),value);
  assert.equal(response.headers.get('ETag'),'"'+sha+'"');
  const head=await handleAsset(request(undefined,{method:'HEAD'}),fixture.env,manifest);assert.equal(head.body,null);assert.equal(head.headers.get('Content-Length'),'7');
  const cached=await handleAsset(request(undefined,{headers:{'If-None-Match':'"'+sha+'"'}}),fixture.env,manifest);assert.equal(cached.status,304);assert.equal(fixture.counts().requests,2);
});
test('cross-part ranges clip bindings that return full 200 bodies; invalid ranges fail',async()=>{
  const fixture=binding();
  const response=await handleAsset(request(undefined,{headers:{Range:'bytes=2-4'}}),fixture.env,manifest);
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 2-4/7');assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected.subarray(2,5));
  assert.equal((await handleAsset(request(undefined,{headers:{Range:'bytes=7-'}}),fixture.env,manifest)).status,416);
});
test('unknown routes and missing local parts never fall back upstream; probe is removed',async()=>{
  const fixture=binding({missing:true});
  assert.equal((await handleAsset(request('/unknown'),fixture.env,manifest)).status,404);
  await assert.rejects(handleAsset(request(),fixture.env,manifest),/Asset chunk unavailable/);
  const absent=await worker.fetch(request('/linux/initramfs-firefox.cpio.gz'),fixture.env);assert.equal(absent.status,502);
  assert.equal((await worker.fetch(request('/__runtime-assets-probe-20260926'),fixture.env)).status,404);
  assert.equal((await worker.fetch(request('/linux/index.html',{method:'POST'}),fixture.env)).status,405);
  assert.equal((await worker.fetch(request('/linux/index.html',{headers:{Origin:'https://other.example'}}),fixture.env)).status,403);
});
test('root keeps Firefox redirect and query parameters',async()=>{
  const response=await worker.fetch(request('/?foo=bar'),{});assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'/linux/index.html?foo=bar&firefox=1');
});
