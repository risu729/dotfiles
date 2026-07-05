import { exec } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

const execAsync = promisify(exec);

const { stdout: remoteInfo } = await execAsync("git remote show origin");
// In cloudflare workers builds, the url is in the format `https://*****@github.com//owner/repo`
// Not sure why there are two slashes, so use `+` to match one or more slashes
const repoName: string | undefined = remoteInfo.match(
	/Fetch URL:.*github\.com\/+(?<repo>[^/.]+\/[^/.]+)/u,
)?.groups?.["repo"];
if (!repoName) {
	throw new Error("Could not determine repository name from git remote.");
}
const defaultBranch: string | undefined = remoteInfo.match(/HEAD branch: (?<branch>.+)/u)?.groups?.[
	"branch"
];
if (!defaultBranch) {
	throw new Error("Could not determine default branch from git remote.");
}

// Ref: https://vite.dev/config/
export default defineConfig(({ mode }) => ({
	define: {
		"import.meta.env.DEFAULT_BRANCH": JSON.stringify(defaultBranch),
		"import.meta.env.REPO_NAME": JSON.stringify(repoName),
		...(mode === "production"
			? {}
			: { "import.meta.env.GITHUB_TOKEN": JSON.stringify(process.env["GITHUB_TOKEN"]) }),
	},
	plugins: [cloudflare()],
	preview: {
		allowedHosts: ["worker"],
		strictPort: true,
	},
}));
