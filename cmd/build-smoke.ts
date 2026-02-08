import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectVisualStudio, runLogged } from "./util.ts";

function removeReleaseBuilds(): void {
  const dirs = [join("out", "arm64"), join("out", "rel32"), join("out", "rel64")];
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}


async function main() {
  const timeStart = performance.now();

  console.log("smoke build");
  removeReleaseBuilds();

  const lzsa = resolve(join("bin", "MakeLZSA.exe"));
  if (!existsSync(lzsa)) {
    throw new Error(`file '${lzsa}' doesn't exist`);
  }

  const { msbuildPath } = detectVisualStudio();
  const sln = String.raw`vs2022\SumatraPDF.sln`;
  const t = `/t:SumatraPDF-dll:Rebuild;test_util:Rebuild`;
  const p = `/p:Configuration=Release;Platform=x64`;
  await runLogged(msbuildPath, [sln, t, p, `/m`]);

  const outDir = join("out", "rel64");

  // run tests
  await runLogged(resolve(join(outDir, "test_util.exe")), [], outDir);

  // create PDB lzsa archive
  await runLogged(lzsa, [
    "SumatraPDF.pdb.lzsa",
    "libmupdf.pdb:libmupdf.pdb",
    "SumatraPDF-dll.pdb:SumatraPDF-dll.pdb",
  ], outDir);

  const elapsed = ((performance.now() - timeStart) / 1000).toFixed(1);
  console.log(`smoke build took ${elapsed}s`);
}

await main();
