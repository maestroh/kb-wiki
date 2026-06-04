import { execSync } from "node:child_process";

export function tokenizeRemoteUrl(url: string, token: string): string {
  return url.replace(/^https:\/\//, `https://${token}@`);
}

export interface SyncResult {
  committed: boolean;
  pushed: boolean;
  files: string[];
}

export function sync(repoDir: string, opts: { token?: string; message?: string } = {}): SyncResult {
  const run = (cmd: string): string =>
    execSync(cmd, { cwd: repoDir, encoding: "utf-8" }).trim();

  // 1. Stage and commit BEFORE pulling (rebase aborts on a dirty tree).
  run("git add -A");
  const staged = run("git diff --cached --name-only");
  const files = staged ? staged.split("\n").filter(Boolean) : [];
  let committed = false;
  if (files.length > 0) {
    const msg = (opts.message ?? "kb sync").replace(/"/g, '\\"');
    run(`git commit -m "${msg}"`);
    committed = true;
  }

  // 2. Rebase onto the remote (tree is now clean).
  run("git pull --rebase");

  // 3. Push — with token-injected URL when provided (headless auth).
  if (opts.token) {
    const remoteUrl = run("git remote get-url origin");
    const branch = run("git rev-parse --abbrev-ref HEAD");
    run(`git push "${tokenizeRemoteUrl(remoteUrl, opts.token)}" ${branch}`);
  } else {
    run("git push");
  }

  return { committed, pushed: true, files };
}

// CLI: sync.ts <repoDir>   (KNOWLEDGE_GIT_TOKEN env optional)
const [, , repoDirArg] = process.argv;
if (repoDirArg) {
  try {
    console.log(JSON.stringify(sync(repoDirArg, { token: process.env.KNOWLEDGE_GIT_TOKEN })));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
