/* oxlint-disable vitest/require-hook -- Node test registration is not Vitest setup code; this harness intentionally loads no application dependencies. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
// oxlint-disable-next-line vitest/no-import-node-test -- The maintenance harness uses the Node standard library without loading application dependencies.
import { test as nodeTest } from "node:test";

import maintenance from "./hostname-maintenance.mjs";

const { prepare, apply, createApi, validateSource, targets } = maintenance;

const revision = "a".repeat(40);
const domainTarget = {
	hostname: "example.test",
	kind: "domain",
	worker: "example",
	zoneId: "zone",
};
const routeTarget = {
	kind: "route",
	patterns: ["example.test/docs", "example.test/docs/*"],
	worker: "docs",
	zoneId: "zone",
};
const attachment = {
	enabled: true,
	environment: "production",
	hostname: "example.test",
	id: "domain-1",
	previews_enabled: false,
	service: "example",
	zone_id: "zone",
};
const readFake = (state, path) => {
	const readers = [
		["/schedules", () => ({ result: [{ cron: "0 0 * * *" }] })],
		["/subdomain", () => ({ result: { enabled: false, previews_enabled: false } })],
		[
			"/workers/domains?",
			() => ({
				result: structuredClone(state.domains),
				result_info: { page: 1, per_page: 100, total_count: state.domains.length },
			}),
		],
		[
			"/dns_records?",
			() => ({ result: state.dns, result_info: { total_count: state.dns.length } }),
		],
		["/workers/routes", () => ({ result: structuredClone(state.routes) })],
	];
	const reader = readers.find(([suffix]) => path.includes(suffix));
	assert.ok(reader);
	return reader[1]();
};
const writeFake = (state, { method, path, body }) => {
	state.writes.push({ body, method, path });
	if (method === "PUT" && path.endsWith("/workers/domains")) {
		state.domains.push({ ...body, environment: "production", id: "domain-new" });
		return { result: state.domains.at(-1) };
	}
	if (method === "POST" && path.endsWith("/workers/routes")) {
		state.routes.push({ ...body, id: `route-${state.routes.length}` });
		return { result: state.routes.at(-1) };
	}
	throw new Error(`Unexpected write: ${method} ${path}`);
};
const fake = ({ domains = [], routes = [], dns = [] } = {}) => {
	const state = {
		dns,
		domains: structuredClone(domains),
		routes: structuredClone(routes),
		writes: [],
	};
	const api = (method, path, body) =>
		method === "GET" ? readFake(state, path) : writeFake(state, { body, method, path });
	return { api, state };
};

const permissionError = (error) =>
	error.message.includes("403") && !error.message.includes("synthetic-test-secret");
const inventoryOverride = (api, response) => (method, path, body) =>
	path.includes("/workers/domains?") ? response(path) : api(method, path, body);

nodeTest("source declarations match every reviewed target without executing config", async () => {
	await Promise.all(Object.values(targets).map((target) => validateSource(target)));
});
nodeTest("source guard rejects an unreviewed hostname", async () => {
	const root = await mkdtemp(`${tmpdir()}/hostname-test-`);
	try {
		await mkdir(`${root}/config`);
		await writeFile(
			`${root}/config/cloudflare.config.ts`,
			'import { defineConfig } from "cf/config"; export default defineConfig({worker: {name: "example", domains: ["other.test"]}});',
		);
		await assert.rejects(
			validateSource({ ...domainTarget, config: "config/cloudflare.config.ts" }, root),
			/allowlist/u,
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
nodeTest("matching domain plan and approved apply are both no-ops", async () => {
	const { api, state } = fake({ domains: [attachment] });
	const plan = await prepare(api, domainTarget, revision);
	assert.deepEqual(plan.changes, []);
	await apply(api, plan, plan.digest);
	assert.deepEqual(state.writes, []);
});
nodeTest("domain plan is read-only and includes one explicit attachment", async () => {
	const { api, state } = fake();
	const plan = await prepare(api, domainTarget, revision);
	assert.equal(plan.changes.length, 1);
	assert.equal(plan.changes[0].method, "PUT");
	assert.deepEqual(state.writes, []);
});
nodeTest("existing DNS blocks even initial domain attachment", async () => {
	const { api, state } = fake({ dns: [{ content: "100::", type: "AAAA" }] });
	await assert.rejects(prepare(api, domainTarget, revision), /Existing.*DNS/u);
	assert.deepEqual(state.writes, []);
});
nodeTest("a domain owned by another Worker cannot be taken over", async () => {
	const { api, state } = fake({ domains: [{ ...attachment, service: "other" }] });
	await assert.rejects(prepare(api, domainTarget, revision), /conflicting/u);
	assert.deepEqual(state.writes, []);
});
nodeTest("wrong confirmation digest prevents every write", async () => {
	const { api, state } = fake();
	const plan = await prepare(api, domainTarget, revision);
	await assert.rejects(apply(api, plan, "b".repeat(64)), /reviewed digest/u);
	assert.deepEqual(state.writes, []);
});
nodeTest("drift after plan invalidates apply before mutation", async () => {
	const { api, state } = fake();
	const plan = await prepare(api, domainTarget, revision);
	state.domains.push({ ...attachment, hostname: "other.test", id: "elsewhere" });
	await assert.rejects(apply(api, plan, plan.digest), /changed after planning/u);
	assert.deepEqual(state.writes, []);
});
nodeTest(
	"domain apply uses only the public attachment endpoint and verifies readback",
	async () => {
		const { api, state } = fake();
		const plan = await prepare(api, domainTarget, revision);
		await apply(api, plan, plan.digest);
		assert.equal(state.writes.length, 1);
		assert.equal(state.writes[0].method, "PUT");
		assert.match(state.writes[0].path, /\/workers\/domains$/u);
		assert.equal(state.domains[0].service, "example");
	},
);
nodeTest(
	"routes preserve unrelated paths and only create the two exact docs patterns",
	async () => {
		const other = {
			id: "unrelated",
			pattern: "example.test/docs-other",
			request_limit_fail_open: false,
			script: "api",
		};
		const { api, state } = fake({ routes: [other] });
		const plan = await prepare(api, routeTarget, revision);
		await apply(api, plan, plan.digest);
		assert.deepEqual(
			state.writes.map(({ body }) => body.pattern),
			routeTarget.patterns,
		);
		assert.deepEqual(
			state.routes.find(({ id }) => id === "unrelated"),
			other,
		);
	},
);
nodeTest("conflicting route ownership is refused", async () => {
	const { api, state } = fake({
		routes: [
			{
				id: "conflict",
				pattern: "example.test/docs",
				request_limit_fail_open: false,
				script: "other",
			},
		],
	});
	await assert.rejects(prepare(api, routeTarget, revision), /conflicting/u);
	assert.deepEqual(state.writes, []);
});
nodeTest("403 fails closed without exposing the token or API response", async () => {
	const token = "synthetic-test-secret";
	const api = createApi(token, () => ({
		json: () => {
			throw new Error(token);
		},
		ok: false,
		status: 403,
	}));
	await assert.rejects(api("GET", "/test"), permissionError);
});
nodeTest("incomplete domain pagination prevents a misleading empty plan", async () => {
	const { api } = fake();
	const incomplete = inventoryOverride(api, () => ({ result: [] }));
	await assert.rejects(prepare(incomplete, domainTarget, revision), /pagination/u);
});

const hostileSources = [
	'import { defineConfig } from "cf/config"; // worker: { name: "example", domains: ["example.test"] }\nexport default defineConfig({worker:{name:actualName,domains:actualDomains}});',
	'import { defineConfig } from "cf/config"; export default defineConfig({worker:{name:"example",domains:["example.test"],...override}});',
	'import { defineConfig } from "cf/config"; if(false){const config={worker:{name:"example",domains:["example.test"]}}} export default defineConfig(dynamic);',
	'import { defineConfig } from "cf/config"; export default defineConfig({worker:{name:"example",domains:["example.test"],domains:dynamic}});',

	'import { defineConfig } from "cf/config"; const isPreview=true; export default defineConfig({worker:{name:"example",domains:isPreview?[]:["example.test"]}});',
	'const defineConfig=()=>({worker:{name:"other",domains:["other.test"]}}); export default defineConfig({worker:{name:"example",domains:["example.test"]}});',
	'import { defineConfig } from "cf/config"; export default defineConfig({accountId:"other",worker:{name:"example",domains:["example.test"]}});',
];
for (const [index, source] of hostileSources.entries()) {
	nodeTest(`source parser rejects hostile configuration ${index}`, async () => {
		const root = await mkdtemp(`${tmpdir()}/hostname-hostile-`);
		try {
			await writeFile(`${root}/config.ts`, source);
			await assert.rejects(validateSource({ ...domainTarget, config: "config.ts" }, root));
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
}
nodeTest("overlapping domain pages are refused", async () => {
	const { api } = fake();
	const overlap = inventoryOverride(api, (path) => ({
		result: [attachment],
		result_info: {
			page: Number(new URL(`https://example.test${path}`).searchParams.get("page")),
			per_page: 100,
			total_count: 2,
		},
	}));
	await assert.rejects(prepare(overlap, domainTarget, revision), /repeated/u);
});

nodeTest("route source rejects a local triggers factory", async () => {
	const root = await mkdtemp(`${tmpdir()}/hostname-route-source-`);
	try {
		await writeFile(
			`${root}/config.ts`,
			'import { defineConfig } from "cf/config"; const triggers={fetch:()=>({pattern:"other.test/*"})}; export default defineConfig({worker:{name:"docs",triggers:[triggers.fetch({pattern:"example.test/docs",zone:"test"}),triggers.fetch({pattern:"example.test/docs/*",zone:"test"})]}});',
		);
		await assert.rejects(
			validateSource({ ...routeTarget, config: "config.ts", zone: "test" }, root),
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

nodeTest("route source rejects mutation of the imported factory", async () => {
	const root = await mkdtemp(`${tmpdir()}/hostname-route-mutation-`);
	try {
		await writeFile(
			`${root}/config.ts`,
			'import { defineConfig,triggers } from "cf/config"; triggers.fetch=()=>({pattern:"other.test/*"}); export default defineConfig({worker:{name:"docs",triggers:[triggers.fetch({pattern:"example.test/docs",zone:"test"}),triggers.fetch({pattern:"example.test/docs/*",zone:"test"})]}});',
		);
		await assert.rejects(
			validateSource({ ...routeTarget, config: "config.ts", zone: "test" }, root),
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
