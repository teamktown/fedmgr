# Extending Trustmarks

This document describes **where and how** to add new trustmark fields or
create new trustmark types. Read this before modifying the trustmark schema.

---

## Current Schema (v1, Frozen)

The v1 trustmark payload is defined in:

```
services/tmi-server/src/index.ts      — IssueRequestSchema (zod)
packages/schemas/trustmark-v1.json    — (planned, Increment F)
```

| Field | Type | Source |
|---|---|---|
| `iss` | URL | Auto (TMI_ISSUER) |
| `sub` | URL | Caller-supplied |
| `id` | URL | Caller-supplied (default: AssessedAndPasses_minQuality_v1) |
| `iat` | Unix ts | Auto |
| `exp` | Unix ts | Auto (iat + ttl_s) |
| `image_digest` | `sha256:<hex64>` | Optional |
| `repo` | URL | Optional |
| `evidence` | URL | Optional |

**The v1 schema is frozen.** No new fields will be added to `IssueRequestSchema`
without creating a new trustmark type.

---

## How to Add a New Trustmark Type

A "trustmark type" is a new `id` URI. You do NOT need a new endpoint or
server version to add a type — the `id` field distinguishes types at
verification time.

### Step 1 — Define the type URI

Choose a URI following the pattern:
```
https://letsfederate.org/trustmarks/<TypeName>_<version>
```

Example:
```
https://letsfederate.org/trustmarks/CertifiedForMCPUse_v1
```

### Step 2 — Define the payload schema

Create a Zod schema in:
```
services/tmi-server/src/schemas/<type-name>-v1.ts
```

Example:
```typescript
import { z } from "zod";

export const CertifiedForMCPUse_v1 = z.object({
  sub: z.string().url(),
  trustmark_id: z.literal(
    "https://letsfederate.org/trustmarks/CertifiedForMCPUse_v1"
  ),
  mcp_profile: z.string(),           // new field specific to this type
  assessed_date: z.string().date(),  // ISO 8601
  ttl_s: z.number().int().min(60).max(86400).default(3600),
});
```

### Step 3 — Register the schema in the issue endpoint

In `services/tmi-server/src/index.ts`, extend the `IssueRequestSchema`
discriminated union or add a type-specific route:

```typescript
// Option A: discriminated union (recommended for small type sets)
const IssueRequestSchema = z.discriminatedUnion("trustmark_id", [
  ExistingV1Schema,
  CertifiedForMCPUse_v1,
]);

// Option B: separate route for large/complex type schemas
app.post("/trustmarks/issue/certified-mcp-v1", async (req, res) => { ... });
```

### Step 4 — Add to the CLI

In `packages/fedmgr/src/commands/trustmark.ts`, add the type URI to the
`--id` option's choices or documentation:
```typescript
.addHelpText('after', `
  Known trustmark type URIs:
    https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1  (default)
    https://letsfederate.org/trustmarks/CertifiedForMCPUse_v1
`)
```

### Step 5 — Write TDD tests (RED → GREEN → HARDEN)

```
services/tmi-server/test/trustmark-<type-name>.test.mjs
```

Test:
- [ ] Schema validation accepts valid payload
- [ ] Schema validation rejects missing required fields
- [ ] Signed JWS `id` claim matches type URI
- [ ] `fedmgr trustmark issue --id <new-uri>` succeeds end-to-end
- [ ] `fedmgr trustmark verify --jws <token>` succeeds

### Step 6 — Document the OIDF entity statement

If the new type requires an OIDF trust mark declaration in the TMI entity
statement, update `services/tmi-server/src/federation/entity-statements.ts`:

```typescript
export function tmiMetadata(jwksUri: string): Record<string, unknown> {
  return {
    federation_entity: {
      ...existingFields,
      // Add the new type to the declared trust_mark_issuers list
      trust_mark_issuers: {
        "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1": [jwksUri],
        "https://letsfederate.org/trustmarks/CertifiedForMCPUse_v1": [jwksUri],
      },
    },
  };
}
```

---

## How to Add New Fields to an Existing Type

**You cannot modify v1.** Create a v2 type instead:

```
https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v2
```

Follow the same steps above. Old v1 tokens remain valid until their `exp`.

This strict versioning ensures:
- Verifiers that only know v1 are not silently broken by new fields
- The OIDF certification tests run against a stable schema
- Consumers can negotiate by checking the `id` claim

---

## How to Add Optional Fields Within a Version

If a field is **truly optional** and backward-compatible (old verifiers safely
ignore it), add it to the existing schema as `z.unknown().optional()` with a
comment explaining the extension:

```typescript
// Extension point: future fields can be added as optional unknowns.
// Verifiers MUST ignore unknown fields per OIDF spec §4.2.
_ext: z.record(z.unknown()).optional(),
```

Then add specific optional fields as needed:
```typescript
audit_report: z.string().url().optional(),
```

⚠️ Do this sparingly. Prefer new type versions for significant schema changes.

---

## Key Files Reference

| File | Purpose |
|---|---|
| `services/tmi-server/src/index.ts` | `IssueRequestSchema` — add new type schemas here |
| `services/tmi-server/src/federation/entity-statements.ts` | `tmiMetadata()` — declare trust_mark_issuers |
| `packages/fedmgr/src/commands/trustmark.ts` | CLI `--id` option help text |
| `docs/decisions.md` | Decision 3 — schema freeze policy |
| `packages/schemas/` | JSON Schema files (Increment F) |
