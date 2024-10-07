// ref: https://vitest.dev/config/

import { readFile } from "node:fs/promises";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const wranglerToml = await readFile("./wrangler.toml", "utf-8");

// cspell:ignore workerd
// extract the compatibility_date from the compatibility_workerd_version in wrangler.toml;
// ref: github.com/cloudflare/workers-sdk/blob/81dfb1746a2b2a17c06f809b2da9f937810ca701/packages/create-cloudflare/src/helpers/compatDate.ts#L27-L28
const compatibilityDateRegex =
	/# *compatibility_workerd_version *= *"\d+\.(\d{4})(\d{2})(\d{2})\.\d+"/;
const compatibilityDateMatch = wranglerToml.match(compatibilityDateRegex);
if (!compatibilityDateMatch) {
	throw new Error(
		"Could not find compatibility_workerd_version in wrangler.toml",
	);
}

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: {
					configPath: "./wrangler.toml",
				},
				// merged with the config in wrangler.toml
				// ref: https://github.com/cloudflare/workers-sdk/blob/e42f32071871b0208e9f00cfd7078d8a5c03fe38/packages/vitest-pool-workers/src/pool/config.ts#L208
				// cspell:ignore miniflare
				miniflare: {
					compatibilityDate: `${compatibilityDateMatch[1]}-${compatibilityDateMatch[2]}-${compatibilityDateMatch[3]}`,
				},
				singleWorker: true,
			},
		},
	},
});
