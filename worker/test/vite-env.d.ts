/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly LATEST_COMMIT_HASH: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
