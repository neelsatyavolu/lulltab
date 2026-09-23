// Hero demo: a pretend tab strip that behaves like Lulltab. Idle tabs sleep once the
// (sped-up) clock passes the timeout; clicking one wakes it and starts the clock on
// the tab you left. Pinned, audible, and kept tabs never sleep.
(() => {
  const TIMEOUT_MIN = 15;
  const DEMO_MIN_PER_SEC = 1.5; // 90x real time: 15 minutes pass in 10 seconds
  const TICK_MS = 250;
  const WAKE_MS = 800;
  const SLEEPING_MB = 0;

  const TABS = [
    { id: "cal", title: "Calendar", fav: "C", hue: "#8fa3c4", mb: 180, keepReason: "Pinned", pinned: true },
    { id: "mail", title: "Inbox (3)", fav: "G", hue: "#d6a77a", mb: 310, keepReason: "Kept site" },
    { id: "figma", title: "Onboarding flow", fav: "F", hue: "#b7a0d8", mb: 520 },
    { id: "radio", title: "Lo-fi radio", fav: "R", hue: "#c27a6a", mb: 240, keepReason: "Playing audio", audible: true },
    { id: "mdn", title: "tabs.discard()", fav: "M", hue: "#9fb4c9", mb: 190, idle: 12.5 },
    { id: "pr", title: "Fix idle clock #42", fav: "G", hue: "#c9ced0", mb: 260, idle: 10 },
    { id: "docs", title: "Q3 planning", fav: "D", hue: "#8fc0a4", mb: 220, idle: 7.5 },
    { id: "board", title: "Sprint board", fav: "L", hue: "#a8a4e0", mb: 200, idle: 5 },
  ];
  const TOTAL_MB = TABS.reduce((sum, tab) => sum + tab.mb, 0);

  const strip = document.getElementById("strip");
  const nowEl = document.getElementById("now");
  const nextEl = document.getElementById("next");
  const memEl = document.getElementById("mem");
  const barEl = document.getElementById("bar");
  const liveEl = document.getElementById("live");
  if (!strip || !nowEl || !nextEl || !memEl || !barEl || !liveEl) return;

  let clock = 0;
  let activeId = "figma";
  let state = Object.fromEntries(
    TABS.map((tab) => [tab.id, { leftAt: tab.idle == null ? 0 : -tab.idle, asleep: false, waking: false }])
  );
  const buttons = new Map();

  const byId = (id) => TABS.find((tab) => tab.id === id);
  const canSleep = (tab) => !tab.keepReason && tab.id !== activeId;
  const setTab = (id, patch) => { state = { ...state, [id]: { ...state[id], ...patch } }; };

  function build() {
    const speaker = '<svg class="sound" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    strip.replaceChildren();
    for (const tab of TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab" + (tab.pinned ? " pinned" : "");
      button.style.setProperty("--hue", tab.hue);
      const fav = document.createElement("span");
      fav.className = "fav";
      fav.setAttribute("aria-hidden", "true");
      button.append(fav);
      if (!tab.pinned) {
        const title = document.createElement("span");
        title.className = "t";
        title.textContent = tab.title;
        button.append(title);
      }
      if (tab.audible) button.insertAdjacentHTML("beforeend", speaker);
      button.addEventListener("click", () => activate(tab.id));
      strip.append(button);
      buttons.set(tab.id, button);
    }
  }

  function render() {
    let mb = 0;
    for (const tab of TABS) {
      const s = state[tab.id];
      const button = buttons.get(tab.id);
      const active = tab.id === activeId;
      button.classList.toggle("active", active);
      button.classList.toggle("asleep", s.asleep);
      button.classList.toggle("waking", s.waking);
      button.querySelector(".fav").textContent = s.asleep || s.waking ? "" : tab.fav;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      const status = s.waking ? "waking" : s.asleep ? "asleep" : tab.keepReason ? `awake, ${tab.keepReason.toLowerCase()}` : "awake";
      button.setAttribute("aria-label", `${tab.title}, ${status}`);
      button.title = tab.keepReason ? `${tab.title} (${tab.keepReason}, never sleeps)` : tab.title;
      mb += s.asleep ? SLEEPING_MB : tab.mb;
    }
    memEl.textContent = (mb / 1000).toFixed(1);
    barEl.style.width = `${Math.round((mb / TOTAL_MB) * 100)}%`;

    const active = byId(activeId);
    const b = document.createElement("b");
    b.textContent = active.title;
    nowEl.replaceChildren(b, state[activeId].waking ? " is reloading." : " is open.");
    nextEl.textContent = nextLine();
  }

  function nextLine() {
    const pending = TABS.filter((tab) => canSleep(tab) && !state[tab.id].asleep)
      .map((tab) => ({ tab, left: TIMEOUT_MIN - (clock - state[tab.id].leftAt) }))
      .sort((a, b) => a.left - b.left);
    if (!pending.length) return "Everything idle is asleep. Pinned, playing, and kept tabs stay awake.";
    const { tab, left } = pending[0];
    const minutes = Math.max(1, Math.ceil(left));
    return `${tab.title} sleeps in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }

  function tick() {
    clock += (DEMO_MIN_PER_SEC * TICK_MS) / 1000;
    for (const tab of TABS) {
      const s = state[tab.id];
      if (s.asleep || !canSleep(tab) || clock - s.leftAt < TIMEOUT_MIN) continue;
      setTab(tab.id, { asleep: true });
      const button = buttons.get(tab.id);
      button.classList.add("just-slept");
      setTimeout(() => button.classList.remove("just-slept"), 700);
      revealInStrip(button);
    }
    render();
  }

  // On narrow screens the strip scrolls sideways; bring a tab that just fell asleep into view
  // without touching the page's own scroll position.
  function revealInStrip(button) {
    if (strip.scrollWidth <= strip.clientWidth) return;
    const left = strip.scrollLeft;
    const inView = button.offsetLeft >= left && button.offsetLeft + button.offsetWidth <= left + strip.clientWidth;
    if (inView) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    strip.scrollTo({ left: button.offsetLeft - 12, behavior });
  }

  function activate(id) {
    if (id === activeId) return;
    setTab(activeId, { leftAt: clock });
    activeId = id;
    const wasAsleep = state[id].asleep;
    if (wasAsleep) {
      setTab(id, { asleep: false, waking: true });
      setTimeout(() => { setTab(id, { waking: false }); render(); }, WAKE_MS);
    }
    liveEl.textContent = `${wasAsleep ? "Woke" : "Switched to"} ${byId(id).title}.`;
    render();
  }

  build();
  render();

  let timer = null;
  const run = (on) => {
    if (on && !timer) timer = setInterval(tick, TICK_MS);
    if (!on && timer) { clearInterval(timer); timer = null; }
  };
  let onScreen = true;
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    run(onScreen && !document.hidden);
  }, { threshold: 0.3 }).observe(strip);
  document.addEventListener("visibilitychange", () => run(onScreen && !document.hidden));
})();
