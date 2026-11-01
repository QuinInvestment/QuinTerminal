// Command line. Functions are reached by mnemonic (HRMZ, CRV, FCST...), with
// optional arguments (MAP HORMUZ, OPT 110 30, ALERT BRENT > 120). Ctrl+K or "/"
// focuses it; arrow keys walk the suggestions; Enter runs.

import { h, mount, $ } from "./dom.js";

const commands = [];

export function register(cmd) {
  commands.push({ aliases: [], args: "", ...cmd });
}

export function find(word) {
  const w = word.toUpperCase();
  return commands.find((c) => c.code === w || c.aliases.includes(w));
}

export function run(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  const [head, ...rest] = s.split(/\s+/);
  const c = find(head.replace(/<GO>$/i, ""));
  if (c) { c.run(rest.join(" ")); return true; }
  // Unknown word: treat as a news search
  const news = find("NEWS");
  if (news) { news.run(s); return true; }
  return false;
}

export function all() { return [...commands]; }

export function initCommandLine() {
  const input = $("#cmdInput");
  const box = $("#cmdSug");
  let items = [], sel = -1;

  const suggest = () => {
    const v = input.value.trim().toUpperCase();
    const head = v.split(/\s+/)[0] || "";
    const rank = (c) => {
      if (!head) return c.order ?? 50;
      if (c.code === head || c.aliases.includes(head)) return 0;
      if (c.code.startsWith(head)) return 1;
      if (c.aliases.some((a) => a.startsWith(head))) return 2;
      if (c.label.toUpperCase().includes(head)) return 3;
      return 99;
    };
    items = commands.map((c) => [rank(c), c]).filter(([r]) => r < 99).sort((a, b) => a[0] - b[0]).slice(0, 12).map((x) => x[1]);
    sel = items.length ? 0 : -1;
    paint();
  };

  const paint = () => {
    if (!items.length) { box.hidden = true; return; }
    mount(box, items.map((c, i) =>
      h("button", { type: "button", role: "option", "aria-selected": i === sel ? "true" : "false", onmousedown: (e) => { e.preventDefault(); pick(i, true); } },
        h("span", { class: "c" }, c.code + (c.args ? " " + c.args : "")),
        h("span", { class: "d" }, c.label),
        h("span", { class: "k" }, c.key || ""))));
    box.hidden = false;
  };

  const pick = (i, exec) => {
    const c = items[i];
    if (!c) return;
    const rest = input.value.trim().split(/\s+/).slice(1).join(" ");
    if (exec) {
      input.value = "";
      box.hidden = true;
      input.blur();
      c.run(rest);
    } else {
      input.value = c.code + " ";
      suggest();
    }
  };

  input.addEventListener("input", suggest);
  input.addEventListener("focus", suggest);
  input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === "Tab" && items.length) { e.preventDefault(); pick(Math.max(0, sel), false); }
    else if (e.key === "Escape") { input.value = ""; box.hidden = true; input.blur(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const v = input.value.trim();
      const head = v.split(/\s+/)[0] || "";
      if (find(head) || !items.length || sel < 0) { input.value = ""; box.hidden = true; input.blur(); run(v); }
      else pick(sel, true);
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); input.select(); return; }
    if (!typing && e.key === "/") { e.preventDefault(); input.focus(); return; }
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const c = commands.find((x) => x.key && x.key === e.key);
      if (c) { e.preventDefault(); c.run(""); }
    }
    if (e.altKey && /^[0-9]$/.test(e.key)) {
      const c = commands.find((x) => x.alt === e.key);
      if (c) { e.preventDefault(); c.run(""); }
    }
  });
}
