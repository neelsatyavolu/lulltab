import { IDLE_PRESETS } from "../lib/settings.js";
import {
  formatDuration,
  formatIdleMinutes,
  hostnameOf,
  faviconLetter,
  reasonLabel,
  isInternalUrl,
} from "../lib/engine.js";
import {
  formatBytes,
  formatBytesParts,
  sortMemoryRows,
  sumAwakeBytes,
} from "../lib/memory.js";
import { formatDebugTime } from "../lib/debug.js";

const $ = (id) => document.getElementById(id);
const demo = typeof chrome === "undefined" || !chrome.runtime?.id;
const ROSTER_MAX = 6;
const MEM_MAX = 7;
const DEBUG_MAX = 6;

let state = demo ? demoState() : null;
let memory = demo ? demoMemory() : null;
let debug = demo ? demoDebug() : null;
let view = "still";
let wordmarkClicks = [];
let memoryTimer = null;
let memoryFlight = null;
let idleAnchor = null;
let actionError = "";

init();

async function init() {
  if (demo) $("demo").hidden = false;
  $("toggle").addEventListener("click", onToggle);
  $("sleep").addEventListener("click", () => act("SLEEP_TAB", { tabId: state?.currentTab?.id }));
  $("keep").addEventListener("click", onKeep);
  $("sleep-others").addEventListener("click", () => act("SLEEP_OTHERS"));
  $("idle").addEventListener("input", onIdlePreview);
  $("idle").addEventListener("change", onIdleCommit);
  $("ram-refresh").addEventListener("click", () => loadMemory());
  $("debug-copy").addEventListener("click", copyDebugReport);
  $("debug-clear").addEventListener("click", () => act("CLEAR_DEBUG"));
  $("wordmark").addEventListener("click", onWordmark);
  const segment = document.querySelector(".segment");
  for (const button of segment.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  segment.addEventListener("keydown", onTabKey);
  $("options").addEventListener("click", (event) => {
    if (!demo && chrome.runtime.openOptionsPage) {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    }
  });
  await refresh();
}

async function refresh() {
  if (!demo) {
    try {
      let windowId;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        windowId = tab?.windowId;
      } catch {
        windowId = undefined;
      }
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE", windowId });
      if (!response?.ok) {
        actionError = actionError || response?.error || "Couldn’t reach Lulltab.";
        render();
        return;
      }
      state = response;
    } catch (error) {
      actionError = actionError || error?.message || "Couldn’t reach Lulltab.";
      render();
      return;
    }
  }
  render();
  if (view === "memory") await loadMemory();
  if (view === "debug") await loadDebug();
}

function render() {
  if (!state?.settings) {
    if (actionError) $("why").textContent = actionError;
    return;
  }
  const settings = state.settings;
  $("toggle").setAttribute("aria-checked", settings.enabled ? "true" : "false");
  document.body.classList.toggle("is-off", !settings.enabled && view === "still");
  $("tab-debug").hidden = !settings.debug;
  document.querySelector(".segment").classList.toggle("debug-on", settings.debug);
  if (!settings.debug && view === "debug") view = "still";

  for (const button of document.querySelectorAll(".segment [data-view]")) {
    button.setAttribute("aria-selected", button.dataset.view === view ? "true" : "false");
  }
  $("view-still").hidden = view !== "still";
  $("view-memory").hidden = view !== "memory";
  $("view-debug").hidden = view !== "debug";

  if (view === "still") renderStill();
  if (view === "memory") renderMemory();
  if (view === "debug") renderDebug();
}

function renderStill() {
  const settings = state.settings;
  const current = state.currentTab;
  const presetIndex = nearestPreset(settings.idleMinutes);
  if (document.activeElement !== $("idle")) {
    $("idle").value = String(presetIndex);
    idleAnchor = presetIndex;
    paintIdle(settings.idleMinutes);
  }

  if (!current) {
    $("title").textContent = "This tab";
    $("host").textContent = "—";
    $("status").textContent = "—";
    $("why").textContent = "Open a page to manage it.";
    $("sleep").disabled = true;
    $("keep").disabled = true;
  } else {
    $("title").textContent = current.title || "Tab";
    $("host").textContent = hostnameOf(current.url) || current.url || "This tab";
    paintFav($("fav"), current);
    const sleeping = current.discarded;
    $("status").textContent = sleeping ? "Sleeping" : "Awake";
    $("why").textContent = currentWhy(current, settings);
    $("sleep").disabled = isInternalUrl(current.url) || sleeping || current.reason === "aside-chat";
    $("sleep").textContent = sleeping ? "Sleeping" : "Sleep";
    const kept = current.reason === "whitelist";
    $("keep").disabled = current.reason === "internal" || kept;
    $("keep").classList.toggle("kept", kept);
    $("keep").setAttribute("aria-label", kept ? "Site kept" : "Keep site");
  }

  if (actionError) $("why").textContent = actionError;
  else if (!settings.enabled) $("why").textContent = "Paused. Tabs won’t sleep on their own.";

  const tabs = (state.tabs || []).filter(isWebTab);
  const awake = tabs.filter((tab) => !tab.discarded);
  const asleep = tabs.filter((tab) => tab.discarded);
  $("counts").textContent = `${awake.length} open · ${asleep.length} sleeping`;
  const list = $("roster");
  list.innerHTML = "";
  const openShow = awake.slice(0, 3);
  const sleepShow = asleep.slice(0, 3);
  if (!openShow.length && !sleepShow.length) {
    list.append(emptyRow("No tabs."));
    return;
  }
  if (openShow.length) {
    list.append(groupRow("Open"));
    for (const tab of openShow) list.append(tabRow(tab));
  }
  if (sleepShow.length) {
    list.append(groupRow("Sleeping"));
    for (const tab of sleepShow) list.append(tabRow(tab));
  }
  const extra = awake.length - openShow.length + (asleep.length - sleepShow.length);
  if (extra > 0) list.append(moreRow(extra));
}

function renderMemory() {
  if (!memory) return;
  const measured = memory.source && memory.source !== "none";
  const parts = measured ? formatBytesParts(memory.awakeBytes) : { value: "—", unit: "" };
  $("ram-value").textContent = parts.value;
  $("ram-unit").textContent = parts.unit || (measured ? "RAM" : "");
  const free = memory.system?.availableCapacity;
  const bits = [`${memory.counts.sleeping} sleeping`];
  if (free != null) bits.push(`${formatBytes(free)} free`);
  if (memory.source === "heap") bits.push("JS heap");
  $("ram-sub").textContent = bits.join(" · ");
  const note = $("ram-note");
  if (memory.source === "none") {
    note.hidden = false;
    note.textContent =
      "This browser isn’t reporting per-tab RAM yet. Sleeping tabs still show as unloaded.";
  } else if (memory.source === "heap") {
    note.hidden = false;
    note.textContent = "Showing JavaScript heap per tab (Aside isn’t exposing full process RAM).";
  } else {
    note.hidden = true;
  }

  const list = $("ram-list");
  list.innerHTML = "";
  const rows = sortMemoryRows(memory.rows || []);
  const max = Math.max(1, ...rows.map((row) => (row.discarded ? 0 : Number(row.bytes) || 0)));
  if (!rows.length) {
    list.append(emptyRow("No tabs."));
    return;
  }
  const web = rows.filter(isWebTab);
  if (!web.length) {
    list.append(emptyRow("No tabs."));
    return;
  }
  const awake = web.filter((tab) => !tab.discarded);
  const asleep = web.filter((tab) => tab.discarded);
  const openShow = awake.slice(0, 4);
  const sleepShow = asleep.slice(0, 3);
  if (openShow.length) {
    list.append(groupRow("Open"));
    for (const tab of openShow) list.append(memoryRow(tab, max));
  }
  if (sleepShow.length) {
    list.append(groupRow("Sleeping"));
    for (const tab of sleepShow) list.append(memoryRow(tab, max));
  }
  const extra = awake.length - openShow.length + (asleep.length - sleepShow.length);
  if (extra > 0) list.append(moreRow(extra));
}

function renderDebug() {
  if (!debug) return;
  $("debug-counts").textContent = `${debug.counts?.sleeping ?? 0} sleeping · ${debug.counts?.total ?? 0} tabs`;
  const probes = $("probes");
  probes.innerHTML = "";
  const flags = [
    ["processes", "RAM API"],
    ["systemMemory", "system"],
    ["sessionStorage", "session"],
    ["alarms", "alarms"],
    ["contextMenus", "menus"],
  ];
  for (const [key, label] of flags) {
    const pill = document.createElement("span");
    const on = Boolean(debug.probes?.[key]);
    pill.className = `pill ${on ? "sage" : "mute"}`;
    pill.textContent = `${label} ${on ? "on" : "off"}`;
    probes.append(pill);
  }
  const list = $("debug-log");
  list.innerHTML = "";
  const entries = [...(debug.log || [])].reverse();
  if (!entries.length) {
    list.append(emptyRow("No events yet. Leave debug on and use the extension."));
    return;
  }
  for (const entry of entries.slice(0, DEBUG_MAX)) {
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = formatDebugTime(entry.t);
    const name = document.createElement("strong");
    name.textContent = entry.event;
    const detail = { ...entry };
    delete detail.t;
    delete detail.event;
    const span = document.createElement("span");
    const keys = Object.keys(detail);
    span.textContent = keys.length ? " " + keys.map((key) => `${key}=${detail[key]}`).join(" · ") : "";
    li.append(time, name, span);
    list.append(li);
  }
}

function isWebTab(tab) {
  const url = tab.url || "";
  return /^(https?|ftp):/i.test(url);
}

function emptyRow(text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text;
  return li;
}

function groupRow(label) {
  const li = document.createElement("li");
  li.className = "group";
  li.textContent = label;
  return li;
}

function moreRow(count) {
  const li = document.createElement("li");
  li.className = "more";
  li.textContent = `+${count} more`;
  return li;
}

function tabRow(tab) {
  const li = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("strong");
  name.textContent = tab.title || hostnameOf(tab.url) || "Tab";
  const sub = document.createElement("div");
  sub.className = "host";
  sub.textContent = hostnameOf(tab.url) || "";
  meta.append(name, sub);
  const action = document.createElement("button");
  action.className = "btn";
  action.type = "button";
  if (tab.discarded) {
    action.textContent = "Wake";
    action.addEventListener("click", () => act("WAKE_TAB", { tabId: tab.id }));
  } else {
    action.textContent = "Sleep";
    action.disabled = tab.active || isInternalUrl(tab.url) || tab.reason === "aside-chat";
    if (action.disabled) {
      action.title = tab.active
        ? "This tab is open"
        : tab.reason === "aside-chat"
          ? "Aside chat is running"
          : "Browser pages stay loaded";
    }
    action.addEventListener("click", () => act("SLEEP_TAB", { tabId: tab.id }));
  }
  li.append(meta, action);
  return li;
}

function memoryRow(tab, max) {
  const li = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("strong");
  name.textContent = tab.title || hostnameOf(tab.url) || "Tab";
  const sub = document.createElement("div");
  sub.className = "host";
  const host = hostnameOf(tab.url) || "";
  sub.textContent = tab.sharedWith > 1 && !tab.discarded ? `${host} · shared` : host;
  meta.append(name, sub);
  const bytes = document.createElement("span");
  bytes.className = `mem-bytes${tab.discarded ? " sleep" : ""}`;
  bytes.textContent = tab.discarded ? "asleep" : formatBytes(tab.bytes);
  const action = document.createElement("button");
  action.className = "btn";
  action.type = "button";
  if (tab.discarded) {
    action.textContent = "Wake";
    action.addEventListener("click", () => act("WAKE_TAB", { tabId: tab.id }));
  } else {
    action.textContent = "Sleep";
    action.disabled = tab.active || tab.canSleep === false;
    if (action.disabled) action.title = tab.active ? "This tab is open" : "This tab stays awake";
    action.addEventListener("click", () => act("SLEEP_TAB", { tabId: tab.id }));
  }
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = `${tab.discarded || !tab.bytes ? 0 : Math.max(4, Math.round((tab.bytes / max) * 100))}%`;
  bar.append(fill);
  li.append(meta, bytes, action, bar);
  return li;
}

function currentWhy(tab, settings) {
  if (tab.discarded) return "Unloaded. Wake restores it.";
  if (tab.reason === "fresh") {
    return `Idle ${formatDuration(tab.idleMs)}. Sleeps in ${formatDuration(tab.remainingMs)} (${settings.idleMinutes}m window).`;
  }
  return reasonLabel(tab.reason);
}

async function setView(next) {
  view = next;
  if (memoryTimer) {
    clearInterval(memoryTimer);
    memoryTimer = null;
  }
  if (view === "memory") {
    await loadMemory();
    memoryTimer = setInterval(() => loadMemory(), 4000);
  }
  if (view === "debug") await loadDebug();
  render();
}

async function loadMemory() {
  if (demo) {
    renderMemory();
    return;
  }
  if (memoryFlight) return memoryFlight;
  memoryFlight = (async () => {
    let failed = "";
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_MEMORY" });
      if (response?.ok) memory = response;
      else failed = response?.error || "Couldn’t read memory. Try refresh.";
    } catch {
      failed = "Couldn’t read memory. Try refresh.";
    } finally {
      memoryFlight = null;
    }
    renderMemory();
    if (failed) {
      const note = $("ram-note");
      note.hidden = false;
      note.textContent = failed;
    }
  })();
  return memoryFlight;
}

async function loadDebug() {
  if (demo) {
    renderDebug();
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_DEBUG" });
    if (response?.ok) debug = response;
  } catch {
    /* leave the last log on screen */
  }
  renderDebug();
}

async function onToggle() {
  if (!demo && !state?.settings) return;
  const enabled = $("toggle").getAttribute("aria-checked") !== "true";
  await act("SET_SETTINGS", { partial: { enabled } });
}

function onIdlePreview(event) {
  paintIdle(IDLE_PRESETS[Number(event.target.value)] || 15);
}

async function onIdleCommit(event) {
  const index = Number(event.target.value);
  if (index === idleAnchor) {
    if (state?.settings) paintIdle(state.settings.idleMinutes);
    return;
  }
  const minutes = IDLE_PRESETS[index] || 15;
  paintIdle(minutes);
  await act("SET_SETTINGS", { partial: { idleMinutes: minutes } });
}

function paintIdle(minutes) {
  const idle = formatIdleMinutes(minutes);
  $("idle-value").textContent = idle.value;
  $("idle-unit").textContent = idle.unit;
  $("idle").setAttribute("aria-valuetext", [idle.value, idle.unit].filter(Boolean).join(" "));
}

function onTabKey(event) {
  const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = [...document.querySelectorAll(".segment [data-view]")].filter((button) => !button.hidden);
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
  if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  buttons[next].focus();
  buttons[next].click();
}

async function onKeep() {
  const url = state?.currentTab?.url;
  if (!url) return;
  await act("WHITELIST_ADD", { tabUrl: url });
}

async function onWordmark() {
  const now = Date.now();
  wordmarkClicks = wordmarkClicks.filter((t) => now - t < 2000);
  wordmarkClicks.push(now);
  if (wordmarkClicks.length >= 5) {
    wordmarkClicks = [];
    await act("SET_SETTINGS", { partial: { debug: true } });
    await setView("debug");
  }
}

async function copyDebugReport() {
  const note = $("debug-copied");
  const text = debug?.report || "";
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = "Copied.";
    note.hidden = false;
    setTimeout(() => {
      note.hidden = true;
    }, 1500);
  } catch {
    note.textContent = "Copy failed — select the log instead.";
    note.hidden = false;
  }
}

async function act(type, extra = {}) {
  const needsState = type === "SLEEP_TAB" || type === "WAKE_TAB" || type === "SLEEP_OTHERS" || type === "WHITELIST_ADD";
  if (!demo && !state && needsState) return;
  if (demo) {
    applyDemo(type, extra);
    actionError = "";
    render();
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (response?.ok === false) actionError = response.error || "Something went wrong.";
    else actionError = "";
    if (type === "CLEAR_DEBUG" && response?.ok) debug = response;
  } catch (error) {
    actionError = error?.message || "Couldn’t reach Lulltab.";
  }
  await refresh();
}

function nearestPreset(minutes) {
  let best = 0;
  let dist = Infinity;
  IDLE_PRESETS.forEach((value, index) => {
    const d = Math.abs(value - minutes);
    if (d < dist) {
      dist = d;
      best = index;
    }
  });
  return best;
}

function paintFav(node, tab) {
  node.replaceChildren();
  if (tab.favIconUrl) {
    const img = document.createElement("img");
    img.src = tab.favIconUrl;
    img.alt = "";
    img.addEventListener("error", () => {
      if (!node.contains(img)) return;
      node.replaceChildren();
      node.textContent = faviconLetter(tab.title, tab.url);
    });
    node.append(img);
    return;
  }
  node.textContent = faviconLetter(tab.title, tab.url);
}

function demoState() {
  const now = Date.now();
  return {
    settings: {
      enabled: true,
      idleMinutes: 15,
      keepPinned: true,
      keepAudible: true,
      debug: true,
      whitelist: [{ id: "1", kind: "domain", pattern: "mail.google.com" }],
    },
    currentTab: {
      id: 1,
      title: "Lulltab — memory saver",
      url: "https://github.com/neelsatyavolu/lulltab",
      discarded: false,
      active: true,
      reason: "active",
      idleMs: 0,
    },
    counts: { total: 4, sleeping: 2, awake: 2 },
    tabs: [
      {
        id: 1,
        title: "Lulltab — memory saver",
        url: "https://github.com/neelsatyavolu/lulltab",
        discarded: false,
        active: true,
      },
      {
        id: 4,
        title: "Gmail",
        url: "https://mail.google.com/mail",
        discarded: false,
        active: false,
      },
      {
        id: 2,
        title: "Figma — aside nav",
        url: "https://www.figma.com/file/abc",
        discarded: true,
        idleMs: now,
      },
      {
        id: 3,
        title: "MDN — tabs.discard()",
        url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/discard",
        discarded: true,
        idleMs: now,
      },
    ],
  };
}

function demoMemory() {
  const rows = [
    {
      id: 1,
      title: "Lulltab — memory saver",
      url: "https://github.com/neelsatyavolu/lulltab",
      discarded: false,
      bytes: 86 * 1024 * 1024,
      sharedWith: 1,
    },
    {
      id: 4,
      title: "Gmail",
      url: "https://mail.google.com/mail",
      discarded: false,
      bytes: 210 * 1024 * 1024,
      sharedWith: 1,
    },
    {
      id: 5,
      title: "Docs — Q3 notes",
      url: "https://docs.google.com/document",
      discarded: false,
      bytes: 64 * 1024 * 1024,
      sharedWith: 2,
    },
    {
      id: 2,
      title: "Figma — aside nav",
      url: "https://www.figma.com/file/abc",
      discarded: true,
      bytes: 0,
      sharedWith: 1,
    },
    {
      id: 3,
      title: "MDN — tabs.discard()",
      url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/discard",
      discarded: true,
      bytes: 0,
      sharedWith: 1,
    },
  ];
  return {
    rows,
    processAvailable: true,
    source: "process",
    system: { capacity: 32 * 1024 * 1024 * 1024, availableCapacity: 11.2 * 1024 * 1024 * 1024 },
    awakeBytes: sumAwakeBytes(rows),
    counts: { total: 5, sleeping: 2, awake: 3 },
  };
}

function demoDebug() {
  const now = Date.now();
  const log = [
    { t: now - 8000, event: "init", reason: "wake" },
    { t: now - 5000, event: "scan", tabs: 6, slept: 1, failed: 0 },
    { t: now - 1200, event: "sleep", tabId: 2 },
  ];
  const probes = {
    processes: true,
    systemMemory: true,
    sessionStorage: true,
    alarms: true,
    contextMenus: true,
    userAgent: "Aside",
  };
  const counts = { total: 6, sleeping: 2, access: 6 };
  return {
    probes,
    counts,
    log,
    report: JSON.stringify({ lulltab: "1.3.1", probes, counts, log }, null, 2),
  };
}

function applyDemo(type, extra) {
  if (type === "SET_SETTINGS") Object.assign(state.settings, extra.partial || {});
  if (type === "SLEEP_TAB") {
    const id = extra.tabId;
    for (const tab of state.tabs) {
      if (tab.id === id) {
        tab.discarded = true;
        tab.active = false;
      }
    }
    if (state.currentTab?.id === id) {
      state.currentTab.discarded = true;
      state.currentTab.reason = "sleeping";
    }
    state.counts.sleeping += 1;
    state.counts.awake = Math.max(0, state.counts.awake - 1);
  }
  if (type === "WAKE_TAB") {
    for (const tab of state.tabs) {
      if (tab.id === extra.tabId) tab.discarded = false;
    }
    state.counts.sleeping = Math.max(0, state.counts.sleeping - 1);
    state.counts.awake += 1;
    if (state.currentTab?.id === extra.tabId) {
      state.currentTab.discarded = false;
      state.currentTab.reason = "active";
    }
  }
  if (type === "WHITELIST_ADD") {
    state.currentTab.reason = "whitelist";
  }
  if (type === "CLEAR_DEBUG" && debug) debug.log = [];
}
