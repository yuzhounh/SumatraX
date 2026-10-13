// Run on an unlocked desktop: bun tests/ad-hoc-window-shadow.ts [--no-build]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cmdId, makeOnePagePdf, runStandalone, tmpPath } from "./util.ts";
import { killAndWait, launchSumatra, sendCommandSync, waitForFrame } from "./win-automation.ts";
import {
  captureWindowDCRegionToPng,
  clientToScreen,
  CLR_INVALID,
  DwmCorner,
  getForegroundWindow,
  getWindowRect,
  getWorkArea,
  hasInteractiveDesktop,
  readWindowDCRow,
  setDwmCornerPref,
  setForegroundWindow,
  setProcessDpiAware,
  setWindowPos,
  showWindow,
  SW_MAXIMIZE,
  SW_RESTORE,
  waitForWindowIdle,
} from "./winapi.ts";

const SAMPLE_WIDTH = 48;
const TIMEOUT_MS = 5000;
const SHADOW_SETTLE_MS = 300;
const MAX_SHADOW_UPDATES = 100;

async function launch(args: string[]): Promise<{ proc: Bun.Subprocess; frame: number }> {
  const proc = launchSumatra(args);
  const frame = await waitForFrame(proc.pid!);
  if (!frame) {
    await killAndWait(proc);
    throw new Error("window did not appear");
  }
  await waitForWindowIdle(frame);
  return { proc, frame };
}

function gray(color: number): number {
  if (color === CLR_INVALID) {
    throw new Error("desktop pixels unavailable");
  }
  return ((color & 255) + ((color >> 8) & 255) + ((color >> 16) & 255)) / 3;
}

async function checkShadow(frame: number, label: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let stableSince = 0;
  let pixels: number[] = [];
  do {
    const r = getWindowRect(frame);
    pixels = readWindowDCRow(0, r.right + 2, Math.floor((r.top + r.bottom) / 2), SAMPLE_WIDTH).map(gray);
    const near = Math.min(...pixels.slice(0, 12));
    const far = Math.min(...pixels.slice(-8));
    if (getForegroundWindow() === frame && far >= 250 && near >= 160 && far - near >= 5) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= SHADOW_SETTLE_MS) {
        console.log(`${label}: shadow contrast ${Math.round(far - near)}`);
        captureWindowDCRegionToPng(0, r.right - 12, r.top + 100, 80, 160, tmpPath(`shadow-${label}.png`), 2);
        return;
      }
    } else {
      stableSince = 0;
    }
    await Bun.sleep(50);
  } while (Date.now() < deadline);
  const r = getWindowRect(frame);
  captureWindowDCRegionToPng(0, r.right - 12, r.top + 100, 80, 160, tmpPath(`shadow-${label}.png`), 2);
  throw new Error(`${label}: missing shadow over white background; pixels=${pixels.map(Math.round).join(",")}`);
}

export async function testit(): Promise<void> {
  if (!hasInteractiveDesktop()) {
    throw new Error("window shadow test requires an unlocked desktop");
  }
  setProcessDpiAware();
  const area = getWorkArea();
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  const pdf = tmpPath("window-shadow.pdf");
  writeFileSync(pdf, makeOnePagePdf({ mediaBox: `[0 0 ${width} ${height}]` }));
  const appdata = tmpPath("window-shadow-settings");
  mkdirSync(appdata, { recursive: true });
  writeFileSync(join(appdata, "SumatraX-settings.txt"), "UseTabs = true\n");
  const backdrop = await launch(["-appdata", appdata, "-presentation", pdf]);
  let front: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    setWindowPos(backdrop.frame, area.left, area.top, width, height, 0);
    front = await launch([
      "-appdata",
      appdata,
      "-log-to-file",
      tmpPath("window-shadow.log"),
      "-window-pos",
      `${Math.floor(width / 2)}x${Math.floor(height * 0.75)}@${area.left + 50}x${area.top + 50}`,
      pdf,
    ]);
    const r = getWindowRect(front.frame);
    if (clientToScreen(front.frame, 0, 0).y - r.top > 1) {
      throw new Error("test did not enable the custom titlebar");
    }
    setWindowPos(front.frame, r.left, r.top, r.right - r.left, r.bottom - r.top, 0);
    setForegroundWindow(front.frame);
    await checkShadow(front.frame, "normal");
    // Snapped windows use square corners.
    if (!setDwmCornerPref(front.frame, DwmCorner.Square)) {
      throw new Error("square-corner test requires Windows 11");
    }
    setWindowPos(front.frame, area.left, area.top, Math.floor(width / 2), height, 0);
    await checkShadow(front.frame, "left-half");
    showWindow(front.frame, SW_MAXIMIZE);
    showWindow(front.frame, SW_RESTORE);
    await checkShadow(front.frame, "restored");
    sendCommandSync(front.frame, cmdId("CmdToggleFullscreen"));
    sendCommandSync(front.frame, cmdId("CmdToggleFullscreen"));
    setDwmCornerPref(front.frame, DwmCorner.Square);
    await checkShadow(front.frame, "fullscreen-exit");
  } finally {
    if (front) {
      await killAndWait(front.proc);
    }
    await killAndWait(backdrop.proc);
  }
  const log = readFileSync(tmpPath("window-shadow.log"), "utf8");
  const updates = log.match(/will execute 'RestoreWindowShadow'/g)?.length ?? 0;
  if (updates > MAX_SHADOW_UPDATES) {
    throw new Error(`frame update loop: ${updates} shadow updates for four window states`);
  }
  console.log(`shadow updates: ${updates}`);
}

if (import.meta.main) {
  await runStandalone(testit);
}
