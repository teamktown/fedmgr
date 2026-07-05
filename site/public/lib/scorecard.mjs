/**
 * Scorecard engine — pure, deterministic scoring of the self-assessment bank.
 *
 * Runs entirely client-side; nothing here talks to the network. The page uses
 * score() to render results and (with explicit consent) submits ONLY the
 * anonymous answers object to the capture endpoint — the engine itself never
 * captures anything.
 *
 * Fail-closed: score() refuses a bank that doesn't validate, and refuses
 * answers that reference unknown questions or options — a tampered or drifted
 * bank must never produce a plausible-looking score.
 */

export function validateBank(bank) {
  const reasons = [];
  if (!bank || typeof bank !== "object") reasons.push("bank is not an object");
  const sections = bank?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    reasons.push("bank has no sections");
  } else {
    const seen = new Set();
    for (const s of sections) {
      if (!s.id || !s.title) reasons.push(`section ${s.id ?? "?"} missing id/title`);
      if (!Array.isArray(s.questions) || s.questions.length === 0) {
        reasons.push(`section ${s.id ?? "?"} has no questions`);
        continue;
      }
      for (const q of s.questions) {
        if (!q.id || !q.text) reasons.push(`question in ${s.id} missing id/text`);
        if (seen.has(q.id)) reasons.push(`duplicate question id "${q.id}"`);
        seen.add(q.id);
        if (!Array.isArray(q.options) || q.options.length < 2) {
          reasons.push(`question "${q.id}" needs >=2 options`);
          continue;
        }
        const values = new Set();
        for (const o of q.options) {
          if (o.value === undefined || o.label === undefined) {
            reasons.push(`option in "${q.id}" missing value/label`);
          }
          if (values.has(o.value)) reasons.push(`duplicate option value "${o.value}" in "${q.id}"`);
          values.add(o.value);
          if (typeof o.points !== "number" || !Number.isFinite(o.points)) {
            reasons.push(`option "${o.value}" in "${q.id}" has non-numeric points`);
          } else if (o.points < 0) {
            reasons.push(`option "${o.value}" in "${q.id}" has negative points`);
          }
        }
      }
    }
  }
  const tiers = bank?.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    reasons.push("bank has no tiers");
  } else {
    if (!tiers.some((t) => t.min === 0)) reasons.push("no tier covers 0 — tiers must include min 0");
    for (const t of tiers) {
      if (!t.id || !t.label || typeof t.min !== "number") {
        reasons.push(`tier ${t.id ?? "?"} missing id/label/min`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * @param bank    a bank that passes validateBank
 * @param answers { [questionId]: optionValue } — partial is fine (unanswered = 0)
 */
export function score(bank, answers) {
  const v = validateBank(bank);
  if (!v.ok) {
    throw new Error(`[TRUST:FAIL] scorecard: invalid bank: ${v.reasons.join("; ")}`);
  }

  const questionIds = new Set(
    bank.sections.flatMap((s) => s.questions.map((q) => q.id))
  );
  for (const qid of Object.keys(answers)) {
    if (!questionIds.has(qid)) {
      throw new Error(`[TRUST:FAIL] scorecard: answer for unknown question "${qid}"`);
    }
  }

  const sections = [];
  const unanswered = [];
  const guidance = [];
  let total = 0;
  let max = 0;

  for (const s of bank.sections) {
    let sPoints = 0;
    let sMax = 0;
    for (const q of s.questions) {
      const qMax = Math.max(...q.options.map((o) => o.points));
      sMax += qMax;
      const value = answers[q.id];
      if (value === undefined) {
        unanswered.push(q.id);
        continue;
      }
      const opt = q.options.find((o) => o.value === value);
      if (!opt) {
        throw new Error(
          `[TRUST:FAIL] scorecard: unknown option "${value}" for question "${q.id}"`
        );
      }
      sPoints += opt.points;
      if (opt.guidance) guidance.push(opt.guidance);
    }
    sections.push({
      id: s.id,
      title: s.title,
      points: sPoints,
      max: sMax,
      pct: sMax > 0 ? Math.round((sPoints / sMax) * 100) : 0,
    });
    total += sPoints;
    max += sMax;
  }

  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  const tier = [...bank.tiers].sort((a, b) => b.min - a.min).find((t) => pct >= t.min);

  return { sections, total, max, pct, tier, unanswered, guidance };
}
