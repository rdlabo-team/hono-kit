import type { MiddlewareHandler } from 'hono';

/**
 * レスポンス最終化ミドルウェア。Express/Nest（移植元 `../api`）との byte 一致のため 2 点を行う
 * （フリート共通仕様 = receptray/winecode hono と同一）:
 *
 * 1. **JSON の charset**: Express の res.json は `application/json; charset=utf-8` を返すが、
 *    Hono の c.json は `application/json`（charset 無し）なので合わせる。
 * 2. **weak ETag**: Express/`etag` パッケージ互換の
 *    `W/"<byteLength(16進)>-<sha1(body)をbase64して先頭27文字>"`。Express(=Nest) は GET 等のレスポンスに
 *    既定で付与するため、hono/etag の独自形式ではなく Express の算法に厳密一致させる。
 *
 * SSE（text/event-stream）はストリームを buffer できないため両方スキップ。
 */
async function weakEtag(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', body);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  const b64 = btoa(bin).substring(0, 27);
  return `W/"${body.byteLength.toString(16)}-${b64}"`;
}

export function finalizeResponse(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const status = c.res.status;
    const contentType = c.res.headers.get('content-type') ?? '';

    // SSE / ストリームは触らない。
    if (contentType.includes('text/event-stream')) {
      return;
    }

    // charset 補正対象（JSON で charset 未指定なら付与）。
    const needsCharset = contentType === 'application/json';
    // ETag 対象（Express は 204/304 では付けない・既存 ETag は尊重）。
    const needsEtag = status !== 204 && status !== 304 && !c.res.headers.has('etag') && !!c.res.body;

    if (!needsCharset && !needsEtag) {
      return;
    }

    const headers = new Headers(c.res.headers);
    if (needsCharset) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }

    if (needsEtag) {
      const buf = await c.res.clone().arrayBuffer();
      headers.set('ETag', await weakEtag(buf));
      c.res = new Response(buf, { status, statusText: c.res.statusText, headers });
    } else {
      // body を読まずヘッダだけ差し替え。
      c.res = new Response(c.res.body, { status, statusText: c.res.statusText, headers });
    }
  };
}
