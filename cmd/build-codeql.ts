// build-codeql.ts - replaces Go "-build-codeql" flag
// Just a static 64-bit release build for CodeQL analysis
import { existsSync } from "node:fs";
import { join } from "node:path";

const vsBasePaths = [
  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Enterprise`,
  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Preview`,
  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Community`,
  String.raw`C:\Program Files\Microsoft Visual Studio\2022\Professional`,
];

function detectMsbuildPath(): string {
  const msBuildName = String.raw`MSBuild\Current\Bin\MSBuild.exe`;
  for (const base of vsBasePaths) {
    const p = join(base, msBuildName);
    if (existsSync(p)) {
      console.log(`msbuild.exe: ${p}`);
      return p;
    }
  }
  throw new Error(`didn't find ${msBuildName}`);
}

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

  const msbuildPath = detectMsbuildPath();
  const slnPath = join("vs2022", "SumatraPDF.sln");

  await runLogged(msbuildPath, [
    slnPath,
    `/t:SumatraPDF:Rebuild`,
    `/p:Configuration=Release;Platform=x64`,
    `/m`,
  ]);

  await revertBuildConfig();

  const elapsed = ((performance.now() - timeStart) / 1000).toFixed(1);
  console.log(`build-codeql finished in ${elapsed}s`);
}

if (import.meta.main) {
  await main();
}
