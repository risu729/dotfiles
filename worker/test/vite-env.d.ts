/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly LATEST_COMMIT_HASH: string;
}

// biome-ignore lint/correctness/noUnusedVariables:
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
