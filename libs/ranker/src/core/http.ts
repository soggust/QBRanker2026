// Fetching for the browser: a URL's JSON, or a fallback when the request fails (offline, a 404, an API
// that's down: the page shows less rather than breaking), and promises made once and shared (each team's
// schedule, each day's scoreboard: asked once a visit, however many places want it)

export function fetchJson<T>(url: string, fallback: T, init?: RequestInit): Promise<T> {
  return fetch(url, init)
    .then((res) => (res.ok ? (res.json() as Promise<T>) : fallback))
    .catch(() => fallback);
}

// The cached promise for a key, made by load the first time it's asked for
export function memo<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  let promise = cache.get(key);
  if (!promise) cache.set(key, (promise = load()));
  return promise;
}
