import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  maybeSendPing,
  syncUninstallUrl,
  buildPayload,
  chromeMajor,
  normalizeArch,
  utcDay,
  PING_URL,
  UNINSTALL_URL,
} from "../lib/usage-ping.js";
import { mergeSettings } from "../lib/settings.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

let store;
let calls;
let uninstallUrls;
let fetchStatus;

beforeEach(() => {
  store = {};
  calls = [];
  uninstallUrls = [];
  fetchStatus = 204;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items) => Object.assign(store, structuredClone(items)),
      },
    },
    runtime: {
      getManifest: () => ({ version: "1.3.1" }),
      getPlatformInfo: async () => ({ os: "mac", arch: "arm64" }),
      setUninstallURL: async (url) => uninstallUrls.push(url),
    },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (fetchStatus === "offline") throw new TypeError("Failed to fetch");
    return { ok: fetchStatus >= 200 && fetchStatus < 300, status: fetchStatus };
  };
});

test("sends one ping per UTC day", async () => {
  assert.equal(await maybeSendPing(true, T0), true);
  assert.equal(await maybeSendPing(true, T0 + 2 * 60 * 60 * 1000), false);
  assert.equal(calls.length, 1);
  assert.equal(await maybeSendPing(true, T0 + DAY), true);
  assert.equal(calls.length, 2);
});

test("concurrent checks send only once", async () => {
  const results = await Promise.all([maybeSendPing(true, T0), maybeSendPing(true, T0)]);
  assert.deepEqual(results, [true, true]);
  assert.equal(calls.length, 1);
});

test("payload has only the anonymous fields and a stable install id", async () => {
  await maybeSendPing(true, T0);
  await maybeSendPing(true, T0 + DAY);
  const [first, second] = calls.map((c) => JSON.parse(c.init.body));
  assert.equal(calls[0].url, PING_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(Object.keys(first).sort(), [
    "arch",
    "channel",
    "install_id",
    "os_version",
    "platform",
    "product",
    "version",
  ]);
  assert.equal(first.product, "lulltab");
  assert.equal(first.version, "1.3.1");
  assert.equal(first.platform, "chrome");
  assert.equal(first.arch, "arm64");
  assert.match(first.install_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(second.install_id, first.install_id);
});

test("opted out sends nothing and creates no install id", async () => {
  assert.equal(await maybeSendPing(false, T0), false);
  assert.equal(calls.length, 0);
  assert.deepEqual(store, {});
});

test("failures are silent and retried at most hourly", async () => {
  fetchStatus = "offline";
  assert.equal(await maybeSendPing(true, T0), false);
  assert.equal(await maybeSendPing(true, T0 + 60 * 1000), false);
  assert.equal(calls.length, 1);
  fetchStatus = 204;
  assert.equal(await maybeSendPing(true, T0 + 61 * 60 * 1000), true);
  assert.equal(calls.length, 2);
});

test("a non-2xx response doesn't count as sent", async () => {
  fetchStatus = 500;
  assert.equal(await maybeSendPing(true, T0), false);
  fetchStatus = 204;
  assert.equal(await maybeSendPing(true, T0 + 61 * 60 * 1000), true);
});

test("uninstall URL is set when on and cleared when off", async () => {
  await syncUninstallUrl(true);
  await syncUninstallUrl(false);
  assert.deepEqual(uninstallUrls, [UNINSTALL_URL, ""]);
  assert.equal(UNINSTALL_URL, "https://analytics.n3el.dev/u/lulltab");
});

test("usage stats default on and can be turned off", () => {
  assert.equal(mergeSettings({}).usageStats, true);
  assert.equal(mergeSettings({ usageStats: false }).usageStats, false);
});

test("helpers", () => {
  assert.equal(utcDay(T0), "2026-09-23");
  assert.equal(chromeMajor("Mozilla/5.0 ... Chrome/141.0.7390.54 Safari/537.36"), "141");
  assert.equal(chromeMajor(""), "unknown");
  assert.equal(normalizeArch("x86-64"), "x86_64");
  assert.equal(normalizeArch(undefined), "unknown");
  assert.equal(buildPayload({ installId: "x", version: "1", userAgent: "", arch: "arm" }).channel, "release");
});
