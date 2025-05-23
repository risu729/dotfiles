/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly DEFAULT_BRANCH: string;
	readonly LATEST_COMMIT_HASH: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
