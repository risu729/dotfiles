import { appendFile } from "node:fs/promises";

const apiRoot = "https://api.cloudflare.com/client/v4";
type Envelope = {
	success?: boolean;
	result: unknown;
	result_info?: { page?: number; per_page?: number; total_count?: number };
};

type Body = Record<string, unknown>;

type Api = (method: string, path: string, body?: Body) => Promise<Envelope> | Envelope;

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> | unknown };

type Fetcher = (url: string, options: RequestInit) => Promise<FetchResponse> | FetchResponse;

const stable = (value: unknown) =>
	JSON.stringify(value, (_: string, item: unknown) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(
					Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
				)
			: item,
	);
const same = (left: unknown, right: unknown) => stable(left) === stable(right);
class MaintenanceError extends Error {}
const requireThat: (condition: unknown, message: string) => asserts condition = (
	condition,
	message,
) => {
	if (!condition) {
		throw new MaintenanceError(message);
	}
};

const safeFetch = async (fetcher: Fetcher, url: string, options: RequestInit) => {
	try {
		return await fetcher(url, options);
	} catch {
		throw new MaintenanceError(
			"Cloudflare transport failed; no automatic retry or permission change is attempted.",
		);
	}
};
const createApi = (
	token: string | undefined,
	fetcher: Fetcher = (url, options) => fetch(url, options),
): Api => {
	requireThat(token && !/[\r\n]/u.test(token), "A Cloudflare token is required.");
	return async (method, path, body) => {
		const response = await safeFetch(fetcher, `${apiRoot}${path}`, {
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			method,
			redirect: "error",
			signal: AbortSignal.timeout(30000),
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		// Never emit response bodies, headers, credentials or transport error causes.
		requireThat(
			response.ok,
			`Cloudflare ${method} failed with HTTP ${response.status}; no permission is added automatically.`,
		);
		const envelope = (await response.json()) as Envelope;
		requireThat(
			envelope.success === true && envelope.result !== undefined,
			"Cloudflare returned an invalid result.",
		);
		return envelope;
	};
};

const summarize = async (
	plan: { changes: unknown; digest: string; revision: string },
	operation: string,
	summaryPath: string | undefined,
) => {
	const summary = `Hostname maintenance: ${operation}\nRevision: ${plan.revision}\nPlan SHA-256: ${plan.digest}\nChanges: ${JSON.stringify(plan.changes)}\n`;
	console.log(summary);
	if (summaryPath) {
		await appendFile(summaryPath, `\n\`\`\`text\n${summary}\`\`\`\n`);
	}
};
const hostnameSupport = { MaintenanceError, createApi, requireThat, same, stable, summarize };
export default hostnameSupport;
