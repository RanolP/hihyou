// Runs inside VS Code for the Web's extension host (a web worker: no Node, no process.env), loaded by
// test/web.mjs on a fresh repository with the file below edited.
const vscode = require("vscode");

const touched = "hello.ts";

function check(ok, message) {
  if (!ok) throw new Error(`hihyou web e2e: ${message}`);
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension("ranolp.hihyou-vscode");
  check(extension, "the extension under development is not installed");
  const api = await extension.activate();

  // Catches the web entry failing to read .git/config through vscode.workspace.fs.
  check(await api.hasGitHubRemote(), "hihyou.hasGitHubRemote is false");

  // Catches a working-tree review that cannot run without Node, or misses the edited file.
  const files = await vscode.commands.executeCommand(
    "hihyou.reviewWorkingTree",
  );
  check(
    Array.isArray(files),
    `reviewWorkingTree returned ${JSON.stringify(files)}`,
  );
  const file = files.find((f) => f.path === touched);
  check(
    file,
    `${touched} missing from [${files.map((f) => f.path).join(", ")}]`,
  );
  check(file.change, `${touched} carries no ChangedFileRef`);
  check(
    file.fragments.some((f) => f.kind === "diff"),
    `${touched} has no diff fragment`,
  );
  console.log(
    `hihyou web e2e: reviewWorkingTree posted ${files.length} files, including ${touched}`,
  );
};
