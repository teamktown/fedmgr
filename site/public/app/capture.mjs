/**
 * Anonymous scorecard capture — the seam designed for a Cloudflare Worker → D1
 * endpoint (see docs/analysis/website-ai-infrastructure.html §4). Sends ONLY
 * the answers object plus derived tier/pct — no identity, no free text, no
 * cookies. Consent is explicit at the call site.
 *
 * Locally (no CAPTURE_ENDPOINT configured) this is a no-op that resolves, so the
 * scorecard works fully offline; in production window.LETSFEDERATE_CAPTURE is set
 * to the Worker URL by an inlined config the deploy step writes.
 */
export async function submitAnonymous(payload) {
  const endpoint =
    (typeof window !== "undefined" && window.LETSFEDERATE_CAPTURE) || null;
  const body = {
    v: 1,
    // whitelist exactly what we send — defense against accidentally capturing more
    answers: payload.answers,
    pct: payload.pct,
    tier: payload.tier,
    ts: new Date().toISOString(),
  };
  if (!endpoint) {
    // Local/dev: prove the shape without a network call.
    return { captured: false, reason: "no endpoint configured (local)", body };
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // no credentials, no cookies — anonymous by construction
      credentials: "omit",
    });
    return { captured: res.ok, status: res.status };
  } catch (e) {
    return { captured: false, reason: String(e.message || e) };
  }
}
