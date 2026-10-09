// One fetch for the data scripts (apps/<sport>/scripts/update-data.mjs, MMA's fights.mjs): a URL's body,
// tried again on a failure, each try held to a timeout (a source that hangs would hold the nightly run
// until GitHub stops it hours later). Each script keeps its own pace and cache around it.
//
//   fetchRetry(url, { as: 'json', attempts: 3, backoff: 1500, notFound: null })
//
// Options:
//   as         'text' (the default), 'json' or 'buffer' (a Buffer of the bytes)
//   headers    the request's headers (a User-Agent)
//   attempts   tries before it gives up, throwing the last error (default 3)
//   backoff    the wait after a failed try, times the try's number: 1500 waits 1.5s, then 3s (default 1500)
//   timeout    each try's limit in ms, the body read included (default 30000)
//   notFound   what a 404 answers, without trying again (left out: a 404 is a failure like any other)
//   rateLimit  how many 429s it waits out (Retry-After's seconds, else 30), on top of the attempts (default 0)
//   before     awaited before each try (a script's polite pace)
//   fetch      the fetch to use (tests)
export const TIMEOUT = 30000;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export async function fetchRetry(url, options = {}) {
  const { as = 'text', headers, attempts = 3, backoff = 1500, timeout = TIMEOUT, rateLimit = 0, before, fetch: fetchIt = globalThis.fetch } = options;
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    if (before) await before();
    try {
      const signal = AbortSignal.timeout(timeout);
      const res = await fetchIt(url, { headers, signal });
      if (res.status === 404 && 'notFound' in options) return options.notFound;
      // (rate-limited: wait as long as the source asks, then try again, not counted as a try)
      if (res.status === 429 && waited < rateLimit) {
        waited++;
        attempt--;
        await sleep((Number(res.headers?.get?.('retry-after')) || 30) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status}${res.statusText ? ` ${res.statusText}` : ''} for ${url}`);
      if (as === 'json') return await res.json();
      if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
      return await res.text();
    } catch (err) {
      if (attempt >= attempts) {
        // (a timeout or a dropped connection says nothing of the URL: named here)
        if (String(err?.message).includes(url)) throw err;
        throw new Error(`${err?.message ?? err} for ${url}`, { cause: err });
      }
      await sleep(backoff * attempt);
    }
  }
}
