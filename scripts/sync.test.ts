import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { tokenizeRemoteUrl, sync } from "./sync.js";

describe("tokenizeRemoteUrl", () => {
  it("injects a token into an https remote", () => {
    expect(tokenizeRemoteUrl("https://github.com/o/r.git", "TKN")).toBe("https://TKN@github.com/o/r.git");
  });
  it("leaves non-https remotes unchanged", () => {
    expect(tokenizeRemoteUrl("/tmp/remote.git", "TKN")).toBe("/tmp/remote.git");
  });
});

describe("sync (offline local remote)", () => {
  let work: string;
  let remote: string;
  const git = (dir: string, cmd: string) => execSync(`git ${cmd}`, { cwd: dir, encoding: "utf-8" });

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "kb-sync-"));
    work = join(base, "work");
    remote = join(base, "remote.git");
    execSync(`git init --bare "${remote}"`);
    execSync(`git clone "${remote}" "${work}"`);
    git(work, 'config user.email "t@t.t"');
    git(work, 'config user.name "t"');
    writeFileSync(join(work, "seed.md"), "seed");
    git(work, "add -A");
    git(work, 'commit -m seed');
    git(work, "push -u origin HEAD:main");
  });
  afterEach(() => rmSync(join(work, ".."), { recursive: true, force: true }));

  it("commits a dirty tree and pushes", () => {
    writeFileSync(join(work, "new.md"), "new content");
    const res = sync(work);
    expect(res.committed).toBe(true);
    expect(res.files).toContain("new.md");
    expect(res.pushed).toBe(true);
    // verify the remote received it
    const log = execSync(`git --git-dir="${remote}" log --oneline`, { encoding: "utf-8" });
    expect(log).toMatch(/kb sync/);
  });

  it("is a no-op commit on a clean tree but still pushes", () => {
    const res = sync(work);
    expect(res.committed).toBe(false);
    expect(res.files).toEqual([]);
    expect(res.pushed).toBe(true);
  });
});
