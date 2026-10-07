// A test stuck in a synchronous loop blocks its worker's event loop, so vitest's own testTimeout never fires and the
// worker spins until someone kills it (one ran 21.5 hours after its session ended, and shrugged off SIGTERM). This
// setup file starts a watchdog on a separate thread, which keeps running while the test thread is stuck: it SIGKILLs
// the worker once one test file has run longer than its budget, or once the vitest process that forked it is gone.
import { Worker } from "node:worker_threads";
import { afterAll, expect } from "vitest";

const budgetMs = Number(process.env.HIHYOU_TEST_FILE_BUDGET_MS ?? 60_000);

const watchdogSource = `
const { parentPort, workerData } = require("node:worker_threads");
const { writeSync } = require("node:fs");
const { ppid, budgetMs } = workerData;
let file;
let deadline = Infinity;
parentPort.on("message", (m) => {
  file = m.file;
  deadline = m.file === undefined ? Infinity : Date.now() + budgetMs;
});
const die = (why) => {
  // fd 2 directly, since process.stderr goes through the stuck main thread; an orphan's stderr pipe is closed (EPIPE).
  try {
    writeSync(2, "\\n[vitest.watchdog] " + why + "; killing worker pid " + process.pid + "\\n");
  } catch {}
  process.kill(process.pid, "SIGKILL");
};
// A worker thread's process.ppid is a snapshot taken at its start, so probe the parent instead.
const parentAlive = () => {
  try {
    process.kill(ppid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
setInterval(() => {
  if (!parentAlive()) die("vitest (pid " + ppid + ") exited while " + (file ?? "a test file") + " was running");
  else if (Date.now() > deadline) die(file + " ran longer than " + budgetMs + " ms (HIHYOU_TEST_FILE_BUDGET_MS)");
}, 1000);
`;

const key = Symbol.for("hihyou.vitest.watchdog");
const g = globalThis as { [key]?: Worker };
const watchdog = (g[key] ??= new Worker(watchdogSource, {
  eval: true,
  workerData: { ppid: process.ppid, budgetMs },
}));
watchdog.unref();

// Armed as the setup file runs, before the test file is imported, so a loop at a test file's top level is caught too.
watchdog.postMessage({ file: expect.getState().testPath ?? "a test file" });
afterAll(() => {
  watchdog.postMessage({ file: undefined });
});
