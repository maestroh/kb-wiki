/**
 * Skill loader - load full skill content on-demand.
 */

import * as fs from 'fs';
import * as path from 'path';
import { LoadedSkill } from './models';
import { findSkillMd, readSkillContent } from './parser';
import { ParseError } from './errors';
import logger from '../llm/logger';

/**
 * List files in a directory, or return empty array if directory doesn't exist.
 */
function listDirectory(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  try {
    return fs.readdirSync(dirPath).filter(name => {
      const fullPath = path.join(dirPath, name);
      return fs.statSync(fullPath).isFile();
    });
  } catch {
    return [];
  }
}

/**
 * Load a complete skill including body content and available resources.
 *
 * @param skillDir - Path to the skill directory
 * @returns Fully loaded skill with all content
 * @throws ParseError if skill cannot be loaded
 */
export function loadSkill(skillDir: string): LoadedSkill {
  const resolvedPath = path.resolve(skillDir);

  // Read skill content
  const { properties, body } = readSkillContent(resolvedPath);

  // Find SKILL.md path
  const skillMdPath = findSkillMd(resolvedPath);
  if (!skillMdPath) {
    throw new ParseError(`SKILL.md not found in ${resolvedPath}`);
  }

  // List available resources
  const scriptsDir = path.join(resolvedPath, 'scripts');
  const referencesDir = path.join(resolvedPath, 'references');
  const assetsDir = path.join(resolvedPath, 'assets');

  const loadedSkill: LoadedSkill = {
    ...properties,
    path: resolvedPath,
    skillMdPath,
    body,
    scripts: listDirectory(scriptsDir),
    references: listDirectory(referencesDir),
    assets: listDirectory(assetsDir),
  };

  logger.debug(`Loaded skill: ${properties.name}`, {
    path: resolvedPath,
    bodyLength: body.length,
    scripts: loadedSkill.scripts.length,
    references: loadedSkill.references.length,
    assets: loadedSkill.assets.length,
  });

  return loadedSkill;
}

/**
 * Load a reference file from a skill.
 *
 * @param skillDir - Path to the skill directory
 * @param refName - Name of the reference file
 * @returns Content of the reference file
 * @throws Error if reference file not found
 */
export function loadReference(skillDir: string, refName: string): string {
  const refPath = path.join(path.resolve(skillDir), 'references', refName);

  if (!fs.existsSync(refPath)) {
    throw new Error(`Reference file not found: ${refName} in ${skillDir}`);
  }

  return fs.readFileSync(refPath, 'utf-8');
}

/**
 * Load an asset file from a skill.
 *
 * @param skillDir - Path to the skill directory
 * @param assetName - Name of the asset file
 * @returns Content of the asset file (as string or buffer for binary)
 * @throws Error if asset file not found
 */
export function loadAsset(skillDir: string, assetName: string): Buffer {
  const assetPath = path.join(path.resolve(skillDir), 'assets', assetName);

  if (!fs.existsSync(assetPath)) {
    throw new Error(`Asset file not found: ${assetName} in ${skillDir}`);
  }

  return fs.readFileSync(assetPath);
}

/**
 * Get the path to a script file in a skill.
 *
 * @param skillDir - Path to the skill directory
 * @param scriptName - Name of the script file
 * @returns Absolute path to the script
 * @throws Error if script file not found
 */
export function getScriptPath(skillDir: string, scriptName: string): string {
  const scriptPath = path.join(path.resolve(skillDir), 'scripts', scriptName);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script file not found: ${scriptName} in ${skillDir}`);
  }

  return scriptPath;
}

/**
 * Check if a skill has a specific script.
 *
 * @param skillDir - Path to the skill directory
 * @param scriptName - Name of the script file
 * @returns True if the script exists
 */
export function hasScript(skillDir: string, scriptName: string): boolean {
  const scriptPath = path.join(path.resolve(skillDir), 'scripts', scriptName);
  return fs.existsSync(scriptPath);
}

/**
 * Check if a skill has a specific reference.
 *
 * @param skillDir - Path to the skill directory
 * @param refName - Name of the reference file
 * @returns True if the reference exists
 */
export function hasReference(skillDir: string, refName: string): boolean {
  const refPath = path.join(path.resolve(skillDir), 'references', refName);
  return fs.existsSync(refPath);
}
