// ref: https://cspell.org/docs/Configuration

"use strict";

/**
 * @type {import("@cspell/cspell-types").CSpellUserSettings}
 */
module.exports = {
	version: "0.2",
	language: "en",
	dictionaries: ["typescript", "node", "npm", "bash", "markdown"],
	enableGlobDot: true,
	useGitignore: true,
	ignorePaths: [
		".git/",
		// ignore auto-generated files
		".gitignore",
		"bun.lock",
		"win/ytenhancer.json", // cspell:ignore ytenhancer
		// ignore license files
		"LICENSE",
		// ignore binary files
		"win/powertoys/*.ptb", // cspell:ignore powertoys
	],
	words: [
		"risu",
		"risunosu",
		"dotfiles",
		"winget",
		"biomejs",
		"taplo",
		"yamlfmt",
		"ghalint",
		"pinact",
		"zizmor",
		"commitlint",
		"hono",
		"jschema",
		"buni",
		"pwsh",
	],
};
