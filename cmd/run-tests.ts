import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

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

async function runLogged(cmd: string, args: string[], cwd?: string): Promise<void> {
  const short = [cmd.split("\\").pop(), ...args].join(" ");
  console.log(`> ${short}`);
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
}

const msbuildPath = detectMsbuildPath();
const slnPath = join("vs2022", "SumatraPDF.sln");
await runLogged(msbuildPath, [slnPath, `/t:test_util:Rebuild`, `/p:Configuration=Release;Platform=x64`, `/m`]);

const dir = join("out", "rel64");
await runLogged(resolve(join(dir, "test_util.exe")), [], dir);
