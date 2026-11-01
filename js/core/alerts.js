// Alerts: user price rules plus signals raised by the modules (transit jumps,
// inventory surprises, probability swings). Each alert is de-duplicated,
// logged, shown as a toast and optionally pushed as a browser notification.

import { pub, get } from "./bus.js";
import { toast } from "./ui.js";
import { settings, save } from "./settings.js";
import { px } from "./fmt.js";

const LOG_MAX = 120;
const COOLDOWN = 30 * 60e3;
const log = [];
const lastFired = new Map();
let unseen = 0;

export function raise({ id, sev = "info", title, text = "", source = "", ts = Date.now(), quiet = false }) {
  const k = id || title;
  const prev = lastFired.get(k);
  if (prev && ts - prev < COOLDOWN) return false;
  lastFired.set(k, ts);
  const item = { id: k, sev, title, text, source, ts };
  log.unshift(item);
  if (log.length > LOG_MAX) log.pop();
  unseen++;
  pub("alerts", { log: [...log], unseen });
  if (!quiet) toast(title, text, { sev: sev === "info" ? "info" : sev });
  if (settings.notifications && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    try { new Notification("Quinterminal — " + title, { body: text, tag: k }); } catch {}
  }
  return true;
}

export const list = () => [...log];
export function markSeen() { unseen = 0; pub("alerts", { log: [...log], unseen }); }

// ---------------------------------------------------------------- price rules
const ruleState = new Map(); // rule id -> was condition true last time

export function evaluateRules(prices) {
  for (const r of settings.alertRules || []) {
    if (!r.on) continue;
    const v = prices[r.sym];
    if (!Number.isFinite(v)) continue;
    const cond = r.op === ">" ? v > r.value : v < r.value;
    const was = ruleState.get(r.id);
    ruleState.set(r.id, cond);
    if (cond && was === false) {
      raise({ id: "rule:" + r.id, sev: "warn", title: `${r.sym} ${r.op} ${r.value}`, text: `${r.sym} trades at ${px(v)} (rule crossed).`, source: "rule" });
    }
  }
}

export function addRule(sym, op, value) {
  const id = `${sym}-${op === ">" ? "hi" : "lo"}-${value}`;
  settings.alertRules = (settings.alertRules || []).filter((r) => r.id !== id);
  settings.alertRules.push({ id, sym, op, value, on: true });
  save();
  ruleState.delete(id);
  return id;
}

export function removeRule(id) {
  settings.alertRules = (settings.alertRules || []).filter((r) => r.id !== id);
  save();
}

export async function enableNotifications() {
  if (!("Notification" in window)) return false;
  const p = await Notification.requestPermission();
  settings.notifications = p === "granted";
  save();
  return settings.notifications;
}

export const unseenCount = () => (get("alerts")?.unseen ?? 0);
