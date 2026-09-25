import { execFile } from "node:child_process";

/** Runs a command and resolves its stdout; rejects with the command line, exit code and stderr. */
export type Exec = (command: string, args: string[]) => Promise<string>;

export const exec: Exec = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 1 << 28 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const detail = stderr.trim() || error.message;
        reject(
          new Error(
            `${[command, ...args].join(" ")} exited ${error.code}: ${detail}`,
          ),
        );
      },
    );
  });
