import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ControlCommand } from "./control.ts";
import { cmdId, runStandalone, SETTINGS_FILE, tmpPath } from "./util.ts";
import { killAndWait, launchControlled, sendCommandSync } from "./win-automation.ts";
import {
  captureWindowPixels,
  captureWindowToPng,
  findChildWindow,
  getClientRect,
  repaintWindow,
  sendMessage,
  setProcessDpiAware,
  WM_LBUTTONUP,
} from "./winapi.ts";

async function checkTheme(theme: string, tabDip = 200): Promise<void> {
  const dir = tmpPath(`tab-background-${theme}-${tabDip}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, SETTINGS_FILE),
    `Theme = ${theme}\nCheckForUpdates = false\nRestoreSession = false\nUseTabs = true\nTabsInTitlebar = true\nTabWidth = ${tabDip}\n`,
  );
  const { proc, client, frame } = await launchControlled([
    "-appdata",
    dir,
    "-window-pos",
    "40,40,1200,700",
    resolve("tests/issue-3219.pdf"),
    resolve("tests/issue-6132.pdf"),
    resolve("tests/issue-6101.pdf"),
  ]);
  try {
    await client.setNotificationsEnabled(false);
    await client.waitForRenderIdle();
    const tabs = findChildWindow(frame, "SumatraTabsCtrlClass");
    if (!tabs) throw new Error("tab control not found");
    const rc = getClientRect(tabs);
    const [, dpiState] = await client.request(ControlCommand.TestDpi, ["state"]);
    const dpi = /frame=(\d+)/.exec(String(dpiState));
    if (!dpi) throw new Error("window DPI unavailable");
    const scale = Number(dpi[1]) / 96;
    const width = Math.min(Math.round(tabDip * scale), Math.floor((rc.right - 5 - Math.round(40 * scale)) / 3));
    const pixel = (cap: NonNullable<ReturnType<typeof captureWindowPixels>>, x: number, y: number) => {
      const offset = (Math.round(y) * cap.w + Math.round(x)) * 4;
      return Array.from(cap.data.slice(offset, offset + 3));
    };
    const same = (a: number[], b: number[]) => a.every((c, i) => Math.abs(c - b[i]) <= 2);
    for (const active of [0, 2]) {
      const wanted = active === 0 ? "issue-3219.pdf" : "issue-6101.pdf";
      for (let i = 0; i < 3; i++) {
        const result = await client.request(ControlCommand.TestCurrentTab, []);
        if (String(result[1]).includes(wanted)) break;
        sendCommandSync(frame, cmdId("CmdNextTab"));
      }
      const current = await client.request(ControlCommand.TestCurrentTab, []);
      if (!String(current[1]).includes(wanted)) throw new Error(`could not select ${wanted}`);
      await client.waitForRenderIdle();
      const x = Math.round(width * 1.5),
        y = Math.round(rc.bottom / 2);
      // Mouse-up refreshes hover without arming real-cursor leave tracking.
      sendMessage(tabs, WM_LBUTTONUP, 0, x | (y << 16));
      repaintWindow(tabs);
      const cap = captureWindowPixels(tabs);
      if (!cap) throw new Error("tab capture failed");
      captureWindowToPng(tabs, join(dir, `active-${active}.png`));
      const strip = pixel(cap, width * 1.5, 0);
      const hover = pixel(cap, width * 1.5, rc.bottom - 2 * scale);
      if (same(strip, hover)) throw new Error("posted hover did not highlight the middle tab");
      for (const edge of [width + 3 * scale, 2 * width - 3 * scale]) {
        if (!same(pixel(cap, edge, y), hover)) {
          throw new Error(`${theme}: hover background stops before tab edge (x=${edge}, width=${width})`);
        }
      }
      const activeEdge = active === 0 ? width - 3 * scale : 2 * width + 3 * scale;
      if (same(pixel(cap, activeEdge, y), strip)) throw new Error(`${theme}: active background has an inset gap`);
      const footX = active === 0 ? 2 * width + scale : width - scale;
      if (!same(pixel(cap, footX, rc.bottom - 2 * scale), hover)) {
        throw new Error(`${theme}: hover foot is clipped or missing`);
      }
    }
  } finally {
    client.close();
    await killAndWait(proc);
  }
}

export async function testit(): Promise<void> {
  setProcessDpiAware();
  await checkTheme("Light");
  await checkTheme("Dark");
  await checkTheme("Light", 60);
  await checkTheme("Dark", 60);
}

if (import.meta.main) await runStandalone(testit);
