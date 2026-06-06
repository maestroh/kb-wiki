/**
 * Skill validation logic.
 * Port of skills-ref/validator.py
 */

import * as fs from 'fs';
import * as path from 'path';
import { findSkillMd, parseFrontmatter } from './parser';
import { ParseError } from './errors';

/** Maximum length for skill name */
export const MAX_SKILL_NAME_LENGTH = 64;

/** Maximum length for description */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Maximum length for compatibility field */
export const MAX_COMPATIBILITY_LENGTH = 500;

/** Allowed frontmatter fields per Agent Skills Spec */
export const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
]);

/**
 * Validate skill name format and directory match.
 *
 * Skill names support alphanumeric characters plus hyphens.
 * Names must be lowercase and cannot start/end with hyphens.
 *
 * @param name - The skill name to validate
 * @param skillDir - Optional path to skill directory for name-directory match check
 * @returns List of validation error messages
 */
function validateName(name: unknown, skillDir?: string): string[] {
  const errors: string[] = [];

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push("Field 'name' must be a non-empty string");
    return errors;
  }

  const normalizedName = name.trim();

  if (normalizedName.length > MAX_SKILL_NAME_LENGTH) {
    errors.push(
      `Skill name '${normalizedName}' exceeds ${MAX_SKILL_NAME_LENGTH} character limit ` +
      `(${normalizedName.length} chars)`
    );
  }

  if (normalizedName !== normalizedName.toLowerCase()) {
    errors.push(`Skill name '${normalizedName}' must be lowercase`);
  }

  if (normalizedName.startsWith('-') || normalizedName.endsWith('-')) {
    errors.push('Skill name cannot start or end with a hyphen');
  }

  if (normalizedName.includes('--')) {
    errors.push('Skill name cannot contain consecutive hyphens');
  }

  // Check for valid characters (alphanumeric and hyphens only)
  if (!/^[a-z0-9-]+$/.test(normalizedName)) {
    errors.push(
      `Skill name '${normalizedName}' contains invalid characters. ` +
      'Only lowercase letters, digits, and hyphens are allowed.'
    );
  }

  // Check directory name matches skill name
  if (skillDir) {
    const dirName = path.basename(skillDir);
    if (dirName !== normalizedName) {
      errors.push(
        `Directory name '${dirName}' must match skill name '${normalizedName}'`
      );
    }
  }

  return errors;
}

/**
 * Validate description format.
 *
 * @param description - The description to validate
 * @returns List of validation error messages
 */
function validateDescription(description: unknown): string[] {
  const errors: string[] = [];

  if (!description || typeof description !== 'string' || !description.trim()) {
    errors.push("Field 'description' must be a non-empty string");
    return errors;
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `Description exceeds ${MAX_DESCRIPTION_LENGTH} character limit ` +
      `(${description.length} chars)`
    );
  }

  return errors;
}

/**
 * Validate compatibility format.
 *
 * @param compatibility - The compatibility string to validate
 * @returns List of validation error messages
 */
function validateCompatibility(compatibility: unknown): string[] {
  const errors: string[] = [];

  if (typeof compatibility !== 'string') {
    errors.push("Field 'compatibility' must be a string");
    return errors;
  }

  if (compatibility.length > MAX_COMPATIBILITY_LENGTH) {
    errors.push(
      `Compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} character limit ` +
      `(${compatibility.length} chars)`
    );
  }

  return errors;
}

/**
 * Validate that only allowed fields are present.
 *
 * @param metadata - The parsed frontmatter metadata
 * @returns List of validation error messages
 */
function validateMetadataFields(metadata: Record<string, unknown>): string[] {
  const errors: string[] = [];

  const extraFields = Object.keys(metadata).filter(key => !ALLOWED_FIELDS.has(key));

  if (extraFields.length > 0) {
    errors.push(
      `Unexpected fields in frontmatter: ${extraFields.sort().join(', ')}. ` +
      `Only ${[...ALLOWED_FIELDS].sort().join(', ')} are allowed.`
    );
  }

  return errors;
}

/**
 * Validate parsed skill metadata.
 *
 * This is the core validation function that works on already-parsed metadata,
 * avoiding duplicate file I/O when called from the parser.
 *
 * @param metadata - Parsed YAML frontmatter dictionary
 * @param skillDir - Optional path to skill directory (for name-directory match check)
 * @returns List of validation error messages. Empty list means valid.
 */
export function validateMetadata(
  metadata: Record<string, unknown>,
  skillDir?: string
): string[] {
  const errors: string[] = [];

  errors.push(...validateMetadataFields(metadata));

  if (!('name' in metadata)) {
    errors.push('Missing required field in frontmatter: name');
  } else {
    errors.push(...validateName(metadata.name, skillDir));
  }

  if (!('description' in metadata)) {
    errors.push('Missing required field in frontmatter: description');
  } else {
    errors.push(...validateDescription(metadata.description));
  }

  if ('compatibility' in metadata) {
    errors.push(...validateCompatibility(metadata.compatibility));
  }

  return errors;
}

/**
 * Validate a skill directory.
 *
 * @param skillDir - Path to the skill directory
 * @returns List of validation error messages. Empty list means valid.
 */
export function validate(skillDir: string): string[] {
  // Check path exists
  if (!fs.existsSync(skillDir)) {
    return [`Path does not exist: ${skillDir}`];
  }

  // Check it's a directory
  const stats = fs.statSync(skillDir);
  if (!stats.isDirectory()) {
    return [`Not a directory: ${skillDir}`];
  }

  // Find SKILL.md
  const skillMd = findSkillMd(skillDir);
  if (skillMd === null) {
    return ['Missing required file: SKILL.md'];
  }

  // Parse and validate
  try {
    const content = fs.readFileSync(skillMd, 'utf-8');
    const { data: metadata } = parseFrontmatter(content);
    return validateMetadata(metadata, skillDir);
  } catch (e) {
    if (e instanceof ParseError) {
      return [e.message];
    }
    throw e;
  }
}
