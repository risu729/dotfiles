// ref: https://cspell.org/configuration/

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
		"bun.lockb", // cspell:ignore lockb
		"win/ublock.json", // cspell:ignore ublock
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
		"taplo",
		"yamlfmt",
		"ghalint",
		"pinact",
		"noninteractive",
		"commitlint",
		"graphviz",
		"iarna",
		"hono",
		// no cspell:ignore directives in .bashrc and .profile
		"linuxbrew",
		"shellenv",
	],
};
