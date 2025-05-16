// ref: https://vitest.dev/config/

import { execSync } from "node:child_process";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const compatibilityDate = execSync("mise run worker:wrangler:compat-date")
	.toString()
	.trim();
const latestCommitHash = execSync("git rev-parse HEAD").toString().trim();

export default defineWorkersConfig({
	test: {
		env: {
			// biome-ignore lint/style/useNamingConvention: env var
			LATEST_COMMIT_HASH: latestCommitHash,
		},
		poolOptions: {
			workers: {
				wrangler: {
					configPath: "./wrangler.jsonc",
				},
				// merged with wrangler.jsonc
				// ref: https://github.com/cloudflare/workers-sdk/blob/e42f32071871b0208e9f00cfd7078d8a5c03fe38/packages/vitest-pool-workers/src/pool/config.ts#L208
				// cspell:ignore miniflare
				miniflare: {
					compatibilityDate: compatibilityDate,
				},
				singleWorker: true,
			},
		},
	},
});
