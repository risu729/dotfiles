import type { Config } from "jschema-validator";

const config: Config = {
	"win/winget.json": {
		// disable using flag `u
		// schema includes a regex pattern with `\-` which is invalid (or unnecessary) escape
		// invalid escape sequences are not allowed with flag `u`
		// ref: https://tc39.es/archives/bugzilla/3157/
		unicodeRegExp: false,
	},
	// TODO: enable after fixing hanging issue
	"wsl/home/.gemini/settings.json": false,
};

export default config;
