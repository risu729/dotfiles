import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		compatibilityDate: "2026-07-30",
		compatibilityFlags: ["nodejs_compat"],
		domains: ["dot.risunosu.com"],
		entrypoint: "src/index.ts",
		name: "dotfiles-worker",
		observability: {
			logs: {
				enabled: true,
			},
			traces: {
				enabled: true,
			},
		},
		placement: {
			mode: "smart",
		},
		previewUrls: true,
		workersDev: false,
	},
});
