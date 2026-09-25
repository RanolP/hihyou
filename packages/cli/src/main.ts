#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  buildReviewDoc,
  createSyntaxParser,
  vcsFileSource,
} from "@hihyou/engine";
import { gitVcs, nodeGrammarLocator } from "@hihyou/engine/node";
import { createFormatter } from "@hihyou/present";
import { nodeRuffWasm } from "@hihyou/present/node";
import { exec } from "./exec.js";
import { renderPlain } from "./plain.js";
import { viewLoader } from "./review.js";
import { parseTarget, resolveTarget, usage } from "./target.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const target = parseTarget(positionals);
  const vcs = gitVcs(process.cwd());
  const source = vcsFileSource(vcs, await resolveTarget(target, vcs, exec));
  const doc = await buildReviewDoc(source, {
    parser: createSyntaxParser({ locateGrammar: nodeGrammarLocator }),
  });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    return;
  }
  const load = viewLoader(
    doc,
    source,
    createFormatter({ ruffWasm: nodeRuffWasm }),
  );
  if (process.stdout.isTTY && process.stdin.isTTY) {
    // Loaded only here so piped output never pays for React.
    const [{ render }, { createElement }, { App }] = await Promise.all([
      import("ink"),
      import("react"),
      import("./tui/app.js"),
    ]);
    await render(createElement(App, { doc, load }), {
      alternateScreen: true,
    }).waitUntilExit();
    return;
  }
  for await (const line of renderPlain(doc, load))
    if (!process.stdout.write(`${line}\n`))
      await new Promise((resolve) => process.stdout.once("drain", resolve));
}

// A reader that closes the pipe early (`| head`) is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main().catch((error: unknown) => {
  console.error(
    `hihyou: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
