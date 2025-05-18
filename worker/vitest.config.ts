import { execSync } from "node:child_process";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const latestCommitHash = execSync("git rev-parse HEAD").toString().trim();
if (!latestCommitHash) {
	throw new Error("Could not determine latest commit hash from git.");
}

// ref: https://vitest.dev/config/
export default mergeConfig(
	viteConfig,
	defineWorkersConfig({
		// fix constants in tests
		define: {
			// biome-ignore lint/style/useNamingConvention: constants
			__REPO_NAME__: JSON.stringify("risu729/dotfiles"),
			// biome-ignore lint/style/useNamingConvention: constants
			__DEFAULT_BRANCH__: JSON.stringify("main"),
		},
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
	}),
);
