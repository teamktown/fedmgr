/**
 * URL Safety Validator — the SINGLE source of truth for SSRF protection.
 *
 * AI-NOTE: this module is re-exported from @letsfederate/kms and imported by
 * kms, fedmgr-mcp, ta-server and fedmgr-cli. There used to be three divergent
 * copies (review Finding #10); do NOT re-inline it. Any DNS-rebinding / IP-range
 * fix must land here, once. Guard test: packages/kms/test/validate-url.test.mjs.
 *
 * Rejects SSRF-prone URLs: non-HTTP(S) schemes, private IP ranges, loopback,
 * link-local. Two escape hatches, in order of preference:
 *
 *  1. FEDMGR_ALLOW_ORIGINS — a comma-separated list of EXACT origins
 *     (scheme://host[:port]) exempted from the http-scheme, loopback, and
 *     private-IP rules. Empty/unset = strictest posture. Each entry is an
 *     explicit, auditable operator decision; malformed entries fail loudly.
 *     Non-http(s) schemes and IPv6 link-local stay blocked unconditionally.
 *
 *  2. NODE_ENV=development (LEGACY) — globally allows localhost / http: /
 *     127.0.0.1. Deprecated for fedmgr use: it is process-global and overloads
 *     a variable that also changes unrelated library behavior. Prefer #1.
 *
 * Callers own any presentation prefix (e.g. [TRUST:FAIL]).
 */

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
];

// Loopback hostnames blocked outside development. Includes the trailing-dot FQDN
// form (`localhost.`) and the IPv6 loopback literal.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "localhost.", "[::1]", "::1"]);

export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlSafetyError";
  }
}

let loggedAllowList: string | undefined;

/**
 * Parse FEDMGR_ALLOW_ORIGINS into a set of normalized origins. Re-read per
 * call (cheap; the env can legitimately differ across spawned tools/tests).
 * Malformed entries throw — a misconfigured exception list must never fail
 * open or silently shrink.
 */
export function allowedOrigins(): Set<string> {
  const raw = process.env["FEDMGR_ALLOW_ORIGINS"];
  const out = new Set<string>();
  if (!raw || raw.trim() === "") return out;
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    let origin: string;
    try {
      origin = new URL(trimmed).origin.toLowerCase();
    } catch {
      throw new UrlSafetyError(
        `FEDMGR_ALLOW_ORIGINS contains a malformed entry: "${trimmed}" (need exact origins like https://host:port)`
      );
    }
    if (origin === "null") {
      throw new UrlSafetyError(
        `FEDMGR_ALLOW_ORIGINS entry "${trimmed}" has no usable origin`
      );
    }
    out.add(origin);
  }
  // Boot-visibility: log the active exception list once per process per value.
  if (out.size > 0 && loggedAllowList !== raw) {
    loggedAllowList = raw;
    process.stderr.write(
      `[kms] FEDMGR_ALLOW_ORIGINS active — ${out.size} origin exception(s): ${[...out].join(", ")}\n`
    );
  }
  return out;
}

export function assertSafeUrl(rawUrl: string, fieldName = "url"): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlSafetyError(`${fieldName} is not a valid URL: "${rawUrl}"`);
  }

  const scheme = parsed.protocol;
  const isDev = process.env["NODE_ENV"] === "development";
  const hostname = parsed.hostname.toLowerCase();

  // Unconditional rules — no exception mechanism relaxes these.
  if (scheme !== "https:" && scheme !== "http:") {
    throw new UrlSafetyError(`${fieldName} uses disallowed scheme "${scheme}". Use https:.`);
  }
  if (hostname.startsWith("[fe80") || hostname.startsWith("fe80")) {
    throw new UrlSafetyError(`${fieldName} uses IPv6 link-local address (not routable).`);
  }

  // Explicit exception list (option G): an exact-origin match is an operator
  // decision — it exempts THIS origin from the http-scheme, loopback, and
  // private-IP rules below. Empty list = strictest posture.
  if (allowedOrigins().has(parsed.origin.toLowerCase())) {
    return parsed;
  }

  if (scheme === "http:" && !isDev) {
    throw new UrlSafetyError(
      `${fieldName} uses http: which requires an explicit FEDMGR_ALLOW_ORIGINS exception (or legacy NODE_ENV=development).`
    );
  }

  if (LOOPBACK_HOSTNAMES.has(hostname) && !isDev) {
    throw new UrlSafetyError(
      `${fieldName} targets loopback. Use a routable HTTPS URL or add an explicit FEDMGR_ALLOW_ORIGINS exception.`
    );
  }

  const ipv4Match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(hostname);
  if (ipv4Match) {
    const ip = ipv4Match[1]!;
    if (!(ip.startsWith("127.") && isDev)) {
      for (const pattern of PRIVATE_IPV4) {
        if (pattern.test(ip)) {
          throw new UrlSafetyError(
            `${fieldName} targets private IP ${ip}. Private ranges are blocked (SSRF protection); an explicit FEDMGR_ALLOW_ORIGINS exception is required.`
          );
        }
      }
    }
  }

  return parsed;
}
