import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const msBuildRelPath = String.raw`MSBuild\Current\Bin\MSBuild.exe`;

const vsEditions = ["Community", "Professional", "Enterprise"];

interface MsBuildInfo {
  vsRoot: string;
  msbuildPath: string;
}

function tryMsBuildInPath(): MsBuildInfo | null {
  try {
    const result = Bun.spawnSync(["msbuild", "-h"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      return null;
    }
  } catch {
    return null;
  }
  const pathEnv = process.env.PATH ?? "";
  const sep = ";";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const p = join(dir, "MSBuild.exe");
    if (existsSync(p)) {
      // msbuildPath is e.g. C:\...\MSBuild\Current\Bin\MSBuild.exe
      // vsRoot is that minus MSBuild\Current\Bin
      const msbuildPath = p;
      // dir is the Bin directory, go up 3 levels: Bin -> Current -> MSBuild -> vsRoot
      const vsRoot = dirname(dirname(dirname(dir)));
      return { vsRoot, msbuildPath };
    }
  }
  return null;
}

function tryMsBuildInProgramFiles(): MsBuildInfo | null {
  const programFiles = process.env["ProgramFiles"] ?? String.raw`C:\Program Files`;
  const vsBase = join(programFiles, "Microsoft Visual Studio", "2022");
  for (const edition of vsEditions) {
    const vsRoot = join(vsBase, edition);
    const msbuildPath = join(vsRoot, msBuildRelPath);
    if (existsSync(msbuildPath)) {
      return { vsRoot, msbuildPath };
    }
  }
  return null;
}

export function detectMsBuild(): MsBuildInfo {
  let info = tryMsBuildInPath();
  if (!info) {
    info = tryMsBuildInProgramFiles();
  }
  if (!info) {
    throw new Error("couldn't find msbuild.exe");
  }
  console.log(`vsRoot: ${info.vsRoot}`);
  console.log(`msbuildPath: ${info.msbuildPath}`);
  return info;
}
