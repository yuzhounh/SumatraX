import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ControlCommand, type ControlClient } from "./control.ts";
import { assemblePdf, cmdId, runStandalone, SETTINGS_FILE, tmpPath } from "./util.ts";
import { killAndWait, launchControlled, sendCommandSync, waitForExit } from "./win-automation.ts";

function check(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(`session-default-off: ${message}`);
  }
}

async function currentTab(client: ControlClient): Promise<string> {
  const result = await client.request(ControlCommand.TestCurrentTab);
  return result[0] === 0 ? String(result[1]) : "";
}

async function runVariant(mode: "default" | "false" | "true"): Promise<void> {
  const dir = tmpPath(`session-default-off-${mode}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const settingsPath = join(dir, SETTINGS_FILE);
  const pdf = assemblePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ]);
  const first = join(dir, "first.pdf");
  const second = join(dir, "second.pdf");
  const old = join(dir, "old.pdf");
  for (const path of [first, second, old]) {
    writeFileSync(path, pdf, "latin1");
  }
  const enabled = mode === "true";
  const restoreSetting = mode === "default" ? "" : `RestoreSession = ${mode}\n`;
  const tabsSetting = mode === "default" ? "" : "UseTabs = true\n";
  const oldSession = enabled ? "" : `SessionData [\n[\nTabStates [\n[\nFilePath = ${old}\n]\n]\n]\n]\n`;
  writeFileSync(
    settingsPath,
    "UiLanguage = en\nCheckForUpdates = false\nReuseInstance = false\n" +
      "NoHomeTab = true\nRememberOpenedFiles = true\nLazyLoading = false\n" +
      restoreSetting +
      tabsSetting +
      oldSession,
  );

  const opened = await launchControlled(["-appdata", dir, first, second], { saveSettings: true });
  try {
    await opened.client.waitForSessionRestored();
    check((await currentTab(opened.client)).includes(second), `${mode}: second tab should be selected`);
    sendCommandSync(opened.frame, cmdId("CmdPrevTab"));
    check((await currentTab(opened.client)).includes(first), `${mode}: first tab should remain open`);
    sendCommandSync(opened.frame, cmdId("CmdNextTab"));
    check((await currentTab(opened.client)).includes(second), `${mode}: tab switching should work`);
    await opened.client.quit();
    check(await waitForExit(opened.proc), `${mode}: closing should exit`);
  } finally {
    opened.client.close();
    await killAndWait(opened.proc);
  }

  const saved = readFileSync(settingsPath, "utf8");
  check(/^RestoreSession\s*=\s*false$/m.test(saved) === !enabled, `${mode}: restore preference should persist`);
  check(/TabStates\s*\[/.test(saved) === enabled, `${mode}: session should only be saved when enabled`);
  check(saved.includes(first) && saved.includes(second), `${mode}: recent file history should remain`);

  const restarted = await launchControlled(["-appdata", dir], { saveSettings: true });
  try {
    if (enabled) {
      await restarted.client.waitForRenderIdle();
    } else {
      await restarted.client.waitForSessionRestored();
    }
    check(Boolean(await currentTab(restarted.client)) === enabled, `${mode}: restore should match the preference`);
    if (enabled) {
      check((await currentTab(restarted.client)).includes(second), "enabled: selected tab should restore");
      sendCommandSync(restarted.frame, cmdId("CmdPrevTab"));
      await restarted.client.waitForRenderIdle();
      check((await currentTab(restarted.client)).includes(first), "enabled: first tab should restore");
    }
    await restarted.client.quit();
    check(await waitForExit(restarted.proc), `${mode}: restarted app should exit`);
  } finally {
    restarted.client.close();
    await killAndWait(restarted.proc);
  }
}

export async function testit(): Promise<void> {
  for (const mode of ["default", "false", "true"] as const) {
    await runVariant(mode);
  }
}

if (import.meta.main) {
  await runStandalone(testit);
}
