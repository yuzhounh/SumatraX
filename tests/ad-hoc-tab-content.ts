import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ControlCommand } from "./control.ts";
import { cmdId, runStandalone, SETTINGS_FILE, tmpPath } from "./util.ts";
import { killAndWait, launchControlled, sendCommandSync } from "./win-automation.ts";
import {
  captureWindowPixels,
  captureWindowToPng,
  findChildWindow,
  getClientRect,
  sendMessage,
  setProcessDpiAware,
  WM_LBUTTONDOWN,
  WM_LBUTTONUP,
} from "./winapi.ts";

async function check(tabDip: number, count = 3): Promise<void> {
  const dir = tmpPath(`tab-content-${tabDip}-${count}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, SETTINGS_FILE),
    `Theme = Light\nRestoreSession = false\nCheckForUpdates = false\nUseTabs = true\nTabsInTitlebar = true\nTabWidth = ${tabDip}\n`,
  );
  const paths = [resolve("tests/issue-3219.pdf"), resolve("tests/issue-6132.pdf"), resolve("tests/issue-6101.pdf")];
  for (let i = paths.length; i < count; i++) {
    const fixture = join(dir, `extra-${i}.pdf`);
    copyFileSync(paths[0], fixture);
    paths.push(fixture);
  }
  const { proc, client, frame } = await launchControlled(["-appdata", dir, ...paths]);
  try {
    await client.waitForRenderIdle();
    for (let i = 0; i < count; i++) {
      const [, current] = await client.request(ControlCommand.TestCurrentTab, []);
      if (String(current).includes("issue-3219.pdf")) break;
      sendCommandSync(frame, cmdId("CmdNextTab"));
    }
    const tabs = findChildWindow(frame, "SumatraTabsCtrlClass");
    const rc = getClientRect(tabs);
    const [, dpiState] = await client.request(ControlCommand.TestDpi, ["state"]);
    const dpi = /frame=(\d+)/.exec(String(dpiState));
    if (!dpi) throw new Error("window DPI unavailable");
    const scale = Number(dpi[1]) / 96;
    const width = Math.min(Math.round(tabDip * scale), Math.floor((rc.right - 5 - Math.round(40 * scale)) / count));
    sendMessage(tabs, WM_LBUTTONUP, 0, (rc.right - 1) | (Math.round(rc.bottom / 2) << 16));
    const cap = captureWindowPixels(tabs);
    if (!cap) throw new Error("capture failed");
    captureWindowToPng(tabs, join(dir, "tabs.png"));
    let iconLeft = Infinity;
    for (let y = Math.round(8 * scale); y < rc.bottom - 8 * scale; y++) {
      for (let x = width; x < 2 * width; x++) {
        const at = (y * cap.w + x) * 4;
        if (cap.data[at + 2] > 180 && cap.data[at + 1] > 150 && cap.data[at] < 100)
          iconLeft = Math.min(iconLeft, x - width);
      }
    }
    const expectedInset = width >= 32 * scale ? 8 * scale : (width - Math.min(16 * scale, width)) / 2;
    if (Math.abs(iconLeft - expectedInset) > 2)
      throw new Error(`icon inset is ${iconLeft / scale} DIP; expected ${expectedInset / scale} DIP`);
    const x = Math.round(Math.max(width - 16 * scale, width / 2)),
      y = Math.round(rc.bottom / 2);
    let ink = 0;
    for (let py = y - Math.round(5 * scale); py <= y + Math.round(5 * scale); py++) {
      for (let px = x - Math.round(5 * scale); px <= x + Math.round(5 * scale); px++) {
        const at = (py * cap.w + px) * 4;
        if (cap.data[at] < 120 && cap.data[at + 1] < 120 && cap.data[at + 2] < 120) ink++;
      }
    }
    if (ink < 6) throw new Error(`${tabDip} DIP active tab has no close glyph at its trailing edge`);
    sendMessage(tabs, WM_LBUTTONDOWN, 1, x | (y << 16));
    sendMessage(tabs, WM_LBUTTONUP, 0, x | (y << 16));
    const [, current] = await client.request(ControlCommand.TestCurrentTab, []);
    if (String(current).includes("issue-3219.pdf")) throw new Error("close glyph is not clickable");
  } finally {
    client.close();
    await killAndWait(proc);
  }
}

export async function testit(): Promise<void> {
  setProcessDpiAware();
  await check(200);
  await check(60);
  await check(60, 32);
}
if (import.meta.main) await runStandalone(testit);
