import { copyFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { runLogged } from "../util";

const portableFiles = ["SumatraX.exe", "libsumatrapdf.dll", "PdfFilter.dll", "PdfPreview.dll", "sumatrapdf-tool.exe"];
const staticExe = "SumatraX-static.exe";

export async function syncReleasePackage(outDir: string, releaseDir: string, version: string): Promise<void> {
  for (const name of [...portableFiles, staticExe]) {
    if (!statSync(join(outDir, name)).isFile()) {
      throw new Error(`missing release binary: ${name}`);
    }
  }

  const packageName = `SumatraX-v${version}-x64`;
  const portableDir = join(releaseDir, packageName);
  mkdirSync(portableDir, { recursive: true });
  for (const name of portableFiles) {
    copyFileSync(join(outDir, name), join(portableDir, name));
  }
  copyFileSync(join(outDir, staticExe), join(releaseDir, `${packageName}.exe`));

  // Archive only binaries; keep local settings and notes out of the package.
  const archive = resolve(releaseDir, `${packageName}.zip`);
  const stagingArchive = resolve(releaseDir, `${packageName}.tmp.zip`);
  try {
    await runLogged("tar", [
      "-a",
      "-cf",
      stagingArchive,
      "-C",
      resolve(releaseDir),
      ...portableFiles.map((name) => `${packageName}/${name}`),
    ]);
    renameSync(stagingArchive, archive);
  } finally {
    rmSync(stagingArchive, { force: true });
  }
  console.log(`synced release package: ${releaseDir}`);
}
