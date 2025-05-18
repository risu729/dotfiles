// ref: https://vite.dev/config/

import { execSync } from "node:child_process";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const remoteInfo = execSync("git remote show origin").toString();
// in cloudflare workers builds, the url is in the format `https://*****@github.com//owner/repo`
// not sure why there are two slashes, so use `+` to match one or more slashes
const repoName = remoteInfo.match(
	/Fetch URL:.*github.com\/+(?<repo>[^/.]+\/[^/.]+).*/,
)?.groups?.["repo"];
if (!repoName) {
	throw new Error("Could not determine repository name from git remote.");
}
const defaultBranch = remoteInfo.match(/HEAD branch: (?<branch>.+)/)?.groups?.[
	"branch"
];
if (!defaultBranch) {
	throw new Error("Could not determine default branch from git remote.");
}

const latestCommitHash = execSync("git rev-parse HEAD").toString().trim();
if (!latestCommitHash) {
	throw new Error("Could not determine latest commit hash from git.");
}

export default defineWorkersConfig({
	define: {
		// biome-ignore lint/style/useNamingConvention: constants
		__REPO_NAME__: JSON.stringify(repoName),
		// biome-ignore lint/style/useNamingConvention: constants
		__DEFAULT_BRANCH__: JSON.stringify(defaultBranch),
	},
	plugins: [cloudflare()],
	// ref: https://vitest.dev/config/
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
