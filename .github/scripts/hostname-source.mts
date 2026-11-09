const ensure: (condition: unknown) => asserts condition = (condition) => {
	if (!condition) {
		throw new Error("Unsupported or ambiguous hostname source configuration.");
	}
};
const lex = (source: string) => {
	const pattern =
		/\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[0-9]+(?:\.[0-9]+)?|\.\.\.|=>|[{}()[\],:;?.=<>!+*/&|%-]/guy;
	const tokens = [];
	while (pattern.lastIndex < source.length) {
		const match = pattern.exec(source);
		ensure(match !== null);
		if (!/^\s|^\/\//u.test(match[0]) && !match[0].startsWith("/*")) {
			tokens.push(match[0]);
		}
	}
	return tokens;
};
const closeIndex = (tokens: readonly string[], start: number): number => {
	const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
	const stack = [];
	for (let index = start; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (Object.hasOwn(closing, token)) {
			stack.push(closing[token]!);
		} else if ([")", "]", "}"].includes(token)) {
			ensure(stack.pop() === token);
			if (stack.length === 0) {
				return index;
			}
		}
	}
	throw new Error("Unbalanced hostname source configuration.");
};
const valueEnd = (tokens: readonly string[], start: number, end: number) => {
	let index = start;
	while (index < end && tokens[index] !== ",") {
		index = ["(", "[", "{"].includes(tokens[index]!) ? closeIndex(tokens, index) + 1 : index + 1;
	}
	return index;
};
const readProperty = (
	tokens: readonly string[],
	position: number,
	result: Map<string, readonly string[]>,
) => {
	const key = tokens[position]!;
	ensure(/^[A-Za-z_$][\w$]*$/u.test(key) && !result.has(key));
	const explicit = tokens[position + 1] === ":";
	ensure(explicit || tokens[position + 1] === "," || position + 1 === tokens.length - 1);
	const start = explicit ? position + 2 : position;
	const end = valueEnd(tokens, start, tokens.length - 1);
	ensure(end > start);
	result.set(key, tokens.slice(start, end));
	return end + 1;
};
const objectProperties = (tokens: readonly string[]) => {
	ensure(tokens[0] === "{" && closeIndex(tokens, 0) === tokens.length - 1);
	const result = new Map<string, readonly string[]>();
	let position = 1;
	while (position < tokens.length - 1) {
		position = readProperty(tokens, position, result);
	}
	return result;
};
const rootObject = (tokens: readonly string[], start: number) => {
	const prefix = tokens.slice(start, start + 7).join("");
	const callback = prefix === "({isPreview})=>(";
	const open = callback ? start + 7 : start;
	ensure(tokens[open] === "{");
	const close = closeIndex(tokens, open);
	const suffix = tokens.slice(close + 1).join("");
	ensure(suffix === (callback ? "));" : ");") || suffix === (callback ? "))" : ")"));
	return { previewCallback: callback, properties: objectProperties(tokens.slice(open, close + 1)) };
};
const trustedConfigImport = (tokens: readonly string[], kind: string) => {
	const imports = tokens.flatMap((token, index) =>
		token === "import" && tokens[index + 1] === "{" ? [index] : [],
	);
	const trusted = imports.filter((index) => {
		const close = closeIndex(tokens, index + 1);
		const names = tokens.slice(index + 2, close).filter((name) => name !== ",");
		return (
			tokens[close + 1] === "from" &&
			tokens[close + 2] === '"cf/config"' &&
			names.includes("defineConfig") &&
			names.every((name) => ["bindings", "defineConfig", "triggers"].includes(name))
		);
	});
	ensure(trusted.length === 1 && tokens.filter((token) => token === "defineConfig").length === 2);
	if (kind === "route") {
		const start = trusted[0]!;
		const close = closeIndex(tokens, start + 1);
		ensure(tokens.slice(start + 2, close).includes("triggers"));
		const calls = tokens.filter(
			(token, index) =>
				token === "triggers" &&
				tokens[index + 1] === "." &&
				tokens[index + 2] === "fetch" &&
				tokens[index + 3] === "(",
		).length;
		ensure(tokens.filter((token) => token === "triggers").length === calls + 2);
	}
};
const literal = (tokens: readonly string[] | undefined): string => {
	ensure(tokens?.length === 1 && tokens[0]?.startsWith('"'));
	const decoded: unknown = JSON.parse(tokens[0]!);
	ensure(typeof decoded === "string");
	return decoded;
};
const configuredWorker = (source: string, kind: string) => {
	const tokens = lex(source);
	trustedConfigImport(tokens, kind);
	const exports = tokens.flatMap((token, index) =>
		token === "export" && tokens[index + 1] === "default" ? [index] : [],
	);
	ensure(exports.length === 1);
	const start = exports[0]!;
	ensure(tokens[start + 2] === "defineConfig" && tokens[start + 3] === "(");
	const root = rootObject(tokens, start + 4);
	ensure(root.properties.has("worker"));
	return {
		accountId: root.properties.has("accountId") ? literal(root.properties.get("accountId")) : null,
		previewCallback: root.previewCallback,
		properties: objectProperties(root.properties.get("worker")!),
	};
};
const productionDomains = (tokens: readonly string[] | undefined, previewCallback: boolean) => {
	ensure(tokens?.[0] !== "isPreview" || previewCallback);
	const production = tokens?.slice(0, 5).join("") === "isPreview?[]:" ? tokens.slice(5) : tokens;
	ensure(production?.[0] === "[" && production.at(-1) === "]");
	const values = [];
	for (let index = 1; index < production.length - 1; index += 2) {
		values.push(literal([production[index]!]));
		ensure(index + 1 === production.length - 1 || production[index + 1] === ",");
	}
	return values;
};
const routeDeclaration = (tokens: readonly string[]) => {
	ensure(tokens.slice(0, 5).join("") === "triggers.fetch({" && tokens.at(-1) === ")");
	const object = objectProperties(tokens.slice(4, -1));
	ensure(object.size === 2 && object.has("pattern") && object.has("zone"));
	return { pattern: literal(object.get("pattern")), zone: literal(object.get("zone")) };
};
const fetchRoutes = (tokens: readonly string[] | undefined) => {
	ensure(tokens?.[0] === "[" && closeIndex(tokens, 0) === tokens.length - 1);
	const routes = [];
	let position = 1;
	while (position < tokens.length - 1) {
		const end = valueEnd(tokens, position, tokens.length - 1);
		routes.push(routeDeclaration(tokens.slice(position, end)));
		position = end + 1;
	}
	return routes;
};
const extract = (source: string, kind: string) => {
	const worker = configuredWorker(source, kind);
	return {
		accountId: worker.accountId,
		name: literal(worker.properties.get("name")),
		values:
			kind === "domain"
				? productionDomains(worker.properties.get("domains"), worker.previewCallback)
				: fetchRoutes(worker.properties.get("triggers")),
	};
};
const sourceGuard = { extract };
export default sourceGuard;
