#!/usr/bin/env node
// Development only: screenshots a URL at exact CSS widths, in light and dark, with headless Chrome over its debugging protocol.
// Usage: node scripts/shoot.mjs <url> <out-dir> --widths 320,375,414,768 --schemes light,dark [--dpr 3] [--height 812]
// Chrome refuses --window-size under ~500px, so the width is set with Emulation.setDeviceMetricsOverride and checked.
// Exit 1 if anything is off: navigation fails, the page has nothing matching --expect (default "#root > *"), the colour scheme
// or innerWidth is not what was asked for, or a shot takes over --timeout seconds (default 30). Exit 2 if any page scrolls sideways.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args[0];
const outDir = args[1];
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
if (!url || !outDir || url.startsWith("--") || outDir.startsWith("--")) {
  console.error("usage: node scripts/shoot.mjs <url> <out-dir> --widths 320,375 --schemes light,dark [--dpr 3] [--height 812]");
  process.exit(64);
}
const widths = opt("widths", "320,375,414,768").split(",").map(Number);
const schemes = opt("schemes", "light,dark").split(",");
const dpr = Number(opt("dpr", "1"));
const height = Number(opt("height", "812"));
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "shoot-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; proc.kill(); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} };
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { stop(); process.exit(130); });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  proc.on("exit", () => reject(new Error("Chrome exited before it was ready")));
  setTimeout(() => reject(new Error("Chrome did not start")), 20000);
});
const port = new URL(wsUrl).port;
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
const waiters = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
  else if (m.method) waiters.forEach((w) => w(m));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const loaded = () => new Promise((resolve) => { const w = (m) => { if (m.method === "Page.loadEventFired") { waiters.splice(waiters.indexOf(w), 1); resolve(); } }; waiters.push(w); });

await send("Page.enable");
const timeoutMs = Number(opt("timeout", "30")) * 1000;
const expect = opt("expect", "#root > *");
const within = (promise, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), timeoutMs))]);

async function shoot(scheme, width) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  const done = loaded();
  const nav = await send("Page.navigate", { url });
  if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
  await within(done, "page load");
  // Lazy images below the fold only load once scrolled to.
  await evaluate("(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); } scrollTo(0, 0); })()");
  await evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 1500)))");
  const m = await evaluate(`({ inner: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    dark: matchMedia("(prefers-color-scheme: dark)").matches, scheme: location.protocol, content: document.querySelector(${JSON.stringify(expect)}) !== null })`);
  if (m.scheme === "chrome-error:") throw new Error("Chrome showed its error page (is the server running?)");
  if (!m.content) throw new Error(`nothing matches "${expect}" on the page (wrong URL or view?)`);
  if (m.dark !== (scheme === "dark")) throw new Error(`prefers-color-scheme is ${m.dark ? "dark" : "light"}, wanted ${scheme}`);
  if (m.inner !== width) throw new Error(`innerWidth is ${m.inner}, wanted ${width}`);
  if (process.env.SHOOT_DEBUG) console.log(await evaluate("[...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' | ')"));
  const side = m.scroll > m.inner || m.body > m.inner;
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
  const file = join(outDir, `${scheme}-${width}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`${scheme} ${width}px: innerWidth=${m.inner} scrollWidth=${m.scroll} sideways=${side ? "YES" : "no"} ${file}`);
  return side;
}

let code = 0;
try {
  for (const scheme of schemes) for (const width of widths) {
    if (await within(shoot(scheme, width), `${scheme} ${width}px`)) code = 2;
  }
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  code = 1;
}
try { ws.close(); } catch {}
stop();
process.exit(code);
