/**
 * Integration test: SkillService discovery + execution against a minimal fixture skill.
 *
 * Covers:
 *  - Discovery: SkillService finds the "echo" fixture skill after initialize()
 *  - Execution: executeScript("echo", "run.sh", ["hello"]) returns success:true
 *    and stdout containing "hello"
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SkillService } from './SkillService';

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to the fixtures directory (parent of each skill subdirectory)
const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

describe('SkillService — discovery + execution (fixture: echo)', () => {
  let service: SkillService;

  beforeEach(() => {
    service = new SkillService({
      enabled: true,
      paths: [FIXTURES_DIR],
      watchForChanges: false,
      skipInvalid: false,
    });
  });

  afterEach(async () => {
    await service.shutdown();
  });

  it('discovers the "echo" skill after initialize()', async () => {
    await service.initialize();

    const skills = service.getAvailableSkills();
    const names = skills.map(s => s.name);

    expect(names).toContain('echo');
  });

  it('executes run.sh and returns success:true with stdout containing the argument', async () => {
    await service.initialize();

    const result = await service.executeScript('echo', 'run.sh', ['hello']);

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
  });
});
