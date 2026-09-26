# Linux on Web — ChatGPT Sites

This public Sites deployment serves the complete Linux browser runtime through
a same-origin streaming proxy to `https://linuxonweb.testcatty.workers.dev`.
The page, kernel, guest archives, modules, DNS requests, and WebSocket TCP
connections all use the Sites hostname. Cloudflare holds the large versioned
runtime payloads; the Sites source archive contains the small proxy Worker.

The proxy forwards only selected runtime headers and never sends Sites cookies,
authorization, or identity headers to the upstream. WebSocket origins are
validated before they are rewritten for Cloudflare. Isolation headers are
preserved for shared WebAssembly memory. This preserves the existing runtime
without a cross-origin iframe or a separate launch page.

Run `npm test` and `npm run build` with Node.js 22+. The Sites artifact layout is
`dist/server/index.js`, `dist/client/index.html`, and `dist/.openai/hosting.json`.
Push the exact source commit to the Sites repository before saving a version;
build and archive from that same commit with:

```sh
npm run build
tar -czf linuxonweb-sites.tar.gz .openai/hosting.json dist
```

The archive must retain `dist/server/index.js` and the root
`.openai/hosting.json`. Publish the saved version with the normal Sites deploy
operation, preserving its public audience. The site project id is persisted in
`.openai/hosting.json`.

This directory is a separate Git repository for Sites source publishing.
The parent repository's source and guest images are not included in its pushes.
Its runtime depends on the Cloudflare Worker remaining available; an update to
that Worker updates the runtime served by this Site. Cloudflare outbound TCP
restrictions and destination-site blocking apply to guest browsing.
