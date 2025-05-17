// ref: https://vitest.dev/config/

import { execSync } from "node:child_process";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

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
				singleWorker: true,
			},
		},
	},
});
