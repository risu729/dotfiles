import z from "zod";

const variableSchema = z.string().min(1).readonly();

export const envSchema = z.object({
	// biome-ignore lint/style/useNamingConvention: following the naming convention of environment variables
	REPO_NAME: variableSchema,
	// biome-ignore lint/style/useNamingConvention:
	DEFAULT_BRANCH: variableSchema,
});

export type Env = z.infer<typeof envSchema>;
