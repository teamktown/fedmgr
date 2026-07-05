/**
 * fedmgr search — semantic (vector) discovery over federation entities.
 *
 * search <query> [--ta <url>] [--k <n>] [--json]
 *   Ranks registered entities by how well their id + metadata match a
 *   natural-language query, via the Trust Anchor's /federation_search endpoint
 *   (backed by a local RuVector .rvf HNSW index — no external service).
 *
 * Examples:
 *   fedmgr search "who can issue trust marks?"
 *   fedmgr search "weather mcp server" --k 3 --json
 */
import { type Command } from "commander";

const DEFAULT_TA = "http://localhost:8090";

interface SearchResultItem {
  entityId: string;
  status?: string;
  score: number;
  distance: number;
}

export function registerSearchCommands(program: Command): void {
  program
    .command("search")
    .description("Semantic search over registered federation entities")
    .argument("<query>", "Natural-language description of the entity to find")
    .option("--ta <url>", "Trust Anchor server base URL", DEFAULT_TA)
    .option("--k <n>", "Maximum number of results (default 5, max 50)", "5")
    .option("--json", "Output the full JSON response")
    .action(
      async (query: string, opts: { ta: string; k: string; json?: boolean }) => {
        const kParsed = parseInt(opts.k, 10);
        const k = !isNaN(kParsed) && kParsed > 0 ? Math.min(kParsed, 50) : 5;

        const url =
          `${opts.ta.replace(/\/$/, "")}/federation_search` +
          `?q=${encodeURIComponent(query)}&k=${encodeURIComponent(String(k))}`;

        let res: Response;
        try {
          res = await fetch(url);
        } catch (err) {
          process.stderr.write(
            `[search] Cannot reach Trust Anchor at ${opts.ta}: ${String(err)}\n` +
              "  Recommended: start it with  npm run ta:dev  (local).\n",
          );
          process.exit(1);
        }

        if (!res.ok) {
          const text = await res.text();
          process.stderr.write(`[search] TA returned ${res.status}: ${text}\n`);
          process.exit(1);
        }

        const data = (await res.json()) as {
          query: string;
          count: number;
          results: SearchResultItem[];
        };

        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + "\n");
          return;
        }

        if (data.results.length === 0) {
          process.stdout.write(`No federation entities matched "${query}".\n`);
          return;
        }

        process.stdout.write(
          `Top ${data.results.length} matches for "${query}":\n\n`,
        );
        data.results.forEach((r, i) => {
          const pct = (r.score * 100).toFixed(1);
          const status = r.status ? ` [${r.status}]` : "";
          process.stdout.write(
            `  ${i + 1}. ${r.entityId}${status}  —  ${pct}% match\n`,
          );
        });
      },
    );
}
