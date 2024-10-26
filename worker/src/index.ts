import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { poweredBy } from "hono/powered-by";
import { type Env, envSchema } from "./env.ts";

// biome-ignore lint/style/useNamingConvention: following hono's naming convention
const app = new Hono<{ Bindings: Env }>();

app.use(poweredBy());

// validate the environment variables
app.use(async (c, next) => {
	const result = envSchema.safeParse(c.env);
	if (!result.success) {
		throw new HTTPException(500, {
			message: `invalid environment variables: ${result.error.message}`,
			cause: result.error,
		});
	}
	await next();
});

// redirect to the readme
app.get("/", (c) => {
	return c.redirect(`https://github.com/${c.env.REPO_NAME}#readme`, 307);
});

const gitRefRegex = /(?<=git_ref *= *")(?=")/;
const shebangRegex = /^#!.*\n+/;

// redirect to the installer script
app.get("/:os{win|wsl}", async (c) => {
	const os = c.req.param("os");
	const ref = c.req.query("ref");
	if (os !== "win" && os !== "wsl") {
		// other paths must not be reached
		throw new HTTPException(500, { message: "routing error" });
	}
	const scriptUrl = `https://raw.githubusercontent.com/${c.env.REPO_NAME}/${ref ?? c.env.DEFAULT_BRANCH}/${os}/install.${
		os === "win" ? "ps1" : "sh"
	}`;
	if (ref === undefined) {
		// just redirect to the installer script if no ref is provided
		return c.redirect(scriptUrl, 307);
	}
	// do not cache the installer script to always fetch the latest version
	const githubResponse = await fetch(scriptUrl);
	if (!githubResponse.ok) {
		throw new HTTPException(500, {
			message: `failed to fetch installer script from GitHub: ${githubResponse.statusText}`,
		});
	}
	const script = await githubResponse.text();
	if (!gitRefRegex.test(script)) {
		throw new HTTPException(500, {
			message: "installer script does not contain a git_ref variable",
		});
	}
	const shebang = script.match(shebangRegex)?.[0] ?? "";
	return c.text(
		`${shebang}# source: ${scriptUrl}\n\n${script.replace(shebang, "").replace(gitRefRegex, ref)}`,
	);
});

// biome-ignore lint/style/noDefaultExport: required by hono
export default app;
