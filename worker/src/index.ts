import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { poweredBy } from "hono/powered-by";
import { envSchema, type Env } from "./env.ts";

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
	return c.redirect(
		`https://github.com/${c.env.REPO_OWNER}/${c.env.REPO_NAME}#readme`,
		307,
	);
});

// redirect to the installer script
app.get("/:os{win|wsl}", (c) => {
	const os = c.req.param("os");
	const ref = c.req.query("ref") ?? c.env.DEFAULT_BRANCH;
	if (os !== "win" && os !== "wsl") {
		// other paths must not be reached
		throw new HTTPException(500, { message: "routing error" });
	}
	return c.redirect(
		`https://raw.githubusercontent.com/${c.env.REPO_OWNER}/${c.env.REPO_NAME}/${ref}/${os}/install.${
			os === "win" ? "ps1" : "sh"
		}`,
		307,
	);
});

// biome-ignore lint/style/noDefaultExport: required by hono
export default app;
