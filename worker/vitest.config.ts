// ref: https://vitest.dev/config/

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { $ } from "execa";

const { stdout: compatibilityDate } =
	await $`mise run worker:wrangler-compat-date`;

export default defineWorkersConfig({
	test: {
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
