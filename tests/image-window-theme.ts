import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { cmdId, pollUntil, runStandalone, SETTINGS_FILE, tmpPath } from "./util.ts";
import {
  captureWindowPixels,
  captureWindowToPng,
  clientToScreen,
  enumWindows,
  findChildWindow,
  getClassName,
  getWindowPid,
  moveWindow,
  repaintWindow,
  postMessage,
  sendCopyDataW,
  sleep,
} from "./winapi.ts";
import {
  FRAME_CLASS,
  findCanvas,
  killAndWait,
  launchControlled,
  openContextMenu,
  sendCommandSync,
  waitForContextMenu,
} from "./win-automation.ts";

const COPY_DATA_DDE_W = 0x44646557;
const WM_CANCELMODE = 0x001f;

function imageFixture(): Buffer {
  const image = Buffer.alloc(54 + 96 * 256, 80);
  image.fill(0, 0, 54);
  image.write("BM");
  image.writeUInt32LE(image.length, 2);
  image.writeUInt32LE(54, 10);
  image.writeUInt32LE(40, 14);
  image.writeInt32LE(32, 18);
  image.writeInt32LE(256, 22);
  image.writeUInt16LE(1, 26);
  image.writeUInt16LE(24, 28);
  return image;
}

function toolbarShade(frame: number): number {
  const hwnd = findChildWindow(frame, "SUMATRA_VIRT_TOOLBAR");
  const pixels = captureWindowPixels(hwnd);
  if (!pixels) throw new Error("image-window-theme: no toolbar pixels");
  const offset = (Math.floor(pixels.h / 2) * pixels.w + Math.floor(pixels.w / 2)) * 4;
  return (pixels.data[offset]! + pixels.data[offset + 1]! + pixels.data[offset + 2]!) / 3;
}

function pageHash(frame: number): string {
  const pixels = captureWindowPixels(findCanvas(frame));
  if (!pixels) throw new Error("image-window-theme: no page pixels");
  const hash = createHash("sha256");
  for (let y = 16; y < pixels.h - 48; y += 4) {
    hash.update(pixels.data.subarray((y * pixels.w + 16) * 4, (y * pixels.w + pixels.w - 48) * 4));
  }
  return hash.digest("hex");
}

async function expectTheme(frame: number, dark: boolean): Promise<void> {
  await pollUntil(
    async () => toolbarShade(frame),
    (shade) => (dark ? shade < 60 : shade > 200),
    {
      timeoutMs: 5000,
      error: (shade) => `image-window-theme: toolbar shade=${shade}, expected ${dark ? "dark" : "light"}`,
    },
  );
}

async function expectMenu(frame: number, dark: boolean): Promise<void> {
  const canvas = findCanvas(frame);
  const point = clientToScreen(canvas, 24, 24);
  openContextMenu(canvas, point.x, point.y);
  const menu = await waitForContextMenu();
  if (!menu) throw new Error("image-window-theme: context menu did not open");
  try {
    const pixels = captureWindowPixels(menu);
    if (!pixels) throw new Error("image-window-theme: no menu pixels");
    const shades = Array(26).fill(0);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const shade = Math.floor((pixels.data[i]! + pixels.data[i + 1]! + pixels.data[i + 2]!) / 30);
      shades[shade]++;
    }
    const shade = shades.indexOf(Math.max(...shades)) * 10;
    if (dark ? shade > 60 : shade < 200) throw new Error(`image-window-theme: menu shade=${shade}, dark=${dark}`);
  } finally {
    postMessage(frame, WM_CANCELMODE, 0, 0);
    await sleep(50);
  }
}

async function checkTheme(minimal: boolean): Promise<void> {
  const dir = tmpPath(`image-window-theme-${minimal ? "minimal" : "full"}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, SETTINGS_FILE),
    `Theme = Light\nCheckForUpdates = false\nRestoreSession = false\nDocumentColorsFollowTheme = smart\nMinimalViewer = ${minimal}\nContextMenu = true\n`,
  );
  const image = join(dir, "image.bmp");
  writeFileSync(image, imageFixture());
  const pdf = resolve("tests/issue-3219.pdf");
  const { proc, client, frame } = await launchControlled(["-appdata", dir, pdf]);
  try {
    await client.setNotificationsEnabled(false);
    await client.waitForRenderIdle();
    await expectTheme(frame, false);
    const originalPage = pageHash(frame);
    if (!sendCopyDataW(frame, COPY_DATA_DDE_W, `[Open("${image}")]`))
      throw new Error("image-window-theme: image open failed");
    await client.waitForRenderIdle();
    await expectTheme(frame, true);
    for (let i = 0; i < 3; i++) {
      sendCommandSync(frame, cmdId("CmdPrevTab"));
      await client.waitForRenderIdle();
      await expectTheme(frame, false);
      if (pageHash(frame) !== originalPage) throw new Error("image-window-theme: PDF page changed after image tab");
      sendCommandSync(frame, cmdId("CmdNextTab"));
      await client.waitForRenderIdle();
      await expectTheme(frame, true);
    }
    sendCommandSync(frame, cmdId("CmdCloseCurrentDocument"));
    await client.waitForRenderIdle();
    await expectTheme(frame, false);
    if (pageHash(frame) !== originalPage) throw new Error("image-window-theme: PDF changed after closing image tab");
    if (!sendCopyDataW(frame, COPY_DATA_DDE_W, `[Open("${image}",1,0,0)]`))
      throw new Error("image-window-theme: second image open failed");
    const second = await pollUntil(
      async () => {
        let result = 0;
        enumWindows((hwnd) => {
          if (hwnd !== frame && getWindowPid(hwnd) === proc.pid && getClassName(hwnd) === FRAME_CLASS) result = hwnd;
          return true;
        });
        return result;
      },
      (hwnd) => hwnd !== 0,
      { timeoutMs: 8000, error: "image-window-theme: no second window" },
    );
    moveWindow(second, 50, 50, 700, 620);
    await expectTheme(second, true);
    for (let i = 0; i < 3; i++) {
      repaintWindow(frame);
      await expectTheme(frame, false);
      if (pageHash(frame) !== originalPage) throw new Error("image-window-theme: other window changed PDF page");
      repaintWindow(second);
      await expectTheme(second, true);
      await sleep(10);
    }
    captureWindowToPng(frame, join(dir, "pdf-window.png"));
    captureWindowToPng(second, join(dir, "image-window.png"));
    if (!minimal) {
      await expectMenu(second, true);
      await expectMenu(frame, false);
      await expectTheme(second, true);
      await expectTheme(frame, false);
      if (pageHash(frame) !== originalPage) throw new Error("image-window-theme: PDF changed after menu repaint");
    }
  } finally {
    client.close();
    await killAndWait(proc);
  }
}

export async function testit(): Promise<void> {
  await checkTheme(true);
  await checkTheme(false);
}

if (import.meta.main) await runStandalone(testit);
