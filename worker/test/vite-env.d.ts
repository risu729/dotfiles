/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly DEFAULT_BRANCH: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
