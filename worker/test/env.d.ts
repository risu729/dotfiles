// biome-ignore lint/nursery/useImportRestrictions: for test
import type { Env } from "../src/env.ts";

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

declare module "cloudflare:test" {
	// remove readonly from Env because we want to be able to modify it in tests
	interface ProvidedEnv extends Writeable<Env> {}
}
