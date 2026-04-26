// Ref: https://commitlint.js.org/reference/configuration.html
import conventionalConfig from "@commitlint/config-conventional";
const excludeQuestions = [
    // Exclude isBreaking, breaking, and breakingBody because this package does not have versioning
    "isBreaking",
    "breaking",
    "breakingBody",
    // Exclude isIssueAffected, issuesBody, and issues because I link branches to issues using GitHub
    "isIssueAffected",
    "issuesBody",
    "issues",
];
const commitlintConfig = {
    // Do not use extends because we cannot exclude properties from the parent
    ...conventionalConfig,
    prompt: {
        ...conventionalConfig.prompt,
        questions: Object.fromEntries(Object.entries(conventionalConfig.prompt.questions).filter(([key]) => !excludeQuestions.includes(key))),
    },
};
export default commitlintConfig;
