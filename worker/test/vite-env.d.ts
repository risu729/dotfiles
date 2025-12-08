/// <reference types="vite/client" />
// biome-ignore-all lint/style/useConsistentTypeDefinitions: required to override types

interface ImportMetaEnv {
	readonly DEFAULT_BRANCH: string;
	readonly LATEST_COMMIT_HASH: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
