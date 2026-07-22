const [major, minor, patch] = process.versions.node.split(".").map(Number);
const required = [22, 19, 0];
const current = [major, minor, patch];
const supported = current[0] > required[0] || (current[0] === required[0] && (current[1] > required[1] || (current[1] === required[1] && current[2] >= required[2])));
if (!supported) {
  console.error(`Herdr Subagents requires Node.js >= 22.19.0; found ${process.versions.node}.`);
  process.exit(1);
}
