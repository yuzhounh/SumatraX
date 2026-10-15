import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncReleasePackage } from "../cmd/helper/release-package.ts";
import { extractSumatraBuildVersion } from "../cmd/util.ts";
import { runStandalone, tmpPath } from "./util.ts";

export async function testit(): Promise<void> {
  const dir = mkdtempSync(tmpPath("release-package-"));
  const outDir = join(dir, "rel64");
  const version = extractSumatraBuildVersion();
  if (!/^\d+(?:\.\d+)+-r[1-9]\d*$/.test(version)) {
    throw new Error(`release version must include the SumatraX revision: ${version}`);
  }
  const releaseDir = join(dir, `release-${version}`);
  const packageName = `SumatraX-v${version}-x64`;
  const portableDir = join(releaseDir, packageName);
  const names = ["SumatraX.exe", "libsumatrapdf.dll", "PdfFilter.dll", "PdfPreview.dll", "sumatrapdf-tool.exe"];
  mkdirSync(outDir);
  mkdirSync(portableDir, { recursive: true });
  for (const name of [...names, "SumatraX-static.exe"]) {
    writeFileSync(join(outDir, name), `new ${name}`);
  }
  writeFileSync(join(portableDir, "SumatraX.exe"), "old exe");
  writeFileSync(join(releaseDir, `${packageName}.exe`), "old standalone exe");
  writeFileSync(join(releaseDir, `${packageName}.zip`), "old zip");
  writeFileSync(join(portableDir, "SumatraX-settings.txt"), "local settings");
  writeFileSync(join(releaseDir, "notes.md"), "local notes");

  await syncReleasePackage(outDir, releaseDir, version);
  for (const name of names) {
    if (!readFileSync(join(outDir, name)).equals(readFileSync(join(portableDir, name)))) {
      throw new Error(`portable binary differs: ${name}`);
    }
  }
  if (!readFileSync(join(outDir, "SumatraX-static.exe")).equals(readFileSync(join(releaseDir, `${packageName}.exe`)))) {
    throw new Error("standalone binary differs");
  }
  if (readFileSync(join(portableDir, "SumatraX-settings.txt"), "utf8") !== "local settings") {
    throw new Error("local settings changed");
  }
  if (readFileSync(join(releaseDir, "notes.md"), "utf8") !== "local notes") {
    throw new Error("local notes changed");
  }
  const archive = join(releaseDir, `${packageName}.zip`);
  const listing = Bun.spawnSync(["tar", "-tf", archive]);
  const entries = listing.stdout.toString().trim().split(/\r?\n/).sort();
  const expected = names.map((name) => `${packageName}/${name}`).sort();
  if (listing.exitCode !== 0 || entries.join("\n") !== expected.join("\n")) {
    throw new Error(`unexpected ZIP contents: ${entries.join(", ")}`);
  }
  const zippedExe = Bun.spawnSync(["tar", "-xOf", archive, `${packageName}/SumatraX.exe`]);
  if (zippedExe.exitCode !== 0 || !zippedExe.stdout.equals(readFileSync(join(outDir, "SumatraX.exe")))) {
    throw new Error("ZIP contains a stale exe");
  }
}

if (import.meta.main) {
  await runStandalone(testit);
}
