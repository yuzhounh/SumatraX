import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as versions from "../cmd/util.ts";
import { runStandalone, tmpPath } from "./util.ts";

export async function testit(): Promise<void> {
  assert.equal(versions.extractPreReleaseVersion(), "22619");
  assert.equal(versions.extractSumatraBuildVersion(), "3.7.22619-r1");

  const originalDir = process.cwd();
  const fixtureDir = mkdtempSync(tmpPath("build-version-"));
  mkdirSync(join(fixtureDir, "src"));
  try {
    process.chdir(fixtureDir);
    writeFileSync(
      "src/Version.h",
      "#define CURR_VERSION 3.7\n#define PRE_RELEASE_VER 22619\n#define SUMATRAX_REVISION 1\n",
    );
    writeFileSync("src/BuildConfig.h", "#define PRE_RELEASE_VER 22000\n");
    assert.equal(versions.extractPreReleaseVersion(), "22000");
    assert.equal(versions.extractSumatraBuildVersion(), "3.7.22000-r1");

    writeFileSync("src/BuildConfig.h", "");
    writeFileSync("src/Version.h", "#define CURR_VERSION 3.7\n#define SUMATRAX_REVISION 1\n");
    assert.equal(versions.extractSumatraBuildVersion(), "3.7-r1");
    assert.throws(() => versions.extractPreReleaseVersion(), /pre-release version missing/);
  } finally {
    process.chdir(originalDir);
  }
}

if (import.meta.main) {
  await runStandalone(testit);
}
