import { $ } from "bun";

const buildNo = parseInt(process.argv[2], 10);
if (!buildNo || buildNo <= 0) {
  console.error("usage: bun ./cmd/build-no-info.ts <build-number>");
  process.exit(1);
}

const out = await $`git log --oneline`.text();
const lines = out.split("\n").filter((l) => l.trim() !== "");
// we add 1000 to create a version that is larger than the svn version
// from the time we used svn
const n = lines.length - (buildNo - 1000);
if (n < 0 || n >= lines.length) {
  console.error(`build number ${buildNo} is out of range`);
  process.exit(1);
}
console.log(`${buildNo}: ${lines[n]}`);
