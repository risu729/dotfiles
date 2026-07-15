import process from "node:process";

import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Ref: https://vite.dev/config/
export default defineConfig(({ mode }) => ({
	define: {
		"import.meta.env.DEFAULT_BRANCH": JSON.stringify("main"),
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
