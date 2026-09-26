# Public worker startup attribution — 2026-09-26

Two sequential warm-cache Chromium 150.0.7871.114 console boots used the same
profile, foreground visibility, 1280×720 Canvas2D, and actual 1 GiB/2 CPU guest
configuration. Host boot lines and guest memory/SMP lines verify the settings.
Both fetched zero kernel/rootfs images. Worker observations confirm secure,
cross-origin-isolated globals and available WebAssembly.Suspending/promising
and Atomics.waitAsync on both origins. The runtime does not select a JSPI branch.

| Observation | Localhost | Public Sites |
|---|---:|---:|
| Kernel message | 0.297 s | 1.258 s |
| Unpacking initramfs message | 1.587 s | 30.469 s |
| Init process message | 1.937 s | 36.767 s |
| Persistent home mounted | 3.920 s | 61.017 s |
| Shell prompt | 4.689 s | 74.706 s |
| Main kernel compileStreaming | 48.51 ms | 47.41 ms |
| 62 synchronous guest module compiles, total | 152.14 ms | 151.42 ms |
| Synchronous instances, total | 124.11 ms | 125.89 ms |
| spawn_worker imports, total | 2.204 s | 39.619 s |
| 29 measured Atomics waits, total | 2.184 s | 39.596 s |
| Post-boot script requests | 462 | 469 |
| Slowest script request | 46.84 ms | 2187.49 ms |

Script durations sum to 5.834 s locally and 268.303 s publicly; these requests
overlap and these sums are not wall time. All captured requests report status
200 and fromDiskCache=false. Public workers repeatedly load util, wasm, memory
adapter and Firefox callback modules while the guest waits for worker readiness.
The first boot worker takes about 900 ms from creation to kernel instantiation
on Sites versus 38 ms locally; instantiation itself takes about 1–2 ms on both.
All public logical assets previously used max-age=0,must-revalidate. The dominant
measured difference is repeated module-network latency, not Wasm compilation.
Kernel trace filtering did not establish an optimizing-tier policy difference.

Evidence: `.cache/runtime-profile-20260926/{local-r1,site-r1}-{report,trace}.json`
under the parent project directory. No Debugger or CPU Profiler was enabled.
Constructor/import wrappers, tracing, worker attachment and sampled syscall
timing add overhead; the instrumented local result is slower than the earlier
unprofiled 2.65 s observation. Worker resume precedes hook evaluation, so the
first constructor can race observation. Both successful runs recorded no errors.
The first, failed `local` report is preserved separately: injection while a
worker was startup-paused caused a harness timeout, fixed before these runs.

Earlier 71.30 s/2.65 s measurements recorded DOM settings but not authoritative
host/guest configuration. Preserve those as historical observations; the fresh
configuration-verified pair independently reproduces the large origin gap.
The immutable graph change passes 10 unit tests and three real workerd tests,
including hashes of every accepted and derived route. A lean real-browser local
candidate boot passes with shell at 2.733 seconds, actual 1 GiB/2 CPU, isolation,
70 versioned worker request starts and no page/console errors. Target discovery
without worker attachment reported no worker targets; URLs come from page
Network events. A separate stable manifest GET returns version fa0217b54d99
with must-revalidate; the warm active image cache did not automatically fetch a
new manifest during this boot.

The first candidate run with worker instrumentation stalled in a worker hook,
then the page poll timed out. It recorded 40 versioned workers and 266 cached
versus 38 network script responses, without a script HTTP failure or captured
guest RuntimeError. The subsequent no-hook/no-pause/no-trace control passes;
retain the failed observer evidence instead of treating it as a successful boot.
Public deployment acceptance is still required before claiming a delivered
speedup. The graph change does not
enable guest Firefox native JIT or guest GPU acceleration.
