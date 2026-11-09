import { env as rawEnvironment } from "node:process";

const environment = rawEnvironment as Partial<
	Record<
		| "CLOUDFLARE_ACCOUNT_ID"
		| "CLOUDFLARE_API_TOKEN"
		| "EXPECTED_PLAN_SHA256"
		| "GITHUB_REF"
		| "GITHUB_SHA"
		| "GITHUB_STEP_SUMMARY"
		| "MAINTENANCE_OPERATION"
		| "MAINTENANCE_TARGET",
		string
	>
>;
const account = "59ea63cc00914b30ca410b062ae2bb7f";
const targets = {
	worker: {
		config: "worker/cloudflare.config.ts",
		hostname: "dot.risunosu.com",
		kind: "domain",
		worker: "dotfiles-worker",
		zone: "risunosu.com",
		zoneId: "0f7a733f9599c0ca267f2d084e8b808c",
	},
} as const;

const hostnameConfig = { account, environment, targets };
export default hostnameConfig;
