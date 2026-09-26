# Linux on Web — ChatGPT Sites

The hybrid Sites Worker serves the pinned Linux runtime locally through its
`ASSETS` binding. Only `/dns`, `/tcp`, and `/__reload` retain the existing proxy
to `https://linuxonweb.testcatty.workers.dev`. No raw TCP implementation or
`cloudflare:sockets` import was moved into Sites. Proxy origin checks, credential
filtering, WebSocket forwarding and the public Sites hostname remain unchanged.

Runtime routes retain their URLs, MIME types, byte lengths, SHA ETags,
HEAD/range responses and COOP/COEP/CORP isolation. Files larger than 20 MiB use
native streaming assembly. Missing local assets fail locally; they never fall
back to an older upstream rootfs. Physical parts use opaque
`/_runtime_assets/<sha256>.bin` paths, so logical routes pass through the Worker
even on asset-first routers. The temporary capability probe is removed.

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
The tests stream/hash all 58 routes from the actual built Worker and check a
cross-part range, HEAD, ETag, isolation and missing-route behavior.

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
