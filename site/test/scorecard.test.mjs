// Scorecard engine tests — pure, deterministic scoring with fail-closed
// validation. The bank fixture mirrors the real content/scorecard.json shape.
import test from "node:test";
import assert from "node:assert/strict";
import { validateBank, score } from "../lib/scorecard.mjs";

const BANK = {
  version: 1,
  sections: [
    {
      id: "identity",
      title: "Identity & federation readiness",
      questions: [
        {
          id: "idp",
          text: "Do you operate a standards-based IdP (OIDC/SAML)?",
          options: [
            { value: "yes", label: "Yes", points: 2 },
            { value: "partial", label: "Partially", points: 1, guidance: "Consolidate on one OIDC IdP first." },
            { value: "no", label: "No", points: 0, guidance: "Start with a managed OIDC provider." },
          ],
        },
        {
          id: "trust-decisions",
          text: "How do you decide which MCP servers to trust today?",
          options: [
            { value: "verified", label: "Cryptographic verification", points: 2 },
            { value: "list", label: "A maintained allowlist", points: 1 },
            { value: "vibes", label: "Ad hoc", points: 0, guidance: "This is the gap OIDF closes." },
          ],
        },
      ],
    },
    {
      id: "supply-chain",
      title: "Supply chain integrity",
      questions: [
        {
          id: "sbom",
          text: "Do your artifacts ship with SBOMs?",
          options: [
            { value: "signed", label: "Signed SBOMs", points: 2 },
            { value: "unsigned", label: "Unsigned SBOMs", points: 1 },
            { value: "none", label: "No SBOMs", points: 0, guidance: "Start with syft in CI." },
          ],
        },
      ],
    },
  ],
  tiers: [
    { min: 80, id: "ready", label: "Federation-ready" },
    { min: 40, id: "emerging", label: "Emerging" },
    { min: 0, id: "explorer", label: "Explorer" },
  ],
};

test("bank fixture validates", () => {
  const v = validateBank(BANK);
  assert.equal(v.ok, true, v.reasons.join("; "));
});

test("known answers produce exact deterministic scores", () => {
  const r = score(BANK, { idp: "yes", "trust-decisions": "list", sbom: "none" });
  assert.equal(r.total, 3);
  assert.equal(r.max, 6);
  assert.equal(r.pct, 50);
  assert.equal(r.tier.id, "emerging");
  assert.deepEqual(r.unanswered, []);
  const identity = r.sections.find((s) => s.id === "identity");
  assert.equal(identity.points, 3);
  assert.equal(identity.max, 4);
  // guidance comes only from the options actually chosen
  assert.deepEqual(r.guidance, ["Start with syft in CI."]);
});

test("tier boundaries: exact min lands in the tier; perfect score is top tier", () => {
  // 80% boundary isn't reachable exactly with max 6 — use pct math directly:
  const perfect = score(BANK, { idp: "yes", "trust-decisions": "verified", sbom: "signed" });
  assert.equal(perfect.pct, 100);
  assert.equal(perfect.tier.id, "ready");
  const zero = score(BANK, { idp: "no", "trust-decisions": "vibes", sbom: "none" });
  assert.equal(zero.pct, 0);
  assert.equal(zero.tier.id, "explorer");
});

test("unanswered questions are reported and score as zero, not skipped silently", () => {
  const r = score(BANK, { idp: "yes" });
  assert.deepEqual(r.unanswered.sort(), ["sbom", "trust-decisions"]);
  assert.equal(r.total, 2);
  assert.equal(r.max, 6, "max must still count unanswered questions");
});

test("NEGATIVE: unknown question id throws", () => {
  assert.throws(() => score(BANK, { nonsense: "yes" }), /TRUST:FAIL.*nonsense/);
});

test("NEGATIVE: unknown option value throws", () => {
  assert.throws(() => score(BANK, { idp: "maybe" }), /TRUST:FAIL.*idp/);
});

test("NEGATIVE: malformed banks are rejected with reasons", () => {
  const cases = [
    [{ ...BANK, sections: [] }, /no sections/i],
    [
      { ...BANK, sections: [{ id: "s", title: "t", questions: [{ id: "q", text: "t", options: [] }] }] },
      /options/i,
    ],
    [
      {
        ...BANK,
        sections: [
          {
            id: "s",
            title: "t",
            questions: [
              {
                id: "q",
                text: "t",
                options: [
                  { value: "a", label: "A", points: -1 },
                  { value: "b", label: "B", points: 1 },
                ],
              },
            ],
          },
        ],
      },
      /negative points/i,
    ],
    [
      {
        ...BANK,
        sections: [
          {
            id: "s",
            title: "t",
            questions: [
              { id: "dup", text: "t", options: [{ value: "a", label: "A", points: 1 }] },
              { id: "dup", text: "t2", options: [{ value: "a", label: "A", points: 1 }] },
            ],
          },
        ],
      },
      /duplicate/i,
    ],
    [{ ...BANK, tiers: [{ min: 50, id: "half", label: "Half" }] }, /tier.*0|0.*tier/i],
  ];
  for (const [bank, why] of cases) {
    const v = validateBank(bank);
    assert.equal(v.ok, false, "expected invalid");
    assert.ok(v.reasons.some((r) => why.test(r)), `reasons ${JSON.stringify(v.reasons)} !~ ${why}`);
    assert.throws(() => score(bank, {}), /TRUST:FAIL/, "score() must refuse an invalid bank");
  }
});

test("scoring does not mutate the bank or the answers", () => {
  const bank = structuredClone(BANK);
  const answers = { idp: "yes" };
  score(bank, answers);
  assert.deepEqual(bank, BANK);
  assert.deepEqual(answers, { idp: "yes" });
});
