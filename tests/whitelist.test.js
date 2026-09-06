import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePattern, matchesRule, isWhitelisted, describeRule } from "../lib/whitelist.js";
import { classifyTab, formatDuration, formatIdleMinutes, isInternalUrl, isAsideChatTitle, isAsideAgentGroup } from "../lib/engine.js";
import { mergeSettings, clampIdleMinutes } from "../lib/settings.js";

test("parses domain, host, wildcard, url prefix, and path prefix", () => {
  assert.deepEqual(parsePattern("github.com"), { kind: "domain", pattern: "github.com" });
  assert.deepEqual(parsePattern("www.github.com"), { kind: "domain", pattern: "github.com" });
  assert.deepEqual(parsePattern("*.notion.so"), { kind: "wildcard", pattern: "notion.so" });
  assert.deepEqual(parsePattern("=mail.google.com"), { kind: "host", pattern: "mail.google.com" });
  assert.deepEqual(parsePattern("https://mail.google.com"), {
    kind: "host",
    pattern: "mail.google.com",
  });
  assert.deepEqual(parsePattern("https://mail.google.com/mail/u/0/"), {
    kind: "prefix",
    pattern: "https://mail.google.com/mail/u/0",
  });
  assert.deepEqual(parsePattern("github.com/neel/still"), {
    kind: "prefix",
    pattern: "github.com/neel/still",
  });
});

test("rejects empty and invalid patterns", () => {
  assert.throws(() => parsePattern(" "), /Enter/);
  assert.throws(() => parsePattern("localhost"), /domain/);
  assert.throws(() => parsePattern("not a url.com extra"), /spaces/);
});

test("domain matches apex and nested subdomains", () => {
  const rule = parsePattern("example.com");
  assert.equal(matchesRule("https://example.com/a", rule), true);
  assert.equal(matchesRule("https://www.example.com/", rule), true);
  assert.equal(matchesRule("https://app.example.com/x", rule), true);
  assert.equal(matchesRule("https://notexample.com/", rule), false);
  assert.equal(matchesRule("https://example.org/", rule), false);
});

test("wildcard matches subdomains only", () => {
  const rule = parsePattern("*.example.com");
  assert.equal(matchesRule("https://app.example.com/", rule), true);
  assert.equal(matchesRule("https://a.b.example.com/", rule), true);
  assert.equal(matchesRule("https://example.com/", rule), false);
});

test("host rule is exact", () => {
  const rule = parsePattern("=docs.google.com");
  assert.equal(matchesRule("https://docs.google.com/document", rule), true);
  assert.equal(matchesRule("https://sheets.google.com/", rule), false);
  assert.equal(matchesRule("https://other.docs.google.com/", rule), false);
});

test("url prefix matches descendants", () => {
  const rule = parsePattern("https://github.com/neel");
  assert.equal(matchesRule("https://github.com/neel/still", rule), true);
  assert.equal(matchesRule("https://github.com/neel", rule), true);
  assert.equal(matchesRule("https://github.com/other/repo", rule), false);
});

test("path prefix without scheme", () => {
  const rule = parsePattern("github.com/neel");
  assert.equal(matchesRule("https://github.com/neel/still", rule), true);
  assert.equal(matchesRule("https://github.com/neelisha", rule), false);
});

test("whitelist scans a list of rules", () => {
  const rules = [parsePattern("mail.google.com"), parsePattern("*.figma.com")];
  assert.equal(isWhitelisted("https://mail.google.com/mail", rules), true);
  assert.equal(isWhitelisted("https://www.figma.com/file/x", rules), false);
  assert.equal(isWhitelisted("https://app.figma.com/file/x", rules), true);
  assert.equal(isWhitelisted("https://news.ycombinator.com/", rules), false);
});

test("describeRule is human-readable", () => {
  assert.match(describeRule(parsePattern("example.com")), /subdomain/i);
  assert.match(describeRule(parsePattern("*.example.com")), /not the root/i);
});

test("classifyTab never sleeps active, internal, pinned, audible, or whitelisted tabs", () => {
  const now = 1_000_000;
  const settings = mergeSettings({
    idleMinutes: 10,
    keepPinned: true,
    keepAudible: true,
    whitelist: [{ kind: "domain", pattern: "keep.me" }],
  });
  const lastAccess = { 1: now - 60 * 60 * 1000 };

  assert.equal(
    classifyTab(
      { id: 1, active: true, url: "https://a.com", discarded: false },
      { now, lastAccess, settings }
    ).sleep,
    false
  );
  assert.equal(
    classifyTab(
      { id: 1, active: false, url: "chrome://extensions", discarded: false },
      { now, lastAccess, settings }
    ).reason,
    "internal"
  );
  assert.equal(
    classifyTab(
      { id: 1, active: false, url: "https://a.com", discarded: false, pinned: true },
      { now, lastAccess, settings }
    ).reason,
    "pinned"
  );
  assert.equal(
    classifyTab(
      { id: 1, active: false, url: "https://a.com", discarded: false, audible: true },
      { now, lastAccess, settings }
    ).reason,
    "audible"
  );
  assert.equal(
    classifyTab(
      { id: 1, active: false, url: "https://keep.me/x", discarded: false },
      { now, lastAccess, settings }
    ).reason,
    "whitelist"
  );
});

test("Aside chat titles and Agent Tabs stay awake", () => {
  assert.equal(isAsideChatTitle("Scurvy Waters ⋅ Chats"), true);
  assert.equal(isAsideChatTitle("Plan · Chat"), true);
  assert.equal(isAsideChatTitle("YouTube"), false);
  assert.equal(isAsideAgentGroup("Agent Tabs"), true);
  assert.equal(isAsideAgentGroup("Work"), false);
  const now = 1_000_000;
  const settings = mergeSettings({ idleMinutes: 1, keepAsideChat: true });
  const lastAccess = { 1: now - 60 * 60 * 1000 };
  assert.equal(
    classifyTab(
      { id: 1, active: false, url: "https://drive.google.com", discarded: false, title: "Notes ⋅ Chats" },
      { now, lastAccess, settings }
    ).reason,
    "aside-chat"
  );
  assert.equal(
    classifyTab(
      { id: 1, active: false, url: "https://drive.google.com", discarded: false },
      { now, lastAccess, settings, asideBusy: true }
    ).sleep,
    false
  );
});

test("classifyTab sleeps only after the idle window", () => {
  const now = 1_000_000;
  const settings = mergeSettings({ idleMinutes: 15 });
  const fresh = classifyTab(
    { id: 7, active: false, url: "https://idle.test/", discarded: false },
    { now, lastAccess: { 7: now - 5 * 60 * 1000 }, settings }
  );
  assert.equal(fresh.sleep, false);
  assert.equal(fresh.reason, "fresh");

  const idle = classifyTab(
    { id: 7, active: false, url: "https://idle.test/", discarded: false },
    { now, lastAccess: { 7: now - 16 * 60 * 1000 }, settings }
  );
  assert.equal(idle.sleep, true);
  assert.equal(idle.reason, "idle");
});

test("missing lastAccess is treated as just seen", () => {
  const now = 5_000_000;
  const settings = mergeSettings({ idleMinutes: 1 });
  const verdict = classifyTab(
    { id: 3, active: false, url: "https://idle.test/", discarded: false },
    { now, lastAccess: {}, settings }
  );
  assert.equal(verdict.sleep, false);
  assert.equal(verdict.reason, "fresh");
});

test("format helpers", () => {
  assert.equal(formatDuration(1500), "2s");
  assert.equal(formatDuration(5 * 60 * 1000), "5m");
  assert.equal(formatDuration(90 * 60 * 1000), "1h 30m");
  assert.deepEqual(formatIdleMinutes(15), { value: "15", unit: "minutes" });
  assert.deepEqual(formatIdleMinutes(60), { value: "1", unit: "hour" });
  assert.equal(clampIdleMinutes(0), 1);
  assert.equal(clampIdleMinutes(99999), 1440);
  assert.equal(isInternalUrl("chrome://settings"), true);
  assert.equal(isInternalUrl("https://example.com"), false);
});
