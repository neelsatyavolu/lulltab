import { getSettings, setSettings, clampIdleMinutes } from "../lib/settings.js";
import { parsePattern, describeRule, displayPattern, kindLabel } from "../lib/whitelist.js";
import { formatIdleMinutes } from "../lib/engine.js";

const $ = (id) => document.getElementById(id);
const demo = typeof chrome === "undefined" || !chrome.storage?.local;

let settings = {
  enabled: true,
  idleMinutes: 15,
  keepPinned: true,
  keepAudible: true,
  keepAsideChat: true,
  debug: false,
  usageStats: true,
  whitelist: [
    { id: "d1", kind: "domain", pattern: "mail.google.com" },
    { id: "d2", kind: "wildcard", pattern: "notion.so" },
  ],
};

init();

async function init() {
  if (!demo) settings = await getSettings();
  bind();
  render();
}

function bind() {
  $("enabled").addEventListener("change", () => save({ enabled: $("enabled").checked }));
  $("pinned").addEventListener("change", () => save({ keepPinned: $("pinned").checked }));
  $("audible").addEventListener("change", () => save({ keepAudible: $("audible").checked }));
  $("aside-chat").addEventListener("change", () => save({ keepAsideChat: $("aside-chat").checked }));
  $("debug").addEventListener("change", () => save({ debug: $("debug").checked }));
  $("usage-stats").addEventListener("change", () => save({ usageStats: $("usage-stats").checked }));
  $("idle-minutes").addEventListener("input", () => {
    const idle = formatIdleMinutes(clampIdleMinutes($("idle-minutes").value));
    $("idle-value").textContent = idle.value;
    $("idle-unit").textContent = idle.unit || "idle";
  });
  $("idle-minutes").addEventListener("change", () => {
    save({ idleMinutes: clampIdleMinutes($("idle-minutes").value) });
  });
  $("pattern").addEventListener("input", onPreview);
  $("add-form").addEventListener("submit", onAdd);
}

function render() {
  $("enabled").checked = settings.enabled;
  $("pinned").checked = settings.keepPinned;
  $("audible").checked = settings.keepAudible;
  $("aside-chat").checked = settings.keepAsideChat !== false;
  $("debug").checked = settings.debug === true;
  $("usage-stats").checked = settings.usageStats !== false;
  $("idle-minutes").value = String(settings.idleMinutes);
  const idle = formatIdleMinutes(settings.idleMinutes);
  $("idle-value").textContent = idle.value;
  $("idle-unit").textContent = idle.unit || "idle";

  const list = $("rules");
  list.innerHTML = "";
  if (!settings.whitelist.length) {
    const empty = document.createElement("li");
    empty.innerHTML = `<span>No rules yet — Gmail, Figma, and docs are common keeps.</span>`;
    list.append(empty);
    return;
  }
  for (const rule of settings.whitelist) {
    const li = document.createElement("li");
    const kind = document.createElement("span");
    kind.className = "pill mute";
    kind.textContent = kindLabel(rule.kind);
    const meta = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = displayPattern(rule);
    const desc = document.createElement("span");
    desc.textContent = describeRule(rule);
    meta.append(name, desc);
    const remove = document.createElement("button");
    remove.className = "btn ghost";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeRule(rule.id));
    li.append(kind, meta, remove);
    list.append(li);
  }
}

function onPreview() {
  $("error").hidden = true;
  const value = $("pattern").value.trim();
  if (!value) {
    $("preview").textContent = "";
    return;
  }
  try {
    $("preview").textContent = describeRule(parsePattern(value));
  } catch (error) {
    $("preview").textContent = "";
    $("error").hidden = false;
    $("error").textContent = error.message;
  }
}

async function onAdd(event) {
  event.preventDefault();
  const value = $("pattern").value.trim();
  try {
    const parsed = parsePattern(value);
    const exists = settings.whitelist.some(
      (rule) => rule.kind === parsed.kind && rule.pattern === parsed.pattern
    );
    if (!exists) {
      settings.whitelist = [
        ...settings.whitelist,
        { id: crypto.randomUUID(), ...parsed, createdAt: Date.now() },
      ];
      await save({ whitelist: settings.whitelist });
    }
    $("pattern").value = "";
    $("preview").textContent = "";
    $("error").hidden = true;
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent = error.message;
  }
}

async function removeRule(id) {
  settings.whitelist = settings.whitelist.filter((rule) => rule.id !== id);
  await save({ whitelist: settings.whitelist });
}

async function save(partial) {
  if (demo) {
    Object.assign(settings, partial);
    render();
    return;
  }
  settings = await setSettings(partial);
  render();
}
