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
configuration and versioned worker requests. Public version 5 subsequently
observed the matched lean console shell at 3.486 seconds first and 2.693 seconds
warm, versus version 4's 55.048 seconds in the matched lean comparison. These
are individual console observations, not a Firefox speedup ratio. The first
candidate boot with intrusive worker hooks timed out, while
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

The saved v9 `runtime-assets.mjs` records 58 logical routes. Its `runtime-lock.json` pins the
55 staging parts (151,569,304 bytes), each SHA-256/length, the original manifest
and build-report hashes, and parent source commit
`ae1648539f394d557ff067902599b002ec587c5d`. Large guest binaries are external
locked build inputs, not silently copied from an unverified working tree.

Required snapshot layout: `public/`, `generated/asset-manifest.mjs`, and
`generated/build-report.json`. Preserve these exact inputs with release artifacts.
The saved v9 local snapshot is
`/mnt/p6/build/firefox-tls-20260926/release-run1/release-src/web/cloudflare`.
Reconstruction from the parent checkout is acceptable only when every locked
hash matches. Missing inputs require recovering those bytes; ordinary builds
never repin or substitute newer files.

```sh
export TMPDIR=/mnt/p6/build/firefox-tls-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
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
For a reviewed new release, use the explicit `release-runtime.mjs` allowlist.
It includes the production renderer/translator modules whose current paths are
under `/linux/tests/`, while excluding fixture pages, runners, profiles, candidate
archives and source/build trees. Both production GPU callers leave compute
translation disabled; enabling it requires reviewing its additional closure.
The helper audits static/lazy module imports and module-relative asset/Worker
URLs, requires the selected working bytes to match the full root source commit,
and verifies all boot-image and accepted translator hashes. It also requires
the accepted Firefox 128 W3 decoder, SHA-256
`2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e` (377,315 bytes).
If not yet shipped in the root commit, the only permitted external override is
the explicitly pinned W3 build artifact; its path and hash enter provenance.

After root runtime acceptance and its source commit, prepare a fresh snapshot:

```sh
export TMPDIR=/mnt/p6/build/guest-jit-sites-20261002
export TMP="$TMPDIR" TEMP="$TMPDIR"
export SITES_RUNTIME_SOURCE=/mnt/p6/project/linux/linuxonweb
node web/sites/release-runtime.mjs audit "$SITES_RUNTIME_SOURCE" FULL_ROOT_COMMIT "$TMPDIR/runtime-audit.json"
node web/sites/release-runtime.mjs stage "$TMPDIR/runtime-audit.json" "$TMPDIR/runtime-snapshot"
cd web/sites
node pin-runtime.mjs "$TMPDIR/runtime-snapshot" FULL_ROOT_COMMIT "$TMPDIR/runtime-snapshot/generated/release-provenance.json"
npm test
```

Review the audit and generated release provenance before pinning. The latter
records exact routes, counts, source hashes, aliases, boot manifest, input
metadata hashes, helper hash and external inputs. Pinning recomputes all part
and logical hashes, checks its exact allowlist against that provenance, and
retains the 20 MiB part limit. Counts are release-specific audited inputs;
ordinary builds never repin. The new lock additionally hashes release provenance,
which build verifies and preserves in `dist/release-provenance.json`.
Do not repin merely to bypass a hash mismatch.

Commit only the reviewed nested source files and regenerated lock/manifest.
Build from that exact nested commit in a fresh checkout under the task's
disk-backed scratch directory, with `SITES_RUNTIME_INPUT` pointing at the frozen
snapshot and `SITES_RUNTIME_SOURCE` at the audited parent source checkout.
Run unit, syntax and runtime integration checks; workerd and browser checks must
wait for the exclusive guest validation lane to be released. Preserve the audit,
staging snapshot, root/nested commit IDs, build output, archive SHA-256 and saved
prior Sites version together. Only then package `.openai/hosting.json` and `dist`
as described below. The helper never publishes, accesses credentials, modifies
live runtime assets or reads browser profiles.

Historical v9 acceptance: the pinned rootfs version was `29331a186e50`.
That release changed only the
Firefox archive and boot manifest. The Wasm NSS fallback now resumes missing
CA trust records while retaining existing trust decisions, including explicit
distrust. New profiles receive a prepared CA store containing no private or
password-encryption keys; independent guest profiles generate distinct SDR keys.
The seed builder securely deletes/vacuums diagnostic key material before packing.
Only the Firefox module and two CA seed databases change inside the rootfs;
11,467 other CPIO records, init, preferences, kernel, plain image and worker graph
remain unchanged. Existing profile databases are preserved, with missing trust
records repaired in place.

The historical v9 actual-guest checks passed independent fresh-profile key isolation, cold/warm
input and JavaScript, HTTPS Bing, zero-image warm boot, real Update & restart,
old trust/key/home/download preservation, and rejection of a self-signed
certificate. Valid/replay/invalid/recovery media checks verify software decoding
and Web Audio delivery. These do not establish hardware decoding. The input
fixture waits for an actual guest readiness download and suppresses automatic
download-panel opening only in the test profile; earlier timing/focus failures
remain documented. See parent `docs/firefox-tls-bootstrap-20260926.md` and
`firefox-nss-seed-isolation.json` evidence. Public deployment acceptance remains
required; keep v8 and earlier saved versions for rollback.

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
rollback. Test fixture pages, profile data, source trees and experimental PBL
images are excluded from deployment output. Specifically allowlisted production
renderer/translator/decoder modules remain at their existing `/linux/tests/`
URLs; directory names do not authorize including other test assets.

The accepted successor runtime `ce0d881dec8c` adds Firefox's native Wasm loop
JIT and ships the existing GPU runtime dependencies. Its Firefox archive is
88,910,833 bytes, SHA-256
`ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745`.
The original eight release cases meet their median-ratio bounds; startup,
profile-preserving update and six-boot safety checks pass. The separately
audited compound-array workload is about 72.36 times faster than the previous
released runtime. Both comparisons against unpublished JIT7c retain FAIL
status, including its 14.516% longer-duration slowdown and unresolved cause;
the accepted release records this explicit engineering tradeoff. The original
and follow-up evidence remains retained. Local promotion passes its final
117-file evidence recheck. The committed boot manifest and hashed provenance
bind the release to exact image bytes; publication and public guest acceptance
remain separate gates. Sites v9 is the saved rollback version.

The JIT specializes supported numeric, array, property and Math loops;
other JavaScript continues through interpreter paths, with the reviewed
exception-script fallback policy. Existing guest Vulkan/OpenGL support and
the Firefox WebGPU decoder/executor groundwork ship as their current accepted
dependencies. This release does not establish completed Firefox WebGPU
canvas rendering or hardware video decoding. Public QA must close and reopen
the profile and explicitly update/reload, preserving the existing old-tab
worker-graph reload requirement.

Home storage and caches remain browser-origin data. Canvas2D is the measured
default, with optional host WebGL/WebGPU presentation. Guest native JIT,
Vulkan/OpenGL and hardware decoding are not added by that presentation path.
The historical PBL candidate was rejected after four of five workloads regressed;
the v9 executable retained the accepted interpreter and media fixes alongside the NSS repair.
