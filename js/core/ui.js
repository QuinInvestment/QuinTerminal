// Toasts and the side drawer (used for method notes, table views, settings).

import { h, $, mount, icon, ICONS } from "./dom.js";

export function toast(title, text = "", { sev = "info", ms = 6000 } = {}) {
  const wrap = $("#toasts");
  if (!wrap) return;
  const close = h("button", { type: "button", "aria-label": "Dismiss" }, icon(ICONS.close, 13));
  const el = h("div", { class: "toast " + sev, role: "status" }, h("div", { class: "bar" }), h("div", {}, h("div", { class: "tt" }, title), text ? h("div", { class: "ts" }, text) : null), close);
  close.onclick = () => el.remove();
  wrap.appendChild(el);
  while (wrap.children.length > 4) wrap.firstChild.remove();
  if (ms) setTimeout(() => el.remove(), ms);
}

let lastFocus = null;
export function openDrawer(title, content) {
  const d = $("#drawer");
  lastFocus = document.activeElement;
  mount($("#drawerTitle"), title);
  const body = $("#drawerBody");
  if (typeof content === "string") {
    body.innerHTML = "";
    body.appendChild(h("div", { class: "prose", html: content }));
  } else mount(body, content);
  d.hidden = false;
  $("#drawerClose").focus();
}

export function closeDrawer() {
  const d = $("#drawer");
  if (d.hidden) return false;
  d.hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  return true;
}

export function initDrawer() {
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
}
