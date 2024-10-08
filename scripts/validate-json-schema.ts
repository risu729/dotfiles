import { basename, dirname, extname, resolve } from "node:path";
import { exit } from "node:process";
import type { AnySchemaObject, Options } from "ajv";
import Ajv04 from "ajv-draft-04";
import addFormats from "ajv-formats";
import Ajv2019 from "ajv/dist/2019";
import draft7MetaSchema from "ajv/dist/refs/json-schema-draft-07.json";
import { file } from "bun";
import walk from "ignore-walk";
import { parse as parseJson5 } from "json5";
import { parse as parseJsonc } from "jsonc-parser";

// configure ajv options for each json file
// ref: https://ajv.js.org/options.html
const config: Record<string, Exclude<Options, "strict" | "loadSchema">> = {
	"biome.jsonc": {
		formats: {
			// cspell:ignore schemars
			// ignore non-standard formats generated by schemars
			// ref: https://github.com/GREsau/schemars/blob/3271fbd96a65c0d15e1cc5d5391810842cae0c28/schemars/src/json_schema_impls/primitives.rs#L89-L96
			uint8: true,
			uint16: true,
			uint64: true,
		},
	},
	"winget.json": {
		// disable using flag `u
		// schema includes a regex pattern with `\-` which is invalid (or unnecessary) escape
		// invalid escape sequences are not allowed with flag `u`
		// ref: https://tc39.es/archives/bugzilla/3157/
		unicodeRegExp: false,
	},
};

const rootDir = dirname(import.meta.dirname);

const jsonFileExtensions = ["json", "jsonc", "json5"];

const jsonPaths = await walk({
	path: rootDir,
	ignoreFiles: [".gitignore"],
}).then((result) =>
	result
		.filter(
			(path) =>
				!path.startsWith(".git") &&
				jsonFileExtensions.includes(extname(path).slice(1)),
		)
		.map((path) => resolve(rootDir, path)),
);

const readJsonFile = async (path: string): Promise<object> => {
	const extension = extname(path).slice(1);
	if (extension === "json") {
		try {
			return await import(path, {
				with: { type: "json" },
			});
		} catch {
			// fallback to jsonc
		}
	}
	const text = await file(path).text();
	if (extension === "json5") {
		return parseJson5(text);
	}
	return parseJsonc(text);
};

const draft04ErrorMessage = "Draft-04 meta schema is not supported";

const loadRemoteSchema =
	(allowDraft04: boolean) =>
	async (uri: string): Promise<AnySchemaObject> => {
		if (!allowDraft04 && uri === "http://json-schema.org/draft-04/schema") {
			// infinite loop occurs when loading draft-04 schema if it is not registered as meta schema
			// ref: https://github.com/ajv-validator/ajv/issues/1821
			throw new Error(draft04ErrorMessage);
		}
		const response = await fetch(uri);
		if (!response.ok) {
			throw new Error(`Failed to fetch schema from ${uri}`);
		}
		return response.json() as Promise<AnySchemaObject>;
	};

const loadSchema = async (
	path: string,
	data: object,
): Promise<AnySchemaObject | undefined> => {
	if (!("$schema" in data)) {
		return undefined;
	}
	const schema = data.$schema;
	if (!(typeof schema === "string")) {
		throw new Error("$schema must be a string");
	}
	if (["http", "https"].some((protocol) => schema.startsWith(protocol))) {
		return await loadRemoteSchema(true)(schema);
	}
	return await import(resolve(dirname(path), schema), {
		with: { type: "json" },
	});
};

let exitCode = 0;

for (const path of jsonPaths) {
	console.info(`Validating ${path}`);
	const data = await readJsonFile(path);
	const schema = await loadSchema(path, data);
	if (!schema) {
		console.info(`No schema found for ${path}`);
		continue;
	}

	// use draft-2019-09, draft-2020-12, and draft-07 meta schemas by default
	// ref: https://ajv.js.org/guide/schema-language.html#draft-2019-09-and-draft-2020-12
	const ajv = new Ajv2019({
		strict: false,
		// latest version of ajv does not support draft-04 meta schema
		loadSchema: loadRemoteSchema(false),
		...config[basename(path)],
	});
	ajv.addMetaSchema(draft7MetaSchema);
	// add formats not included by default
	addFormats(ajv);

	try {
		const validate = await ajv.compileAsync(schema);
		if (!validate(data)) {
			throw new Error(ajv.errorsText(validate.errors));
		}
	} catch (error) {
		if (!(error instanceof Error && error.message === draft04ErrorMessage)) {
			console.error(error);
			exitCode = 1;
			continue;
		}

		// fallback to ajv-draft-04 if draft-04 meta schema is used
		const ajv = new Ajv04({
			strict: false,
			loadSchema: loadRemoteSchema(true),
			...config[basename(path)],
		});
		// add formats not included by default
		addFormats(ajv);
		try {
			const validate = await ajv.compileAsync(schema);
			if (!validate(data)) {
				throw new Error(ajv.errorsText(validate.errors));
			}
		} catch (error) {
			console.error(error);
			exitCode = 1;
			continue;
		}
	}

	console.info(`Validation succeeded for ${path}`);
}

exit(exitCode);
