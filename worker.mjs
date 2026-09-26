import runtimeAssets from './runtime-assets.mjs';
import { handleAsset } from './asset-handler.mjs';
// All runtime requests stay on the Sites origin, including the guest TCP bridge.
export const UPSTREAM = 'https://linuxonweb.testcatty.workers.dev';
const forwardedHeaders = new Set([
  'accept', 'accept-language', 'cache-control', 'if-modified-since',
  'if-none-match', 'range', 'if-range', 'origin', 'upgrade', 'connection',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol',
  'sec-websocket-extensions',
]);
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function error(message, status) {
  return new Response(message, { status, headers: { ...isolation, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function proxy(request, upstreamFetch = fetch) {
  const incoming = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) return error('Method not allowed', 405);
  const path = incoming.pathname;
  if (!(path === '/' || path === '/dns' || path === '/tcp' || path === '/__reload' || path.startsWith('/linux/') || path.startsWith('/desktop/') || path.startsWith('/upstream/'))) return error('Not found', 404);
  const origin = request.headers.get('Origin');
  // Check the browser's origin before presenting a same-origin request upstream.
  if (origin && origin !== incoming.origin) return error('Cross-origin request forbidden', 403);
  if (path === '/tcp' && !origin) return error('WebSocket Origin required', 403);
  const upstream = new URL(UPSTREAM);
  upstream.pathname = path;
  upstream.search = incoming.search;
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (forwardedHeaders.has(name.toLowerCase())) headers.set(name, value);
  }
  if (origin) headers.set('Origin', UPSTREAM);
  // No Sites cookies, auth headers, identity headers, or URL credentials leave here.
  const response = await upstreamFetch(new Request(upstream, { method: request.method, headers, redirect: 'manual' }));
  if (response.status === 101) return response;
  const responseHeaders = new Headers(response.headers);
  for (const [name, value] of Object.entries(isolation)) responseHeaders.set(name, value);
  responseHeaders.delete('Set-Cookie');
  const location = responseHeaders.get('Location');
  if (location) {
    const redirect = new URL(location, UPSTREAM);
    if (redirect.origin === UPSTREAM) responseHeaders.set('Location', `${incoming.origin}${redirect.pathname}${redirect.search}${redirect.hash}`);
  }
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/dns' || path === '/tcp' || path === '/__reload') return await proxy(request);
      if (!['GET', 'HEAD'].includes(request.method)) return error('Method not allowed', 405);
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) return error('Cross-origin request forbidden', 403);
      return await handleAsset(request, env, runtimeAssets);
    }
    catch { return error('Linux runtime temporarily unavailable', 502); }
  },
};
