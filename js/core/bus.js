// A minimal publish/subscribe store. Topics hold their last value so a panel
// that mounts late still receives the latest snapshot immediately.

const subs = new Map();
const state = new Map();
const stamps = new Map();

export function pub(topic, value) {
  state.set(topic, value);
  stamps.set(topic, Date.now());
  const list = subs.get(topic);
  if (!list) return;
  for (const fn of [...list]) {
    try { fn(value, topic); } catch (e) { console.error(`[bus] ${topic}`, e); }
  }
}

export function sub(topic, fn, { replay = true } = {}) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  if (replay && state.has(topic)) {
    try { fn(state.get(topic), topic); } catch (e) { console.error(`[bus] ${topic}`, e); }
  }
  return () => subs.get(topic)?.delete(fn);
}

export const get = (topic) => state.get(topic);
export const stamp = (topic) => stamps.get(topic) || 0;
export const has = (topic) => state.has(topic);

/** Collects unsubscribe functions so a module can drop all of them at once. */
export class Scope {
  constructor() { this.fns = []; this.timers = []; this.disposed = false; }
  sub(topic, fn, opts) { if (!this.disposed) this.fns.push(sub(topic, fn, opts)); return this; }
  add(fn) { if (typeof fn === "function") this.fns.push(fn); return this; }
  every(ms, fn, { now = true } = {}) {
    if (this.disposed) return this;
    if (now) Promise.resolve().then(() => { if (!this.disposed) return fn(); }).catch(() => {});
    const t = setInterval(() => { if (!document.hidden && !this.disposed) fn(); }, ms);
    this.timers.push(t);
    return this;
  }
  dispose() {
    this.disposed = true;
    this.fns.forEach((f) => { try { f(); } catch {} });
    this.timers.forEach(clearInterval);
    this.fns = []; this.timers = [];
  }
}
