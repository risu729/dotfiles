// Command-line entrypoint consumes stdin once.
/* oxlint-disable vitest/require-hook */
// Consume mise's native inventory rather than guessing its sidecar paths.
const inventory: unknown = await Bun.stdin.json();
if (!Array.isArray(inventory) || inventory.length === 0) {
	throw new Error("No lockfile inventory was returned");
}

let missing = false;
let count = 0;
for (const lock of inventory) {
	if (typeof lock?.lockfile !== "string" || !Array.isArray(lock.sidecars)) {
		throw new Error("Invalid native lockfile inventory");
	}
	for (const sidecar of lock.sidecars) {
		if (typeof sidecar?.path !== "string" || typeof sidecar.exists !== "boolean") {
			throw new Error("Invalid native sidecar inventory");
		}
		count += 1;
		if (!sidecar.exists) {
			console.error(`${lock.lockfile}: missing sidecar directory ${sidecar.path}`);
			missing = true;
		}
	}
}
console.log(`Checked ${count} referenced sidecar directories`);
process.exit(missing ? 1 : 0);
