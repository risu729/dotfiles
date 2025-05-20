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
			test: {
				env: {
					// fix constants in tests
					// biome-ignore lint/style/useNamingConvention: env var
					REPO_NAME: "risu729/dotfiles",
					// biome-ignore lint/style/useNamingConvention: env var
					DEFAULT_BRANCH: "main",

					// biome-ignore lint/style/useNamingConvention: env var
					LATEST_COMMIT_HASH: latestCommitHash,

					// define in vite.config.ts does not work in vitest, so define here
					// biome-ignore lint/style/useNamingConvention: env var
					// biome-ignore lint/nursery/noProcessEnv: Bun.env cannot be used in vite
					GITHUB_TOKEN: process.env["GITHUB_TOKEN"],
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
