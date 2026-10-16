// Folder navigation must keep the image background throughout asynchronous loading.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ControlCommand } from "./control.ts";
import { cmdId, runStandalone, SETTINGS_FILE, tmpPath } from "./util.ts";
import { captureWindowPixels, CLR_INVALID, readWindowDCColumn, sleep } from "./winapi.ts";
import { findCanvas, killAndWait, launchControlled, sendCommand } from "./win-automation.ts";

function makeBmp(width: number, height: number): Buffer {
  const stride = (width * 3 + 3) & ~3;
  const bmp = Buffer.alloc(54 + stride * height, 80);
  bmp.fill(0, 0, 54);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  return bmp;
}

async function checkBackground(background?: string): Promise<void> {
  const dir = tmpPath(`image-switch-background-${background ?? "default"}`);
  const appdata = join(dir, "settings");
  mkdirSync(appdata, { recursive: true });
  writeFileSync(
    join(appdata, SETTINGS_FILE),
    `Theme = Light\nRestoreSession = false\nCheckForUpdates = false\nImageUI [\n  WindowBgCol = ${background ?? ""}\n]\n`,
  );
  writeFileSync(join(dir, "aaa.bmp"), makeBmp(128, 512));
  writeFileSync(join(dir, "bbb.bmp"), makeBmp(2048, 4096));
  const expected = background ? Number.parseInt(background.slice(1), 16) : 0;
  const expectedRgb = [(expected >> 16) & 255, (expected >> 8) & 255, expected & 255];
  const expectedColorref = expectedRgb[0]! | (expectedRgb[1]! << 8) | (expectedRgb[2]! << 16);
  const { proc, client, frame } = await launchControlled(["-appdata", appdata, join(dir, "aaa.bmp")]);
  try {
    await client.setNotificationsEnabled(false);
    await client.waitForRenderIdle();
    const canvas = findCanvas(frame);
    if (!canvas) throw new Error("image-switch-background: no canvas");
    for (const command of ["CmdOpenNextFileInFolder", "CmdOpenPrevFileInFolder"]) {
      sendCommand(frame, cmdId(command));
      const deadline = Date.now() + 400;
      let samples = 0;
      while (Date.now() < deadline) {
        for (const color of readWindowDCColumn(canvas, 8, 8, 4)) {
          if (color === CLR_INVALID) continue;
          samples++;
          if (color !== expectedColorref) {
            throw new Error(
              `image-switch-background: ${command} flashed #${color.toString(16).padStart(6, "0")}, expected ${expectedColorref.toString(16)}`,
            );
          }
        }
        // Force real WM_PAINT too, covering the loading page on occluded windows.
        const capture = captureWindowPixels(canvas);
        if (!capture) throw new Error("image-switch-background: capture failed");
        const offset = (8 * capture.w + 8) * 4;
        const actual = [capture.data[offset + 2], capture.data[offset + 1], capture.data[offset]];
        if (actual.some((value, i) => value !== expectedRgb[i])) {
          throw new Error(`image-switch-background: ${command} painted ${actual}, expected ${expectedRgb}`);
        }
        await sleep(1);
      }
      if (!samples) throw new Error("image-switch-background: no visible pixel samples");
      await client.waitForRenderIdle();
      const state = await client.request(ControlCommand.TestCurrentTab, []);
      const expectedFile = command === "CmdOpenNextFileInFolder" ? "bbb.bmp" : "aaa.bmp";
      if (state[0] !== 0 || !String(state[1]).includes(expectedFile)) {
        throw new Error(`image-switch-background: navigation failed: ${state[1]}`);
      }
    }
  } finally {
    client.close();
    await killAndWait(proc);
  }
}

export async function testit(): Promise<void> {
  await checkBackground();
  await checkBackground("#182838");
}

if (import.meta.main) {
  await runStandalone(testit);
}
