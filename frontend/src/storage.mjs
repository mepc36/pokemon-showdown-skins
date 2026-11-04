// Safari can deny persistent storage in a third-party iframe. Keep the current
// connection usable; preferences/room IDs fall back to this frame's memory.
export function createStorage(getStorage = () => globalThis.localStorage) {
  const memory = new Map();
  return {
    getItem(key) { try { return getStorage().getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } },
    setItem(key, value) { memory.set(key, String(value)); try { getStorage().setItem(key, value); } catch {} },
    removeItem(key) { memory.delete(key); try { getStorage().removeItem(key); } catch {} },
  };
}
