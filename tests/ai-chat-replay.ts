// Debug the chat webview rendering WITHOUT calling a provider: opens an installed provider's
// panel on a PDF and injects a canned (user, assistant) turn via the
// -dbg-control TestAIChatReplay command, which takes the same WebView* path a
// real turn does (addUser + appendText + flushBlock). Lets you iterate on the
// webview render fast; watch the app window to see it render. Needs a PDF path.
//   bun tests/ai-chat-replay.ts --no-build "C:\\path\\doc.pdf"
import { ControlCommand, withControlledSumatra } from "./control";
import { EXE, runStandalone } from "./util";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

export function testBatching(): void {
  const source = readFileSync(new URL("../src/AIChatCommon.cpp", import.meta.url), "utf8");
  const script = source.slice(source.indexOf("var chatDiv ="), source.indexOf("</script></body></html>)"));
  let parses = 0;
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const element = (): any => ({
    children: [] as any[],
    appendChild(child: any) {
      this.children.push(child);
    },
    replaceChildren(content: any) {
      this.html = content.html;
    },
    set innerHTML(value: string) {
      this.children = [];
      this.content = { html: value, querySelectorAll: () => [] };
    },
  });
  const chat = element();
  const context: any = {
    document: { getElementById: () => chat, createElement: () => element(), body: { scrollHeight: 10 } },
    marked: {
      parse(text: string) {
        parses++;
        return text;
      },
    },
    window: { scrollTo() {} },
    setTimeout(fn: () => void) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  };
  runInNewContext(script, context);
  for (let i = 0; i < 1000; i++) context.appendText("x");
  assert.equal(parses, 0);
  assert.equal(timers.size, 1, "A burst must schedule only one render");
  [...timers.values()][0]();
  assert.equal(parses, 1);
  assert.equal(chat.children[0].html, "x".repeat(1000));
  context.flushBlock();
  assert.equal(parses, 1, "Finishing an already rendered block must not parse it again");
  context.appendText("tail");
  context.addTool("tool");
  assert.equal(chat.children[1].html, "tail", "Tool boundaries must flush pending text immediately");
  assert.equal(chat.children[2].className, "tool");
  context.appendText("last");
  context.flushBlock();
  assert.equal(chat.children[3].html, "last");
  context.appendText("discard");
  context.clearChat();
  assert.equal(timers.size, 0);
  assert.equal(chat.children.length, 0, "Clearing or switching sessions must cancel pending rendering");
  context.marked = undefined;
  context.appendText("plain");
  context.flushBlock();
  assert.equal(chat.children[0].textContent, "plain");
  console.log("ai-chat batching: burst coalescing, boundaries, finish, clear, fallback OK");
}

const PDF =
  process.argv.slice(2).filter((a) => a !== "--no-build")[0] ??
  "C:\\Users\\kjk\\Downloads\\a_players_guide_to_talislanta.1.pdf";

const USER = "summarize page 1";
const RESPONSE = [
  "I'll read page 1 of the guide.",
  "",
  "## Summary of page 1",
  "",
  "Page 1 opens **The Northern Reaches**.",
  "",
  "- **L'Haan**: a frozen land of the blue-skinned **Mirin**, ruled by the Snow Queen.",
  "- **Narandu**: a frozen wasteland stretching across the far north.",
  "",
  "*(printed page number is 23)*",
].join("\n");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function testit(): Promise<void> {
  testBatching();
  await withControlledSumatra(
    EXE,
    async (client) => {
      let res: Awaited<ReturnType<typeof client.request>> = [];
      const deadline = Date.now() + 15000;
      do {
        res = await client.request(ControlCommand.TestAIChatReplay, [USER, RESPONSE]);
        if (Number(res[0]) === 0 || !String(res[1]).startsWith("NOTREADY")) break;
        await sleep(100);
      } while (Date.now() < deadline);
      if (Number(res[0]) !== 0) throw new Error("TestAIChatReplay failed: " + String(res[1]));
      console.log("ai-chat-replay: " + String(res[1]));
      const hold = Math.min(30000, Math.max(0, Number(process.env.SUMATRA_REPLAY_HOLD_MS) || 0));
      if (hold) await sleep(hold);
    },
    [PDF],
  );
  console.log("ai-chat-replay: OK");
}

if (import.meta.main) {
  await runStandalone(testit);
}
