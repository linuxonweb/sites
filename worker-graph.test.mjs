import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveWorkerGraph } from './worker-graph.mjs';

function fixture(extra=''){
  const files={
    '/linux/dist/worker.js':'import { platform } from "./platform.js";\nimport "./util.js";\n'+extra,
    '/linux/dist/platform.js':'import "./util.js";\nconst url = new URL("./worker.js", module_url);\nconst load = () => import(\'../boot-assets.mjs\');\n',
    '/linux/dist/util.js':'export const value = 1;\n',
    '/linux/boot-assets.mjs':'export const latest = () => fetch("./boot-manifest.json");\n',
  };
  const assets=Object.fromEntries(Object.entries(files).map(([path,source])=>[path,{size:Buffer.byteLength(source),sha256:createHash('sha256').update(source).digest('hex'),contentType:'text/javascript',parts:[{path:'/original',size:Buffer.byteLength(source)}]}]));
  return {files,assets,read:async path=>Buffer.from(files[path])};
}
test('worker namespace binds transitive bytes and keeps stable update dependencies',async()=>{
  const f=fixture(),first=await deriveWorkerGraph(f.assets,f.read),again=await deriveWorkerGraph(f.assets,f.read);
  assert.equal(first.metadata.graphSHA256,again.metadata.graphSHA256);
  assert.deepEqual(first.metadata.stableExternalDependencies,['/linux/boot-assets.mjs']);
  assert.equal(first.assets['/linux/boot-assets.mjs'].immutable,undefined);
  for(const path of ['/linux/dist/worker.js','/linux/dist/platform.js','/linux/dist/util.js'])assert.equal(first.assets[first.metadata.prefix+path].immutable,true);
  const platform=first.assets['/linux/dist/platform.js'];
  assert.ok(first.parts.get(platform.parts[0].path).toString().includes(first.metadata.prefix+'/linux/dist/worker.js'));
  assert.equal(platform.immutable,undefined);
  assert.equal(f.assets['/linux/dist/platform.js'].sha256,createHash('sha256').update(f.files['/linux/dist/platform.js']).digest('hex'),'pinned metadata not mutated');
  const changed=fixture('// new worker revision\n'),second=await deriveWorkerGraph(changed.assets,changed.read);
  assert.notEqual(first.metadata.graphSHA256,second.metadata.graphSHA256);
});
test('unresolved imports, unverified bytes and ambiguous rewrites fail before build',async()=>{
  const missing=fixture('import "./missing.js";\n');await assert.rejects(deriveWorkerGraph(missing.assets,missing.read),/Unpinned/);
  const dynamic=fixture('import(variable);\n');await assert.rejects(deriveWorkerGraph(dynamic.assets,dynamic.read),/Nonliteral/);
  const f=fixture();f.files['/linux/dist/util.js']+='changed';await assert.rejects(deriveWorkerGraph(f.assets,f.read),/hash mismatch/);
  const duplicate=fixture();duplicate.files['/linux/dist/platform.js']+='new URL("./worker.js", module_url);';
  const bytes=Buffer.from(duplicate.files['/linux/dist/platform.js']);duplicate.assets['/linux/dist/platform.js']={...duplicate.assets['/linux/dist/platform.js'],size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  await assert.rejects(deriveWorkerGraph(duplicate.assets,duplicate.read),/exactly one/);
});
