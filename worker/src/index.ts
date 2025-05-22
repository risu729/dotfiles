import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { poweredBy } from "hono/powered-by";

const app = new Hono();

app.use(poweredBy());

// redirect to the readme
app.get("/", (c) => {
	return c.redirect(
		`https://github.com/${import.meta.env.REPO_NAME}#readme`,
		307,
	);
});

const repoNameRegex = /(?<=repo_name = *")(?=")/;
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
	const scriptUrl = `https://raw.githubusercontent.com/${import.meta.env.REPO_NAME}/${
		ref ?? import.meta.env.DEFAULT_BRANCH
	}/${os}/install.${os === "win" ? "ps1" : "sh"}`;
	// do not cache the installer script to always fetch the latest version
	const githubResponse = await fetch(scriptUrl, {
		headers: {
			"User-Agent": `${import.meta.env.REPO_NAME} worker`,
			// authorize with the GITHUB_TOKEN if provided to avoid rate limiting
			...(import.meta.env.GITHUB_TOKEN
				? {
						// biome-ignore lint/style/useNamingConvention: following fetch
						Authorization: `Bearer ${import.meta.env.GITHUB_TOKEN}`,
					}
				: {}),
		},
	});
	if (!githubResponse.ok) {
		throw new HTTPException(500, {
			message: `failed to fetch installer script from GitHub: ${githubResponse.statusText}`,
		});
	}
	const script = await githubResponse.text();
	if (!repoNameRegex.test(script)) {
		throw new HTTPException(500, {
			message: "installer script does not contain a repo_name variable",
		});
	}
	if (!gitRefRegex.test(script)) {
		throw new HTTPException(500, {
			message: "installer script does not contain a git_ref variable",
		});
	}
	const shebang = script.match(shebangRegex)?.[0] ?? "";
	return c.text(
		`${shebang}# source: ${scriptUrl}\n\n${script
			.replace(shebang, "")
			// biome-ignore lint/correctness/noUndeclaredVariables: defined in vite.config.ts
			.replace(repoNameRegex, __REPO_NAME__)
			.replace(gitRefRegex, ref ?? "")}`,
	);
});

// biome-ignore lint/style/noDefaultExport: required by hono
export default app;
