import { execSync } from "node:child_process";
import process from "node:process";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

const currentBranch =
	// biome-ignore lint/nursery/noProcessEnv: Bun.env cannot be used in vite
	process.env["CURRENT_BRANCH"] ??
	execSync("git branch --show-current").toString().trim();
if (!currentBranch) {
	throw new Error("Could not determine current branch from git.");
}
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
					// use current branch name as default branch for testing
					// biome-ignore lint/style/useNamingConvention: env var
					DEFAULT_BRANCH: currentBranch,

					// define in vite.config.ts does not work in vitest, so define here
					// biome-ignore lint/style/useNamingConvention: env var
					// biome-ignore lint/nursery/noProcessEnv: Bun.env cannot be used in vite
					GITHUB_TOKEN: process.env["GITHUB_TOKEN"],

					// biome-ignore lint/style/useNamingConvention: env var
					LATEST_COMMIT_HASH: latestCommitHash,
					// fix constants in tests
					// biome-ignore lint/style/useNamingConvention: env var
					REPO_NAME: "risu729/dotfiles",
				},
				poolOptions: {
					workers: {
						singleWorker: true,
						wrangler: {
							configPath: "./wrangler.jsonc",
						},
					},
				},
			},
		}),
	),
);
