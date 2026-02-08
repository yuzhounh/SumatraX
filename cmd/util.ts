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
  llvmPdbutilPath: string;
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
          // dir is the Bin directory, go up 3 levels: Bin -> Current -> MSBuild -> vsRoot
          return dirname(dirname(dirname(dir)));
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
  const llvmPdbutilPath = findTool(vsRoot, llvmPdbutilRelPath);

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
