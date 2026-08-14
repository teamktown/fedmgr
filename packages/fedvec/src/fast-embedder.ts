/**
 * FastEmbedder — local ONNX MiniLM embeddings via fastembed.
 *
 * Wraps `all-MiniLM-L6-v2` (384-dim). The model is fetched once into a cache
 * dir and then runs fully offline on CPU — no OpenAI/Cohere/Voyage API, no
 * per-call cost, no rate limits, no data leaving the host. This is the
 * higher-quality (true paraphrase-level) alternative to HashEmbedder.
 *
 * The fastembed dependency is loaded lazily the first time an embedding is
 * requested, so importing fedvec never triggers a model download on its own.
 */
import { Embedder, l2normalize } from "./embedder.js";

const MINILM_DIMS = 384;

export interface FastEmbedderOptions {
  /** Directory to cache the downloaded ONNX model. Default: fastembed default. */
  cacheDir?: string;
  /** Max token length per document. Default: fastembed default (512). */
  maxLength?: number;
  /** Print model download progress to stderr. Default: false. */
  showDownloadProgress?: boolean;
}

export class FastEmbedder implements Embedder {
  readonly dimensions = MINILM_DIMS;
  readonly id = "minilm-l6-v2-384";

  private readonly options: FastEmbedderOptions;
  // Lazily-initialized FlagEmbedding instance (typed as unknown to avoid a
  // hard type dependency on fastembed at fedvec's public surface).
  private modelPromise: Promise<{
    embed(texts: string[], batchSize?: number): AsyncGenerator<number[][], void, unknown>;
    queryEmbed(query: string): Promise<number[]>;
  }> | null = null;

  constructor(options: FastEmbedderOptions = {}) {
    this.options = options;
  }

  private async model() {
    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
        return FlagEmbedding.init({
          model: EmbeddingModel.AllMiniLML6V2,
          ...(this.options.cacheDir ? { cacheDir: this.options.cacheDir } : {}),
          ...(this.options.maxLength ? { maxLength: this.options.maxLength } : {}),
          showDownloadProgress: this.options.showDownloadProgress ?? false,
        });
      })();
    }
    return this.modelPromise;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = await this.model();
    const out: number[][] = [];
    for await (const batch of model.embed(texts)) {
      for (const v of batch) out.push(l2normalize(Array.from(v)));
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const model = await this.model();
    return l2normalize(Array.from(await model.queryEmbed(text)));
  }
}
