/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly REPO_NAME: string;
	readonly DEFAULT_BRANCH: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
