/** Parse and match Still whitelist rules. No Chrome APIs — safe for Node tests. */

const KINDS = new Set(["domain", "host", "wildcard", "prefix", "url"]);

export function parsePattern(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("Enter a URL, domain, or pattern.");
  if (/\s/.test(raw) && !raw.includes("://")) {
    throw new Error("Patterns cannot contain spaces.");
  }

  if (raw.startsWith("=")) {
    const host = normalizeHost(raw.slice(1));
    if (!host) throw new Error("Enter a hostname after =.");
    return { kind: "host", pattern: host };
  }

  if (raw.startsWith("*.")) {
    const domain = normalizeHost(raw.slice(2));
    if (!domain) throw new Error("Enter a domain after *.");
    return { kind: "wildcard", pattern: domain };
  }

  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("That URL looks invalid.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http(s) URLs can be whitelisted.");
    }
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    if (!path && !url.search) {
      return { kind: "host", pattern: normalizeHost(url.hostname) };
    }
    const prefix = `${url.origin}${url.pathname}${url.search}`.replace(/\/$/, "");
    return { kind: "prefix", pattern: prefix };
  }

  const slash = raw.indexOf("/");
  if (slash !== -1) {
    const host = normalizeHost(raw.slice(0, slash));
    const path = raw.slice(slash).replace(/\/$/, "") || "/";
    if (!host) throw new Error("Enter a hostname before the path.");
    return { kind: "prefix", pattern: `${host}${path}` };
  }

  const host = normalizeHost(raw);
  if (!host || !host.includes(".")) {
    throw new Error("Use a domain like example.com, *.example.com, or a full URL.");
  }
  return { kind: "domain", pattern: host };
}

export function matchesRule(urlString, rule) {
  if (!rule || !KINDS.has(rule.kind) || !rule.pattern) return false;
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = normalizeHost(url.hostname);
  const pattern = String(rule.pattern);

  switch (rule.kind) {
    case "domain":
      return host === pattern || host.endsWith(`.${pattern}`);
    case "host":
      return host === pattern;
    case "wildcard":
      return host.endsWith(`.${pattern}`);
    case "url":
      return stripTrailingSlash(urlString) === stripTrailingSlash(pattern);
    case "prefix":
      return matchPrefix(url, pattern);
    default:
      return false;
  }
}

export function isWhitelisted(urlString, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return false;
  return rules.some((rule) => matchesRule(urlString, rule));
}

export function describeRule(rule) {
  if (!rule) return "";
  switch (rule.kind) {
    case "domain":
      return `Matches ${rule.pattern} and every subdomain`;
    case "host":
      return `Matches only ${rule.pattern}`;
    case "wildcard":
      return `Matches subdomains of ${rule.pattern}, not the root`;
    case "prefix":
      return `Matches URLs starting with ${rule.pattern}`;
    case "url":
      return `Matches this exact URL`;
    default:
      return rule.pattern;
  }
}

export function kindLabel(kind) {
  switch (kind) {
    case "domain":
      return "domain";
    case "host":
      return "host";
    case "wildcard":
      return "subdomains";
    case "prefix":
      return "prefix";
    case "url":
      return "url";
    default:
      return kind;
  }
}

export function displayPattern(rule) {
  if (!rule) return "";
  if (rule.kind === "wildcard") return `*.${rule.pattern}`;
  if (rule.kind === "host") return rule.pattern;
  return rule.pattern;
}

function matchPrefix(url, pattern) {
  if (/^https?:\/\//i.test(pattern)) {
    const href = `${url.origin}${url.pathname}${url.search}`;
    const base = stripTrailingSlash(pattern);
    return href === pattern || href === base || href.startsWith(`${base}/`);
  }
  const haystack = `${normalizeHost(url.hostname)}${url.pathname}${url.search}`;
  const needle = stripTrailingSlash(pattern.replace(/^www\./, ""));
  return haystack === needle || haystack.startsWith(`${needle}/`);
}

function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/$/, "");
}
