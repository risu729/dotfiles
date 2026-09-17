import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { poweredBy } from "hono/powered-by";

/* oxlint-disable eslint/max-lines-per-function eslint/max-statements jest/require-hook */

type Os = "mac" | "win" | "wsl";

// WSL and macOS share one installer, which branches on the operating system
const scriptPaths = {
	mac: "unix/install.sh",
	win: "win/install.ps1",
	wsl: "unix/install.sh",
} as const satisfies Record<Os, string>;

// The ref and the profile are substituted into the script, so their values are
// restricted: branch names, tags, and commit hashes, and the known profiles
const refRegex = /^[\w./-]+$/u;
const profiles = ["personal"];

const app: Hono = new Hono();
const repoName = "risu729/dotfiles";

app.use(poweredBy());

// Redirect to the readme
app.get("/", ({ redirect }) => redirect(`https://github.com/${repoName}#readme`, 307));

const shebangRegex = /^#!.*\n+/u;

// Redirect to the installer script
app.get("/:os{mac|win|wsl}", async ({ req, text }) => {
	const os = req.param("os");
	const ref = req.query("ref");
	const profile = req.query("profile");
	if (os !== "mac" && os !== "win" && os !== "wsl") {
		// Other paths must not be reached
		throw new HTTPException(500, { message: "routing error" });
	}
	if (ref !== undefined && !refRegex.test(ref)) {
		throw new HTTPException(400, { message: "invalid ref" });
	}
	if (profile !== undefined && !profiles.includes(profile)) {
		throw new HTTPException(400, { message: `unknown profile: ${profile}` });
	}

	const scriptUrl = `https://raw.githubusercontent.com/${repoName}/${
		ref ?? import.meta.env.DEFAULT_BRANCH
	}/${scriptPaths[os]}`;
	// Do not cache the installer script to always fetch the latest version
	const githubResponse = await fetch(scriptUrl, {
		headers: {
			"User-Agent": `${repoName} worker`,
			// Authorize with the GITHUB_TOKEN if provided to avoid rate limiting
			...(import.meta.env.GITHUB_TOKEN
				? {
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
			name: "git_ref",
			os: ["mac", "win", "wsl"],
			value: ref ?? "",
		},
		{
			name: "profile",
			// The Windows installer always requests the personal profile for WSL itself
			os: ["mac", "wsl"],
			value: profile ?? "",
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
		// Use camel case for Windows and snake case for the shell script
		const nameInOs =
			os === "win"
				? name.replaceAll(/_(?<char>[a-z])/gu, (...args) => {
						const groups = args.at(-1) as { char: string };
						return groups.char.toUpperCase();
					})
				: name;
		const regex = new RegExp(`(?<=${nameInOs} *= *["'])(?=["'])`, "u");
		if (!regex.test(script)) {
			throw new HTTPException(500, {
				message: `installer script does not contain a ${nameInOs} variable`,
			});
		}
		// Use a function so that `$` patterns in the value are not interpreted
		script = script.replace(regex, () => value);
	}

	const shebang = script.match(shebangRegex)?.[0] ?? "";
	return text(`${shebang}# source: ${scriptUrl}\n\n${script.replace(shebang, "")}`);
});

export default app satisfies ExportedHandler;
