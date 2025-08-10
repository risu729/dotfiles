/// <reference types="vite/client" />
// biome-ignore-all lint/nursery/useConsistentTypeDefinitions: required to override types

interface ImportMetaEnv {
	readonly REPO_NAME: string;
	readonly DEFAULT_BRANCH: string;
	readonly GITHUB_TOKEN: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
