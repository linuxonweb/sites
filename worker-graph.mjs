import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const platformPath = '/linux/dist/platform.js';
const externalPath = '/linux/boot-assets.mjs';
const constructor = 'new URL("./worker.js", module_url)';
const dynamicAssetImport = "import('../boot-assets.mjs')";
function replaceOnce(text, needle, replacement) {
  if (text.split(needle).length !== 2) throw new Error('Expected exactly one expression: '+needle);
  return text.replace(needle,replacement);
}

// Pure build derivation: accepted inputs remain pinned and untouched. Worker
// module-relative imports resolve inside one immutable, content-addressed graph.
export async function deriveWorkerGraph(pinned, readAsset) {
  const sources=new Map(), externals=new Map();
  async function visit(path) {
    if(sources.has(path)||externals.has(path))return;
    if(!Object.hasOwn(pinned,path))throw new Error('Unpinned worker dependency: '+path);
    const bytes=Buffer.from(await readAsset(path));
    if(bytes.length!==pinned[path].size||digest(bytes)!==pinned[path].sha256)throw new Error('Worker dependency hash mismatch: '+path);
    if(path===externalPath){
      if(/^\s*(?:import|export)\s+[^;]*\sfrom\s*["']|^\s*import\s*["']|\bimport\s*\(/m.test(bytes.toString('utf8')))throw new Error('Stable boot-assets dependency gained imports; review its graph explicitly');
      externals.set(path,bytes);return;
    }
    if(!/^\/linux\/dist\/[^/]+\.(?:m?js)$/.test(path))throw new Error('Unsupported worker dependency: '+path);
    const source=bytes.toString('utf8');sources.set(path,source);
    const imports=[...source.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/gm)].map(match=>match[1]);
    const dynamics=[...source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)].map(match=>match[2]);
    if(dynamics.length!==[...source.matchAll(/\bimport\s*\(/g)].length)throw new Error('Nonliteral dynamic worker import: '+path);
    for(const specifier of [...imports,...dynamics]){
      if(!specifier.startsWith('./')&&!specifier.startsWith('../'))throw new Error('Nonrelative worker import: '+specifier);
      const dependency=new URL(specifier,'https://build.invalid'+path).pathname;
      if(dependency===externalPath&&!(path===platformPath&&dynamics.includes(specifier)))throw new Error('Unexpected stable worker dependency');
      await visit(dependency);
    }
  }
  await visit('/linux/dist/worker.js');
  // This lazy web-only kernel-loader import must keep checking the stable system
  // manifest. Workers do not call it during startup; do not freeze update checks.
  sources.set(platformPath,replaceOnce(sources.get(platformPath),dynamicAssetImport,"import('/linux/boot-assets.mjs')"));
  const hasher=createHash('sha256');hasher.update('linuxonweb-worker-graph-v1\0');
  const inputs=[...sources].map(([path,source])=>[path,Buffer.from(source),false]).concat([...externals].map(([path,bytes])=>[path,bytes,true])).sort((a,b)=>a[0].localeCompare(b[0]));
  for(const [path,bytes,external]of inputs){hasher.update(JSON.stringify([path,bytes.length,external])+'\0');hasher.update(bytes);}
  const graphSHA256=hasher.digest('hex'),prefix='/_runtime_worker/'+graphSHA256;
  const assets=structuredClone(pinned),parts=new Map();
  function entry(bytes,original,immutable=false){
    const sha256=digest(bytes),path='/_runtime_assets/'+sha256+'.bin';parts.set(path,bytes);
    return {...original,size:bytes.length,sha256,parts:[{path,size:bytes.length}],...(immutable?{immutable:true}:{})};
  }
  for(const [path,source]of sources){
    const bytes=Buffer.from(source);
    assets[prefix+path]=entry(bytes,pinned[path],true);
  }
  const stablePlatform=replaceOnce((await readAsset(platformPath)).toString('utf8'),constructor,`new URL(${JSON.stringify(prefix+'/linux/dist/worker.js')}, module_url)`);
  assets[platformPath]=entry(Buffer.from(stablePlatform),pinned[platformPath]);
  return {assets,parts,metadata:{schema:1,graphSHA256,prefix,retentionRequirement:'Future releases must carry prior published graph routes and exact bytes to support cache-evicted active tabs; unknown hashes must remain 404.',stableExternalDependencies:[...externals.keys()],inputs:inputs.map(([path,bytes,external])=>({path,acceptedInputSHA256:pinned[path].sha256,acceptedInputSize:pinned[path].size,graphMemberSHA256:digest(bytes),graphMemberSize:bytes.length,external})),outputs:Object.fromEntries(Object.entries(assets).filter(([path])=>path===platformPath||path.startsWith(prefix+'/')).map(([path,asset])=>[path,{sha256:asset.sha256,size:asset.size}]))}};
}
