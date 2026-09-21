import { createLocalEmbedder, MODEL_CACHE_DIR } from "./embeddings.ts";

/**
 * `npm run memory:model`: loads the embedding model once, with network
 * access allowed, so it lands in `MODEL_CACHE_DIR` (R-006) before `npm
 * test` or `npm run dev` need it. Without this, the FIRST request that
 * sends a `userId` (or the FIRST run of the real-model test,
 * embeddings.test.ts) pays the download; running this once up front is
 * what lets `npm test` show the semantic-recall test as passing instead
 * of skipped (quickstart.md, step 2).
 */
async function main(): Promise<void> {
  console.log(`Baixando o modelo de embeddings em ${MODEL_CACHE_DIR} ...`);
  const embedder = createLocalEmbedder({ allowRemote: true });
  await embedder.embed("teste de carregamento do modelo");
  console.log("Modelo pronto.");
}

main().catch((error: unknown) => {
  console.error("Falha ao baixar o modelo:", error instanceof Error ? error.message : error);
  process.exit(1);
});
