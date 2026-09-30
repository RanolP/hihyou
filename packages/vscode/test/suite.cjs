// Runs inside VS Code's extension host, loaded by test/run.mjs; the environment names what to expect.
const assert = require("node:assert/strict");
const vscode = require("vscode");

exports.run = async () => {
  const extension = vscode.extensions.getExtension("ranolp.hihyou-vscode");
  assert.ok(extension, "the extension under development is not installed");
  const api = await extension.activate();

  // Catches the GitHub commands showing for a repository without a github.com remote, or hiding for one with it.
  const expectGitHub = process.env.HIHYOU_EXPECT_GITHUB === "1";
  assert.equal(
    await api.hasGitHubRemote(),
    expectGitHub,
    "hihyou.hasGitHubRemote",
  );

  // Catches a working-tree review that misses an edited tracked file, or posts it without a changed line.
  const touched = process.env.HIHYOU_TOUCHED;
  if (touched) {
    const files = await vscode.commands.executeCommand(
      "hihyou.reviewWorkingTree",
    );
    assert.ok(
      Array.isArray(files),
      `reviewWorkingTree returned ${JSON.stringify(files)}`,
    );
    const file = files.find((f) => f.path === touched);
    assert.ok(
      file,
      `${touched} missing from [${files.map((f) => f.path).join(", ")}]`,
    );
    assert.ok(file.change, `${touched} carries no ChangedFileRef`);
    assert.ok(
      file.fragments.some((f) => f.kind === "diff"),
      `${touched} has no diff fragment: ${JSON.stringify(file.fragments).slice(0, 500)}`,
    );
    console.log(
      `hihyou e2e: reviewWorkingTree posted ${files.length} files, including ${touched}`,
    );
  }
};
