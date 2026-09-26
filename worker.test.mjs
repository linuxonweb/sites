import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { proxy, UPSTREAM } from './worker.mjs';

test('streams runtime bytes and keeps Sites credentials out of upstream requests', async () => {
  const body = new Uint8Array([0, 1, 255, 42]);
  const response = await proxy(new Request('https://linuxonweb.example/linux/vmlinux.wasm?version=1', {
    headers: { Cookie: 'private_session=hidden', Authorization: 'Bearer hidden', 'X-OpenAI-User': 'hidden', Range: 'bytes=0-3', Accept: 'application/wasm' },
  }), async request => {
    assert.equal(request.url, `${UPSTREAM}/linux/vmlinux.wasm?version=1`);
    assert.equal(request.headers.get('Cookie'), null);
    assert.equal(request.headers.get('Authorization'), null);
    assert.equal(request.headers.get('X-OpenAI-User'), null);
    assert.equal(request.headers.get('Range'), 'bytes=0-3');
    return new Response(body, { status: 206, headers: { 'Content-Type': 'application/wasm', 'Content-Range': 'bytes 0-3/4', 'Set-Cookie': 'unexpected=hidden' } });
  });
  assert.equal(response.status, 206);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('only same-origin WebSocket requests get an upstream Origin rewrite; 101 object is untouched', async () => {
  const upgrade = { status: 101, webSocket: {} };
  const response = await proxy(new Request('https://linuxonweb.example/tcp?host=bing.com&port=443', { headers: { Origin: 'https://linuxonweb.example', Upgrade: 'websocket' } }), async request => {
    assert.equal(request.headers.get('Origin'), UPSTREAM);
    assert.equal(request.headers.get('Upgrade'), 'websocket');
    return upgrade;
  });
  assert.equal(response, upgrade);
  const rejectFetch = () => { throw new Error('Upstream should not be called'); };
  for (const origin of [null, 'https://attacker.example']) {
    const request = new Request('https://linuxonweb.example/tcp?host=bing.com&port=443', { headers: origin ? { Origin: origin } : {} });
    assert.equal((await proxy(request, rejectFetch)).status, 403);
  }
});

test('redirects keep the Sites origin and HEAD has no response body', async () => {
  const response = await proxy(new Request('https://linuxonweb.example/', { method: 'HEAD' }), async () => new Response(null, { status: 302, headers: { Location: `${UPSTREAM}/linux/index.html?firefox=1` } }));
  assert.equal(response.headers.get('Location'), 'https://linuxonweb.example/linux/index.html?firefox=1');
  assert.equal(response.body, null);
});

test('unrecognized paths and mutation methods cannot reach upstream', async () => {
  const rejectFetch = () => { throw new Error('Upstream should not be called'); };
  assert.equal((await proxy(new Request('https://linuxonweb.example/source/private'), rejectFetch)).status, 404);
  assert.equal((await proxy(new Request('https://linuxonweb.example/dns', { method: 'POST' }), rejectFetch)).status, 405);
});
