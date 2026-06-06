/**
 * Skill discovery - scan directories for valid skills.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillProperties } from './models';
import { findSkillMd, readProperties } from './parser';
import { validate } from './validator';
import logger from '../llm/logger';

/**
 * Configuration for skill discovery.
 */
export interface DiscoveryConfig {
  /** Directories to scan for skills */
  skillsPaths: string[];

  /** Whether to scan subdirectories recursively */
  recursive?: boolean;

  /** Whether to skip invalid skills (true) or throw on first error (false) */
  skipInvalid?: boolean;
}

/**
 * Result of discovering a skill.
 */
export interface DiscoveredSkill extends SkillProperties {
  /** Absolute path to the skill directory */
  path: string;

  /** Path to the SKILL.md file */
  skillMdPath: string;
}

/**
 * Discovery result with both valid and invalid skills.
 */
export interface DiscoveryResult {
  /** Successfully discovered skills */
  skills: DiscoveredSkill[];

  /** Skills that failed validation */
  invalid: Array<{
    path: string;
    errors: string[];
  }>;

  /** Directories that were scanned */
  scannedPaths: string[];
}

/**
 * Scan a single directory for skill subdirectories.
 */
function scanDirectory(dirPath: string): string[] {
  const skillDirs: string[] = [];

  if (!fs.existsSync(dirPath)) {
    logger.warn(`Skills directory does not exist: ${dirPath}`);
    return skillDirs;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const potentialSkillDir = path.join(dirPath, entry.name);

      // Check if this directory contains a SKILL.md
      if (findSkillMd(potentialSkillDir) !== null) {
        skillDirs.push(potentialSkillDir);
      }
    }
  }

  return skillDirs;
}

/**
 * Discover all skills in configured directories.
 *
 * @param config - Discovery configuration
 * @returns Discovery result with valid skills and any errors
 */
export function discoverSkills(config: DiscoveryConfig): DiscoveryResult {
  const result: DiscoveryResult = {
    skills: [],
    invalid: [],
    scannedPaths: [],
  };

  const skipInvalid = config.skipInvalid ?? true;

  for (const skillsPath of config.skillsPaths) {
    const resolvedPath = path.resolve(skillsPath);
    result.scannedPaths.push(resolvedPath);

    // Handle ~ expansion for home directory
    const expandedPath = resolvedPath.replace(/^~/, process.env.HOME || '~');

    if (!fs.existsSync(expandedPath)) {
      logger.debug(`Skipping non-existent skills path: ${expandedPath}`);
      continue;
    }

    const skillDirs = scanDirectory(expandedPath);

    for (const skillDir of skillDirs) {
      // Validate the skill
      const errors = validate(skillDir);

      if (errors.length > 0) {
        result.invalid.push({ path: skillDir, errors });

        if (!skipInvalid) {
          throw new Error(
            `Invalid skill at ${skillDir}: ${errors.join(', ')}`
          );
        }

        logger.warn(`Skipping invalid skill: ${skillDir}`, { errors });
        continue;
      }

      // Read properties
      try {
        const properties = readProperties(skillDir);
        const skillMdPath = findSkillMd(skillDir);

        result.skills.push({
          ...properties,
          path: skillDir,
          skillMdPath: skillMdPath!,
        });

        logger.debug(`Discovered skill: ${properties.name}`, { path: skillDir });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.invalid.push({ path: skillDir, errors: [errorMsg] });

        if (!skipInvalid) {
          throw err;
        }

        logger.warn(`Failed to read skill properties: ${skillDir}`, { error: errorMsg });
      }
    }
  }

  logger.info(`Skill discovery complete`, {
    found: result.skills.length,
    invalid: result.invalid.length,
    paths: result.scannedPaths,
  });

  return result;
}

/**
 * Watch for skill changes in configured directories.
 * Returns a cleanup function to stop watching.
 *
 * @param config - Discovery configuration
 * @param onChange - Callback when skills change
 * @returns Cleanup function to stop watching
 */
export function watchSkills(
  config: DiscoveryConfig,
  onChange: (result: DiscoveryResult) => void
): () => void {
  const watchers: fs.FSWatcher[] = [];

  // Debounce to avoid rapid re-scans
  let debounceTimer: NodeJS.Timeout | null = null;
  const debounceMs = 500;

  const triggerRescan = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      logger.debug('Skills directory changed, re-scanning...');
      const result = discoverSkills(config);
      onChange(result);
    }, debounceMs);
  };

  for (const skillsPath of config.skillsPaths) {
    const resolvedPath = path.resolve(skillsPath);
    const expandedPath = resolvedPath.replace(/^~/, process.env.HOME || '~');

    if (!fs.existsSync(expandedPath)) {
      continue;
    }

    try {
      const watcher = fs.watch(expandedPath, { recursive: true }, (_eventType, filename) => {
        // Only trigger on SKILL.md changes or directory changes
        if (filename && (filename.endsWith('SKILL.md') || filename.endsWith('skill.md') || !filename.includes('.'))) {
          triggerRescan();
        }
      });

      watchers.push(watcher);
      logger.debug(`Watching skills directory: ${expandedPath}`);
    } catch (err) {
      logger.warn(`Failed to watch skills directory: ${expandedPath}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Return cleanup function
  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    for (const watcher of watchers) {
      watcher.close();
    }

    logger.debug('Stopped watching skills directories');
  };
}
