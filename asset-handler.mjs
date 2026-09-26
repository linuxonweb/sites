// Asset serving copied from the accepted Cloudflare Worker; network stays proxied.
const assetIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};
function assetReply(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...assetIsolation, ...headers } });
}
export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function chunkStream(env, entry, start, end) {
  let index = 0, offset = 0, reader = null, position = 0, partEnd = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          if (!reader) {
            if (index === entry.parts.length || offset > end) { controller.close(); return; }
            const part = entry.parts[index++];
            const partStart = offset;
            offset += part.size;
            if (offset <= start) continue;
            const localStart = Math.max(0, start - partStart);
            const localEnd = Math.min(part.size - 1, end - partStart);
            const response = await env.ASSETS.fetch(new Request(`https://assets.local${part.path}`, {
              headers: { Range: `bytes=${localStart}-${localEnd}` },
            }));
            if (cancelled) { await response.body?.cancel(); return; }
            if ((response.status !== 200 && response.status !== 206) || !response.body) throw new Error('Asset chunk unavailable');
            // Honor a partial response, but stream and clip a full response when
            // the asset binding does not implement Range (as in local Miniflare).
            position = response.status === 206 ? partStart + localStart : partStart;
            partEnd = partStart + localEnd;
            reader = response.body.getReader();
          }
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) { reader.releaseLock(); reader = null; continue; }
          const lo = Math.max(0, start - position);
          const hi = Math.min(value.byteLength, partEnd - position + 1);
          position += value.byteLength;
          if (hi > lo) controller.enqueue(value.subarray(lo, hi));
          if (position > partEnd) { await reader.cancel(); reader.releaseLock(); reader = null; }
          if (hi > lo) return;
        }
      } catch (error) {
        await reader?.cancel().catch(() => {});
        controller.error(error);
      }
    },
    async cancel() { cancelled = true; await reader?.cancel(); },
  });
  // Workers derives Content-Length from a fixed-length stream, and detects any
  // truncated chunk instead of returning a silently incomplete initramfs.
  return stream.pipeThrough(new FixedLengthStream(end - start + 1));
}

async function completeAssetStream(env, entry) {
  // Acquire the small fixed set of part responses before committing HTTP 200.
  // Missing local parts must fail locally, never fall back to an old rootfs.
  const responses = [];
  try {
    for (const part of entry.parts) {
      const response = await env.ASSETS.fetch(`https://assets.local${part.path}`);
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error('Asset chunk unavailable');
      }
      responses.push(response);
    }
  } catch (error) {
    await Promise.allSettled(responses.map(response => response.body.cancel()));
    throw error;
  }
  const output = new FixedLengthStream(entry.size);
  // Keep complete downloads in native stream pumps. Reading/enqueueing every
  // 64KiB chunk in JavaScript can exceed the Free plan's CPU budget for an 88MB
  // initramfs even though the response remains below its memory budget.
  void (async () => {
    try {
      for (const response of responses) {
        await response.body.pipeTo(output.writable, { preventClose: true });
      }
      await output.writable.close();
    } catch (error) {
      await output.writable.abort(error).catch(() => {});
    }
  })();
  return output.readable;
}

export async function handleAsset(request, env, assets) {
  const url = new URL(request.url);
  if (url.pathname === '/') {
    url.pathname = '/linux/index.html';
    if (!url.searchParams.has('firefox')) url.searchParams.set('firefox', '1');
    return assetReply(null, 302, { Location: url.pathname + url.search, 'Cache-Control': 'no-store' });
  }
  if (url.pathname === '/linux' || url.pathname === '/linux/' || url.pathname === '/desktop' || url.pathname === '/desktop/') {
    url.pathname = url.pathname.startsWith('/linux') ? '/linux/index.html' : '/desktop/index.html';
  }
  const entry = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
  if (!entry) return assetReply('Not found', 404);
  const etag = `"${entry.sha256}"`;
  const headers = {
    ...assetIsolation, 'Content-Type': entry.contentType, 'Cache-Control': entry.immutable && /^\/_runtime_worker\/[a-f0-9]{64}\/linux\/dist\/[^/]+\.(?:m?js)$/.test(url.pathname) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    ETag: etag, 'Accept-Ranges': 'bytes', 'Content-Length': String(entry.size),
  };
  if (request.headers.get('If-None-Match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
    delete headers['Content-Length'];
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') return new Response(null, { headers });
  let range = null;
  if (request.headers.has('Range') && (!request.headers.has('If-Range') || request.headers.get('If-Range') === etag)) {
    range = parseRange(request.headers.get('Range'), entry.size);
    if (!range) return assetReply(null, 416, { 'Content-Range': `bytes */${entry.size}` });
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${entry.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
  }
  // Route every range through the clipping stream: ASSETS can return the full
  // body with 200 instead of honoring Range (including in the local runtime).
  if (entry.parts.length === 1 && !range) {
    const target = new URL(request.url);
    target.pathname = entry.parts[0].path;
    target.search = '';
    const response = await env.ASSETS.fetch(new Request(target));
    if (response.status !== 200) return assetReply('Asset unavailable', 502);
    return new Response(response.body, { status: 200, headers });
  }
  const body = range ? chunkStream(env, entry, range.start, range.end) : await completeAssetStream(env, entry);
  return new Response(body, {
    status: range ? 206 : 200, headers,
  });
}
