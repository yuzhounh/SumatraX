import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const msBuildRelPath = String.raw`MSBuild\Current\Bin\MSBuild.exe`;
const clangFormatRelPath = String.raw`VC\Tools\Llvm\bin\clang-format.exe`;
const clangTidyRelPath = String.raw`VC\Tools\Llvm\bin\clang-tidy.exe`;
const llvmPdbutilRelPath = String.raw`VC\Tools\Llvm\bin\llvm-pdbutil.exe`;

const vsEditions = ["Community", "Professional", "Enterprise"];

export interface VisualStudioInfo {
  vsRoot: string;
  msbuildPath: string;
  clangFormatPath: string;
  clangTidyPath: string;
  llvmPdbutilPath?: string;
}

// llvm-pdbutil.exe doesn't work when invoked using absolute path
// so it must be in %PATH% to work
function findLlvmPdbUtil(): string | undefined {
  try {
    const result = Bun.spawnSync(["llvm-pdbutil", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      return "llvm-pdbutil.exe";
    }
  } catch {}
  return;
}

function findVsRoot(): string {
  // try PATH first
  try {
    const result = Bun.spawnSync(["msbuild", "-h"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      const pathEnv = process.env.PATH ?? "";
      for (const dir of pathEnv.split(";")) {
        if (!dir) continue;
        const p = join(dir, "MSBuild.exe");
        if (existsSync(p)) {
          // walk up from e.g. .../MSBuild/Current/Bin or .../MSBuild/Current/Bin/amd64
          // until we pass the "MSBuild" directory to get vsRoot
          let d = dir;
          while (d && d !== dirname(d)) {
            const base = d.split(/[\\/]/).pop()!;
            if (base.toLowerCase() === "msbuild") {
              return dirname(d);
            }
            d = dirname(d);
          }
        }
      }
    }
  } catch {
    // msbuild not in PATH
  }

  // try known Program Files locations
  const programFiles = process.env["ProgramFiles"] ?? String.raw`C:\Program Files`;
  const vsBase = join(programFiles, "Microsoft Visual Studio", "2022");
  for (const edition of vsEditions) {
    const vsRoot = join(vsBase, edition);
    if (existsSync(join(vsRoot, msBuildRelPath))) {
      return vsRoot;
    }
  }

  throw new Error("couldn't find Visual Studio installation");
}

function findTool(vsRoot: string, relPath: string): string {
  const p = join(vsRoot, relPath);
  if (existsSync(p)) {
    return p;
  }
  return "";
}

export function detectVisualStudio(): VisualStudioInfo {
  const vsRoot = findVsRoot();
  const msbuildPath = findTool(vsRoot, msBuildRelPath);
  const clangFormatPath = findTool(vsRoot, clangFormatRelPath);
  const clangTidyPath = findTool(vsRoot, clangTidyRelPath);
  const llvmPdbutilPath = findLlvmPdbUtil();

  if (!msbuildPath) {
    throw new Error(`couldn't find msbuild.exe in ${vsRoot}`);
  }

  console.log(`vsRoot: ${vsRoot}`);
  console.log(`msbuildPath: ${msbuildPath}`);
  if (clangFormatPath) console.log(`clangFormatPath: ${clangFormatPath}`);
  if (clangTidyPath) console.log(`clangTidyPath: ${clangTidyPath}`);
  if (llvmPdbutilPath) console.log(`llvmPdbutilPath: ${llvmPdbutilPath}`);

  return { vsRoot, msbuildPath, clangFormatPath, clangTidyPath, llvmPdbutilPath };
}
