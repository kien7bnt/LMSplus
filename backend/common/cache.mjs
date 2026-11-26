/**
 * LMSPLUS Scoped Read Cache (`backend/common/cache.mjs`)
 *
 * - Bounded LRU + TTL cache tầng dịch vụ nhằm giảm tải đọc lặp cho metadata (departments,
 *   attendance policy, facilities catalog, courses/outline).
 * - Bảo đảm Data Scope tuyệt đối: mọi key cache phải tách riêng theo `dbScope` (`db.targetLabel`)
 *   và `rbacScope` (role/department/user), và bị hủy ngay lập tức qua `invalidatePrefix(...)`
 *   mỗi khi có thao tác ghi (POST / PUT / PATCH / DELETE).
 * - Hỗ trợ `LMSPLUS_CACHE_TTL_MS` (`0` để tắt nhanh) và kiểm soát bộ nhớ qua `maxEntries`.
 */

const DEFAULT_TTL_MS = Math.max(0, Number(process.env.LMSPLUS_CACHE_TTL_MS ?? 15_000) || 15_000);
const MAX_ENTRIES = Math.max(100, Number(process.env.LMSPLUS_CACHE_MAX_ENTRIES ?? 2_000) || 2_000);

export function createScopedCache({ defaultTtlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES } = {}) {
  const store = new Map();
  let hits = 0;
  let misses = 0;

  function dbNs(db) {
    return String(db?.targetLabel || db?.dbPath || 'default');
  }

  function makeKey(db, namespace, scopeKey = 'global') {
    return `${dbNs(db)}|${namespace}|${scopeKey}`;
  }

  function get(key) {
    if (defaultTtlMs <= 0) return undefined;
    const entry = store.get(key);
    if (!entry) {
      misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      misses++;
      return undefined;
    }
    // LRU touch
    store.delete(key);
    store.set(key, entry);
    hits++;
    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    if (ttlMs <= 0 || defaultTtlMs <= 0) return value;
    if (store.has(key)) store.delete(key);
    while (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return value;
  }

  async function remember(db, namespace, scopeKey, loaderFn, ttlMs = defaultTtlMs) {
    const key = makeKey(db, namespace, scopeKey);
    const cached = get(key);
    if (cached !== undefined) return cached;
    const fresh = await loaderFn();
    return set(key, fresh, ttlMs);
  }

  function invalidatePrefix(db, namespacePrefix) {
    const prefix = db ? `${dbNs(db)}|${namespacePrefix}` : null;
    for (const k of Array.from(store.keys())) {
      if (prefix ? k.startsWith(prefix) : k.includes(`|${namespacePrefix}`)) {
        store.delete(k);
      }
    }
  }

  function clear() {
    store.clear();
  }

  function stats() {
    return {
      size: store.size,
      maxEntries,
      defaultTtlMs,
      hits,
      misses,
    };
  }

  return {
    makeKey,
    get,
    set,
    remember,
    invalidatePrefix,
    clear,
    stats,
  };
}

export const appCache = createScopedCache();
