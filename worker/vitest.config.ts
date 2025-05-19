import { execSync } from "node:child_process";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

const latestCommitHash = execSync("git rev-parse HEAD").toString().trim();
if (!latestCommitHash) {
	throw new Error("Could not determine latest commit hash from git.");
}

// ref: https://vitest.dev/config/
export default defineConfig((configEnv) =>
	mergeConfig(
		viteConfig(configEnv),
		defineWorkersConfig({
			// fix constants in tests
			define: {
				"import.meta.env.REPO_NAME": JSON.stringify("risu729/dotfiles"),
				"import.meta.env.DEFAULT_BRANCH": JSON.stringify("main"),
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
	),
);
