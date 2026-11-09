import { createHash } from "node:crypto";
import { readFile, appendFile } from "node:fs/promises";
import { env as environment } from "node:process";
import { pathToFileURL } from "node:url";

import sourceGuard from "./hostname-source.mjs";

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
};
const apiRoot = "https://api.cloudflare.com/client/v4";
const stable = (value) =>
	JSON.stringify(value, (_, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(
					Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
				)
			: item,
	);
const same = (left, right) => stable(left) === stable(right);
class MaintenanceError extends Error {}
const requireThat = (condition, message) => {
	if (!condition) {
		throw new MaintenanceError(message);
	}
};

const validateSource = async (target, root = ".") => {
	const source = await readFile(`${root}/${target.config}`, "utf8");
	const actual = sourceGuard.extract(source, target.kind);
	const expected =
		target.kind === "domain"
			? [target.hostname]
			: target.patterns.map((pattern) => ({ pattern, zone: target.zone }));
	requireThat(
		(actual.accountId === null || actual.accountId === account) &&
			actual.name === target.worker &&
			same(actual.values, expected),
		"Production source differs from the reviewed hostname allowlist.",
	);
};

const safeFetch = async (fetcher, url, options) => {
	try {
		return await fetcher(url, options);
	} catch {
		throw new MaintenanceError(
			"Cloudflare transport failed; no automatic retry or permission change is attempted.",
		);
	}
};
const createApi = (token, fetcher = fetch) => {
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
		const envelope = await response.json();
		requireThat(
			envelope.success === true && envelope.result !== undefined,
			"Cloudflare returned an invalid result.",
		);
		return envelope;
	};
};

const checkDomainPage = (response, page, pagination) => {
	requireThat(Array.isArray(response.result), "Domain inventory is not a list.");
	requireThat(
		response.result_info?.page === page && response.result_info?.per_page === 100,
		"Domain pagination returned an unexpected page.",
	);
	requireThat(
		pagination.total === null || pagination.total === response.result_info?.total_count,
		"Domain pagination total changed during reading.",
	);
	pagination.total = response.result_info?.total_count;
	for (const entry of response.result) {
		requireThat(
			typeof entry.id === "string" && !pagination.seen.has(entry.id),
			"Domain pagination repeated an attachment.",
		);
		pagination.seen.add(entry.id);
	}
	pagination.records.push(...response.result);
	requireThat(
		Number.isInteger(pagination.total) && pagination.total >= pagination.records.length,
		"Domain pagination is incomplete.",
	);
};
const domains = async (api) => {
	const pagination = { records: [], seen: new Set(), total: null };
	for (let page = 1; page <= 100; page += 1) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Each page must be validated before requesting the next one.
		const response = await api(
			"GET",
			`/accounts/${account}/workers/domains?page=${page}&per_page=100`,
		);
		checkDomainPage(response, page, pagination);
		if (pagination.records.length === pagination.total) {
			return pagination.records.sort((left, right) => left.id.localeCompare(right.id));
		}
		requireThat(response.result.length > 0, "Domain pagination made no progress.");
	}
	throw new Error("Domain pagination exceeded its bound.");
};

const snapshot = async (api, target) => {
	const base = `/accounts/${account}/workers/scripts/${target.worker}`;
	const schedules = (await api("GET", `${base}/schedules`)).result;
	const subdomain = (await api("GET", `${base}/subdomain`)).result;
	if (target.kind === "domain") {
		return { domains: await domains(api), schedules, subdomain };
	}
	const routes = (await api("GET", `/zones/${target.zoneId}/workers/routes`)).result;
	requireThat(Array.isArray(routes), "Route inventory is not a list.");
	return {
		routes: routes.sort((left, right) => left.id.localeCompare(right.id)),
		schedules,
		subdomain,
	};
};

const domainChanges = async (api, target, before) => {
	const matches = before.domains.filter((domain) => domain.hostname === target.hostname);
	requireThat(matches.length <= 1, "Duplicate hostname attachments require review.");
	if (matches.length) {
		const [domain] = matches;
		requireThat(
			domain.service === target.worker &&
				domain.zone_id === target.zoneId &&
				domain.environment === "production" &&
				domain.enabled === true &&
				domain.previews_enabled === false,
			"An existing domain has conflicting ownership or settings; replacement is refused.",
		);
		return [];
	}
	const dns = await api(
		"GET",
		`/zones/${target.zoneId}/dns_records?name=${target.hostname}&per_page=100`,
	);
	requireThat(
		Array.isArray(dns.result) && dns.result.length === 0 && dns.result_info?.total_count === 0,
		"Existing or incompletely listed DNS prevents domain attachment.",
	);
	return [
		{
			body: {
				enabled: true,
				hostname: target.hostname,
				previews_enabled: false,
				service: target.worker,
				zone_id: target.zoneId,
			},
			method: "PUT",
			path: `/accounts/${account}/workers/domains`,
		},
	];
};
const routeChanges = (target, before) =>
	target.patterns.flatMap((pattern) => {
		const matches = before.routes.filter((route) => route.pattern === pattern);
		requireThat(matches.length <= 1, "Duplicate routes require review.");
		if (matches.length) {
			requireThat(
				matches[0].script === target.worker && matches[0].request_limit_fail_open === false,
				"An existing route has conflicting ownership or settings; replacement is refused.",
			);
			return [];
		}
		return [
			{
				body: { pattern, request_limit_fail_open: false, script: target.worker },
				method: "POST",
				path: `/zones/${target.zoneId}/workers/routes`,
			},
		];
	});
const prepare = async (api, target, revision) => {
	requireThat(/^[a-f0-9]{40}$/u.test(revision), "A full reviewed revision is required.");
	const before = await snapshot(api, target);
	const changes =
		target.kind === "domain"
			? await domainChanges(api, target, before)
			: routeChanges(target, before);
	const digest = createHash("sha256")
		.update(stable({ before, changes, revision, target }))
		.digest("hex");
	return { before, changes, digest, revision, target };
};
const verifyUnrelatedState = (plan, after) => {
	requireThat(
		same(plan.before.schedules, after.before.schedules) &&
			same(plan.before.subdomain, after.before.subdomain),
		"Unrelated schedules or workers.dev settings changed during maintenance.",
	);
	const key = plan.target.kind === "domain" ? "domains" : "routes";
	const intended = (entry) =>
		plan.target.kind === "domain"
			? entry.hostname === plan.target.hostname
			: plan.target.patterns.includes(entry.pattern);
	requireThat(
		same(
			plan.before[key].filter((entry) => !intended(entry)),
			after.before[key].filter((entry) => !intended(entry)),
		),
		"An unrelated hostname or route changed during maintenance.",
	);
};

const apply = async (api, plan, expectedDigest) => {
	requireThat(
		/^[a-f0-9]{64}$/u.test(expectedDigest) && expectedDigest === plan.digest,
		"The current plan differs from the explicitly reviewed digest. Run plan again.",
	);
	// Re-read immediately before mutation; unrelated state changes invalidate the plan too.
	const current = await prepare(api, plan.target, plan.revision);
	requireThat(
		current.digest === plan.digest,
		"Cloudflare changed after planning; no write was attempted.",
	);
	for (const change of plan.changes) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Ordered mutations stop immediately on an ambiguous API failure.
		await api(change.method, change.path, change.body);
	}
	const after = await prepare(api, plan.target, plan.revision);
	requireThat(after.changes.length === 0, "Readback did not confirm every intended attachment.");
	verifyUnrelatedState(plan, after);
	return after;
};

const validateCaller = (operation, target) => {
	requireThat(operation === "plan" || operation === "apply", "Choose plan or apply.");
	requireThat(target, "Unknown maintenance target.");
	requireThat(environment.GITHUB_REF === "refs/heads/main", "Maintenance is restricted to main.");
	requireThat(environment.CLOUDFLARE_ACCOUNT_ID === account, "Unexpected Cloudflare account.");
};
const summarize = async (plan, operation) => {
	const summary = `Hostname maintenance: ${operation}\nRevision: ${plan.revision}\nPlan SHA-256: ${plan.digest}\nChanges: ${JSON.stringify(plan.changes)}\n`;
	console.log(summary);
	if (environment.GITHUB_STEP_SUMMARY) {
		await appendFile(environment.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${summary}\`\`\`\n`);
	}
};
const main = async () => {
	const operation = environment.MAINTENANCE_OPERATION ?? "plan";
	const target = targets[environment.MAINTENANCE_TARGET ?? "worker"];
	validateCaller(operation, target);
	await validateSource(target);
	const api = createApi(environment.CLOUDFLARE_API_TOKEN);
	const plan = await prepare(api, target, environment.GITHUB_SHA);
	await summarize(plan, operation);
	if (operation === "apply") {
		await apply(api, plan, environment.EXPECTED_PLAN_SHA256 ?? "");
		console.log(
			"API readback verified the requested attachments and unchanged schedules, workers.dev and unrelated routing.",
		);
	}
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		await main();
	} catch (error) {
		console.error(
			error instanceof MaintenanceError
				? error.message
				: "Hostname maintenance failed; inspect source and API metadata before retrying.",
		);
		process.exitCode = 1;
	}
}

const maintenance = { apply, createApi, prepare, targets, validateSource };
export default maintenance;
