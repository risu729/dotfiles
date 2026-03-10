import type { Config } from "jschema-validator";

const config: Config = {
	"win/winget.json": {
		// Disable using flag `u
		// Schema includes a regex pattern with `\-` which is invalid (or unnecessary) escape
		// Invalid escape sequences are not allowed with flag `u`
		// Ref: https://tc39.es/archives/bugzilla/3157/
		unicodeRegExp: false,
	},
	// Enable after fixing hanging issue
	"wsl/home/.gemini/settings.json": false,
};

export default config;
