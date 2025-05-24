/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly REPO_NAME: string;
	readonly DEFAULT_BRANCH: string;
	readonly GITHUB_TOKEN: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
