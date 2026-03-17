/**
 * URL Safety Validator
 *
 * Rejects URLs that could be used for SSRF attacks:
 *   - Non-HTTP(S) schemes
 *   - Loopback addresses (127.x, ::1)
 *   - RFC 1918 private ranges (10.x, 172.16-31.x, 192.168.x)
 *   - Link-local (169.254.x, fe80::)
 *   - Localhost hostname
 *
 * In development mode (NODE_ENV=development) loopback/localhost are
 * permitted so local lab setups still work, but all other SSRF vectors
 * remain blocked.
 */

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
];

const LOOPBACK_HOSTNAMES = new Set(["localhost", "localhost."]);

export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlSafetyError";
  }
}

/**
 * Validates that `rawUrl` is safe to fetch server-side.
 * Throws `UrlSafetyError` with a descriptive message on rejection.
 *
 * @param rawUrl     The URL to validate (must be a valid URL string)
 * @param fieldName  Name of the field for error messages (e.g. "jwks_url")
 */
export function assertSafeUrl(rawUrl: string, fieldName = "url"): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlSafetyError(
      `[TRUST:FAIL] ${fieldName} is not a valid URL: "${rawUrl}". ` +
      "Provide a fully-qualified HTTPS URL."
    );
  }

  const scheme = parsed.protocol; // includes trailing ':'
  const isDev = process.env["NODE_ENV"] === "development";

  if (scheme !== "https:" && scheme !== "http:") {
    throw new UrlSafetyError(
      `[TRUST:FAIL] ${fieldName} uses disallowed scheme "${scheme}". ` +
      "Only https: (and http: in development) are permitted."
    );
  }

  if (scheme === "http:" && !isDev) {
    throw new UrlSafetyError(
      `[TRUST:FAIL] ${fieldName} uses http: which is only allowed in development mode. ` +
      "Set NODE_ENV=development for local testing, or use https:."
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject IPv6 loopback
  if (hostname === "[::1]" || hostname === "::1") {
    if (!isDev) {
      throw new UrlSafetyError(
        `[TRUST:FAIL] ${fieldName} resolves to a loopback address. ` +
        "Use a publicly routable HTTPS URL."
      );
    }
  }

  // Reject loopback hostnames in production
  if (LOOPBACK_HOSTNAMES.has(hostname) && !isDev) {
    throw new UrlSafetyError(
      `[TRUST:FAIL] ${fieldName} targets localhost which is not permitted in production. ` +
      "Use a publicly routable HTTPS URL or set NODE_ENV=development for local testing."
    );
  }

  // Reject private IPv4 ranges (always, even in dev — these are SSRF targets)
  const ipMatch = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(hostname);
  if (ipMatch) {
    const ip = ipMatch[1]!;
    if (ip.startsWith("127.") && isDev) {
      // allow 127.0.0.1 in dev
    } else {
      for (const pattern of PRIVATE_IPV4) {
        if (pattern.test(ip)) {
          throw new UrlSafetyError(
            `[TRUST:FAIL] ${fieldName} resolves to a private IP address (${ip}). ` +
            "Private IP ranges are blocked to prevent SSRF attacks. " +
            "Use a publicly routable domain name."
          );
        }
      }
    }
  }

  // Reject IPv6 link-local
  if (hostname.startsWith("[fe80") || hostname.startsWith("fe80")) {
    throw new UrlSafetyError(
      `[TRUST:FAIL] ${fieldName} uses an IPv6 link-local address which is not routable. ` +
      "Use a publicly routable HTTPS URL."
    );
  }

  return parsed;
}
