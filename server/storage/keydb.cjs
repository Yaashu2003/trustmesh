class KeyDBStore {
  constructor() { this.entries = new Map(); this.reads = 0; this.writes = 0; }
  set(key, value, ttlMs = 15 * 60 * 1000) {
    this.entries.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMs });
    this.writes++;
  }
  get(key) {
    this.reads++;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { this.entries.delete(key); return null; }
    return structuredClone(entry.value);
  }
  delete(key) { return this.entries.delete(key); }
  clear() { this.entries.clear(); this.reads = 0; this.writes = 0; }
  stats() { return { keys: this.entries.size, reads: this.reads, writes: this.writes, mode: 'in-memory development adapter' }; }
}

module.exports = { KeyDBStore };
