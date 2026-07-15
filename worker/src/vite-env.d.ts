/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly DEFAULT_BRANCH: string;
	readonly GITHUB_TOKEN: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
