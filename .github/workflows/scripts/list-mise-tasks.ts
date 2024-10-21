import { createHash } from "node:crypto";
import { $ } from "bun";
import {
	type EdgeModel,
	type NodeModel,
	type NodeRef,
	fromDot,
} from "ts-graphviz";

const ciTaskDepsDot = await $`mise tasks deps ci --dot`.text();

const miseTools = Object.keys(
	(await $`mise list --current --json`.json()) as Record<string, unknown>,
);

const ciTasks = fromDot(ciTaskDepsDot);

const rootNode = ciTasks.nodes.find(
	(node) => node.attributes.get("label") === "ci",
);

if (!rootNode) {
	throw new Error("task 'ci' not found in `mise tasks deps ci --dot`");
}

const getEdgeTargets = ({
	targets,
}: EdgeModel): {
	from: NodeRef;
	to: NodeRef;
} => {
	const isNodeRef = (target: (typeof targets)[number]): target is NodeRef => {
		return !Array.isArray(target);
	};

	if (!isNodeRef(targets[0])) {
		throw new Error("unexpected edge target type");
	}
	if (!isNodeRef(targets[1])) {
		throw new Error("unexpected edge target type");
	}
	return {
		from: targets[0],
		to: targets[1],
	};
};

const getNodeFromRef = ({ id }: NodeRef): NodeModel => {
	const node = ciTasks.nodes.find((node) => node.id === id);
	if (!node) {
		throw new Error(`node with id ${id} not found`);
	}
	return node;
};

const getNodeLabel = (node: NodeModel): string => {
	const label = node.attributes.get("label");
	if (!label) {
		throw new Error("missing label in node");
	}
	return label;
};

const getDependencies = ({ id }: NodeRef): NodeRef[] => {
	return ciTasks.edges
		.map(getEdgeTargets)
		.filter(({ from }) => from.id === id)
		.flatMap(({ to }) => [to, ...getDependencies(to)]);
};

const tasks: {
	name: string;
	task: string;
	// space separated list to use in `mise install` command
	tools: string;
	toolsHash: string;
}[] = ciTasks.edges
	.map(getEdgeTargets)
	.filter(({ from }) => from.id === rootNode.id)
	.map(({ to }) => {
		const taskName = getNodeLabel(getNodeFromRef(to));
		// remove prefix if exists
		const name = taskName.split(":")[1] ?? taskName;
		const tool = miseTools.find((tool) => tool.includes(name));

		const tools: string[] = tool ? [tool] : [];

		if (tool?.startsWith("npm")) {
			tools.push("node");
		}

		const dependencies = getDependencies(to).map((node) =>
			getNodeLabel(getNodeFromRef(node)),
		);
		// cspell:ignore buni
		if (dependencies.some((dependency) => dependency.startsWith("buni"))) {
			tools.push("bun", "node");
		}

		return {
			name: name,
			task: taskName,
			tools: tools.join(" "),
			toolsHash: createHash("sha256")
				.update(tools.sort().join("-"))
				.digest("hex"),
		};
	});

console.write(JSON.stringify(tasks));
