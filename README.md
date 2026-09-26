# Linux on Web — ChatGPT Sites

The hybrid Sites Worker serves the pinned Linux runtime locally through its
`ASSETS` binding. Only `/dns`, `/tcp`, and `/__reload` retain the existing proxy
to `https://linuxonweb.testcatty.workers.dev`. No raw TCP implementation or
`cloudflare:sockets` import was moved into Sites. Proxy origin checks, credential
filtering, WebSocket forwarding and the public Sites hostname remain unchanged.

Accepted runtime routes retain their URLs, MIME types, SHA ETags,
HEAD/range responses and COOP/COEP/CORP isolation. Files larger than 20 MiB use
native streaming assembly. Missing local assets fail locally; they never fall
back to an older upstream rootfs. Physical parts use opaque
`/_runtime_assets/<sha256>.bin` paths, so logical routes pass through the Worker
even on asset-first routers. The temporary capability probe is removed.
The one derived stable module, `/linux/dist/platform.js`, selects the immutable
worker graph described below; all other accepted runtime bytes stay identical.

## Worker startup cache

Creating each guest thread loads a browser Worker and its JavaScript module
dependencies. Revalidating that graph on every spawn made the public console
boot take 74.71 seconds versus 4.69 seconds locally, despite matching actual
1 GiB/2 CPU configurations and virtually equal Wasm compile times. The measured
cause and observer limitations are recorded in `worker-startup-evidence.md`.
The derived build passes 10 unit and three workerd integration tests. Its lean
local browser boot reaches the shell in 2.733 seconds with matching actual
configuration and versioned worker requests; public performance acceptance is
pending. The first candidate boot with intrusive worker hooks timed out, while
the subsequent no-hook control passed; preserve both reports.

`worker-graph.mjs` derives `/_runtime_worker/<graph-sha256>/linux/dist/*` from
verified pinned inputs. It hashes sorted dependency paths and bytes, rejects
unresolved/nonliteral imports, and rewrites exactly one worker URL expression
in the stable platform module. No redirect or bundler is involved. Relative
module imports stay in this namespace and receive a one-year immutable cache
policy. The stable platform module and every other stable URL still revalidate.
Wrong graph hashes and absent paths return 404 rather than serving current bytes
under an old immutable identity. Worker diagnostic query parameters remain intact.

The platform's lazy `boot-assets.mjs` import explicitly resolves to its stable
URL, keeping system-manifest update checks live. Its input hash is also recorded
in the graph identity. `dist/runtime-assets.json` and
`dist/worker-graph-build.json` record the complete derived route hashes and input
provenance. Future releases must retain old graph assets if they promise that
old open tabs can create new workers after those tabs' cache entries are evicted;
otherwise those tabs require a reload. Rollback restores the matching artifact.

## Pinned inputs and reproducible build

`runtime-assets.mjs` records all 58 logical routes. `runtime-lock.json` pins the
55 staging parts (151,376,903 bytes), each SHA-256/length, the original manifest
and build-report hashes, and parent source commit
`f24b914113dee9132471298e5e3a97b2e69b2ceb`. Large guest binaries are external
locked build inputs, not silently copied from an unverified working tree.

Required snapshot layout: `public/`, `generated/asset-manifest.mjs`, and
`generated/build-report.json`. Preserve these exact inputs with release artifacts.
The current local snapshot is
`/mnt/p6/project/linux/.cache/runtime-graphics-20260926/sites-hybrid-input`.
Reconstruction from the parent checkout is acceptable only when every locked
hash matches. Missing inputs require recovering those bytes; ordinary builds
never repin or substitute newer files.

```sh
npm test
SITES_RUNTIME_INPUT=/path/to/reviewed-snapshot npm run build
node --check dist/server/index.js
npm run test:runtime
```

Node.js 22+ is required. Integration tests use the parent's already locked
`web/cloudflare` Miniflare/workerd dependency; install it using that directory's
package lock if absent. It is a test dependency, not a deployment dependency.
The tests stream/hash every accepted and derived route from the actual built
Worker, assert all accepted bytes except the reviewed platform rewrite remain
unchanged, and check range, HEAD, ETag, immutable/stable policy, isolation and
wrong-namespace behavior.

Build verifies every pinned input and stages output before replacing `dist`.
It deterministically concatenates the small first-party modules into one
`dist/server/index.js`, with no deployed relative or Node imports.
For a reviewed new release, freeze staging first, then run
`node pin-runtime.mjs SNAPSHOT_DIRECTORY FULL_PARENT_COMMIT` and review/commit
its manifest and lock. The current helper deliberately requires this release's
known counts. Do not repin merely to bypass a hash mismatch.

## Publication and limits

Reuse `.openai/hosting.json`'s project ID and preserve its public audience.
Push the exact nested source commit, build from it using locked inputs, and
package only deployment output and root metadata:

```sh
tar -czf linuxonweb-sites.tar.gz .openai/hosting.json dist
```

Save the archive as a Sites version before deployment. Archive ingestion and
production runtime validation are separate gates. The live capability probe
proved `ASSETS` could read a tiny committed file; it did not establish large
archive limits. This fallback avoids needing Cloudflare deployment credentials
for updated runtime assets, but networking still depends on the unchanged
Cloudflare backend and its outbound TCP restrictions.

After authorized publication, verify actual `/linux/boot-manifest.json`
version/hashes, full archive hashes, isolation, DNS/TCP/guest HTTPS and
persistence on the unchanged origin. Retain the prior saved Sites version for
rollback. Test fixtures, profile data, source trees and experimental PBL images
are excluded from deployment output.

Home storage and caches remain browser-origin data. Canvas2D is the measured
default, with optional host WebGL/WebGPU presentation. Guest native JIT,
Vulkan/OpenGL and hardware decoding are not added by that presentation path.
The PBL candidate was rejected after four of five workloads regressed;
the accepted Firefox executable remains in this pinned snapshot.
