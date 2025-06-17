import { execSync } from "node:child_process";
import process from "node:process";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

const remoteInfo = execSync("git remote show origin").toString();
// in cloudflare workers builds, the url is in the format `https://*****@github.com//owner/repo`
// not sure why there are two slashes, so use `+` to match one or more slashes
const repoName = remoteInfo.match(
	/Fetch URL:.*github\.com\/+(?<repo>[^/.]+\/[^/.]+)/,
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

// ref: https://vite.dev/config/
export default defineConfig(({ mode }) => {
	return {
		define: {
			"import.meta.env.DEFAULT_BRANCH": JSON.stringify(defaultBranch),
			"import.meta.env.REPO_NAME": JSON.stringify(repoName),
			...(mode !== "production"
				? {
						"import.meta.env.GITHUB_TOKEN": JSON.stringify(
							process.env["GITHUB_TOKEN"],
						),
					}
				: {}),
		},
		plugins: [cloudflare()],
		preview: {
			strictPort: true,
		},
	};
});
