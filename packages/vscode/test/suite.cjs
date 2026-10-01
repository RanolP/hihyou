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

  // Catches the diffsets view listing the wrong commits for the branch (missing one, walking past where it left
  // main, or the wrong order), or a commit row whose file tree shows paths that commit did not change.
  const branch = process.env.HIHYOU_BRANCH_COMMITS;
  if (branch) {
    const expected = JSON.parse(branch);
    const tree = api.diffsets;
    const roots = await tree.children();
    assert.deepEqual(
      roots.map((n) => tree.item(n).label),
      ["Working tree", "Staged", ...expected.map((c) => c.subject)],
    );
    const leaves = async (node) => {
      const paths = [];
      for (const child of await tree.children(node)) {
        const item = tree.item(child);
        if (item.collapsibleState === vscode.TreeItemCollapsibleState.None)
          paths.push(
            item.resourceUri
              ? item.resourceUri.path.slice(1)
              : `<${item.label}>`,
          );
        else paths.push(...(await leaves(child)));
      }
      return paths;
    };
    for (const [i, commit] of expected.entries())
      assert.deepEqual(
        (await leaves(roots[i + 2])).sort(),
        [...commit.paths].sort(),
        `files of ${commit.subject}`,
      );
    console.log(
      `hihyou e2e: diffsets view listed ${expected.length} branch commits with their files`,
    );
  }
};
