import { test } from "node:test";
import assert from "node:assert/strict";
import { withSpan, TRUST_SPANS } from "../dist/index.js";

test("withSpan returns the wrapped function's value", async () => {
  const v = await withSpan(TRUST_SPANS.build, () => 42);
  assert.equal(v, 42);
});

test("withSpan awaits async work", async () => {
  const v = await withSpan(TRUST_SPANS.sign, async () => {
    await Promise.resolve();
    return "signed";
  }, { image: "waypoint" });
  assert.equal(v, "signed");
});

test("withSpan propagates errors (and still ends the span)", async () => {
  await assert.rejects(
    () => withSpan(TRUST_SPANS.verify, () => {
      throw new Error("boom");
    }),
    /boom/,
  );
});

test("trust span names are the canonical trust operations", () => {
  assert.deepEqual(Object.values(TRUST_SPANS), [
    "mint-ca", "build", "sbom", "sign", "push", "trustmark", "verify",
  ]);
});
