// build-codeql.ts - replaces Go "-build-codeql" flag
// Just a static 64-bit release build for CodeQL analysis
import { join } from "node:path";
import { detectMsBuild } from "./util.ts";

async function runLogged(cmd: string, args: string[]): Promise<void> {
  const short = [cmd.split("\\").pop(), ...args].join(" ");
  console.log(`> ${short}`);
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
}

function buildConfigPath(): string {
  return join("src", "utils", "BuildConfig.h");
}

async function revertBuildConfig(): Promise<void> {
  const proc = Bun.spawn(["git", "checkout", buildConfigPath()], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

async function main() {
  const timeStart = performance.now();
  console.log("build-codeql: static 64-bit release build for CodeQL analysis");

  const { msbuildPath } = detectMsBuild();
  const slnPath = join("vs2022", "SumatraPDF.sln");

  await runLogged(msbuildPath, [slnPath, `/t:SumatraPDF:Rebuild`, `/p:Configuration=Release;Platform=x64`, `/m`]);

  await revertBuildConfig();

  const elapsed = ((performance.now() - timeStart) / 1000).toFixed(1);
  console.log(`build-codeql finished in ${elapsed}s`);
}

if (import.meta.main) {
  await main();
}
