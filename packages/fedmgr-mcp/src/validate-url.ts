/**
 * URL Safety Validator for the MCP server
 *
 * Rejects SSRF-prone URLs: non-HTTP(S) schemes, private IP ranges,
 * loopback, link-local. Allows localhost only in development mode.
 */

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
];

export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlSafetyError";
  }
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

  if (scheme !== "https:" && scheme !== "http:") {
    throw new UrlSafetyError(`${fieldName} uses disallowed scheme "${scheme}". Use https:.`);
  }
  if (scheme === "http:" && !isDev) {
    throw new UrlSafetyError(
      `${fieldName} uses http: which is only allowed in development (NODE_ENV=development).`
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if ((hostname === "localhost" || hostname === "[::1]" || hostname === "::1") && !isDev) {
    throw new UrlSafetyError(`${fieldName} targets loopback. Use a routable HTTPS URL.`);
  }

  const ipv4Match = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(hostname);
  if (ipv4Match) {
    const ip = ipv4Match[1]!;
    if (!(ip.startsWith("127.") && isDev)) {
      for (const pattern of PRIVATE_IPV4) {
        if (pattern.test(ip)) {
          throw new UrlSafetyError(
            `${fieldName} targets private IP ${ip}. Private ranges are blocked (SSRF protection).`
          );
        }
      }
    }
  }

  if (hostname.startsWith("[fe80") || hostname.startsWith("fe80")) {
    throw new UrlSafetyError(`${fieldName} uses IPv6 link-local address (not routable).`);
  }

  return parsed;
}
