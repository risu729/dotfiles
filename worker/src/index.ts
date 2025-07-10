import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { poweredBy } from "hono/powered-by";

type Os = "win" | "wsl";

const app: Hono = new Hono();

app.use(poweredBy());

// redirect to the readme
app.get("/", (c) => {
	return c.redirect(
		`https://github.com/${import.meta.env.REPO_NAME}#readme`,
		307,
	);
});

const shebangRegex = /^#!.*\n+/;

// redirect to the installer script
app.get("/:os{win|wsl}", async ({ req, text }) => {
	const os = req.param("os");
	const ref = req.query("ref");
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

	const variables = [
		{
			name: "repo_name",
			os: ["win", "wsl"],
			value: import.meta.env.REPO_NAME,
		},
		{
			name: "git_ref",
			os: ["win", "wsl"],
			value: ref ?? "",
		},
		{
			name: "script_origin",
			os: ["win"],
			value: new URL(req.url).origin,
		},
	] satisfies {
		name: string;
		os: Os[];
		value: string;
	}[];

	let script = await githubResponse.text();
	for (const { name, os: osList, value } of variables) {
		if (!osList.includes(os)) {
			continue;
		}
		// use camel case for Windows and snake case for WSL
		const nameInOs =
			os === "win"
				? name.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
				: name;
		const regex = new RegExp(`(?<=${nameInOs} *= *["'])(?=["'])`);
		if (!regex.test(script)) {
			throw new HTTPException(500, {
				message: `installer script does not contain a ${nameInOs} variable`,
			});
		}
		script = script.replace(regex, value);
	}

	const shebang = script.match(shebangRegex)?.[0] ?? "";
	return text(
		`${shebang}# source: ${scriptUrl}\n\n${script.replace(shebang, "")}`,
	);
});

// biome-ignore lint/style/noDefaultExport: required by hono
export default app satisfies ExportedHandler;
