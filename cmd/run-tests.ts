import { join, resolve } from "node:path";
import { detectMsBuild } from "./util.ts";

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

const { msbuildPath } = detectMsBuild();
const slnPath = join("vs2022", "SumatraPDF.sln");
await runLogged(msbuildPath, [slnPath, `/t:test_util:Rebuild`, `/p:Configuration=Release;Platform=x64`, `/m`]);

const dir = join("out", "rel64");
await runLogged(resolve(join(dir, "test_util.exe")), [], dir);
