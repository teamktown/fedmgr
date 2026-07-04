/**
 * createFederationSearchRouter — semantic (vector) discovery over subordinates.
 *
 * A non-standard fedmgr extension that ranks registered entities by how well
 * their id + metadata match a natural-language query. Backed by a local
 * RuVector `.rvf` HNSW index (via @letsfederate/fedvec) — no external service.
 * The index is rebuilt lazily whenever the active subordinate set changes.
 *
 * GET /federation_search?q=<text>&k=<N>
 *   q  (required)  natural-language query
 *   k  (optional)  max results (default 5, clamped to 50)
 */
import { Router, type Request, type Response } from "express";
import type { FederationIndex, FederationEntity } from "@letsfederate/fedvec";
import type { FederationStore } from "../db/store.js";
import { asyncHandler } from "../utils/async-handler.js";

export function createFederationSearchRouter(
  store: FederationStore,
  index: FederationIndex,
): Router {
  const router = Router();

  router.get(
    "/federation_search",
    asyncHandler(async (req: Request, res: Response) => {
      const q = (req.query["q"] as string | undefined)?.trim();
      if (!q) {
        res.status(400).json({ error: "missing required query parameter 'q'" });
        return;
      }
      const kRaw = parseInt(String(req.query["k"] ?? "5"), 10);
      const k = !isNaN(kRaw) && kRaw > 0 ? Math.min(kRaw, 50) : 5;

      // Only active subordinates are discoverable (mirrors /federation_list).
      const entities: FederationEntity[] = store
        .listSubordinates({ status: "active" })
        .map((row) => ({
          entityId: row.entityId,
          status: row.status,
          metadata: row.metadata,
        }));

      await index.reindexIfChanged(entities);
      const results = await index.search(q, k);

      res.setHeader("Content-Type", "application/json");
      res.json({ query: q, count: results.length, results });
    }),
  );

  return router;
}
