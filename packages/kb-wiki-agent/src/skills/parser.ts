/**
 * YAML frontmatter parsing for SKILL.md files.
 * Port of skills-ref/parser.py
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SkillProperties } from './models';
import { ParseError, ValidationError } from './errors';

/**
 * Find the SKILL.md file in a skill directory.
 * Prefers SKILL.md (uppercase) but accepts skill.md (lowercase).
 *
 * @param skillDir - Path to the skill directory
 * @returns Path to the SKILL.md file, or null if not found
 */
export function findSkillMd(skillDir: string): string | null {
  for (const name of ['SKILL.md', 'skill.md']) {
    const filePath = path.join(skillDir, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Parse result from frontmatter extraction.
 */
export interface ParsedFrontmatter {
  /** Parsed YAML data as a dictionary */
  data: Record<string, unknown>;
  /** Markdown body content after frontmatter */
  body: string;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 *
 * @param content - Raw content of SKILL.md file
 * @returns Tuple of parsed metadata dict and markdown body
 * @throws ParseError if frontmatter is missing or invalid
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---')) {
    throw new ParseError('SKILL.md must start with YAML frontmatter (---)');
  }

  const parts = content.split('---');
  if (parts.length < 3) {
    throw new ParseError('SKILL.md frontmatter not properly closed with ---');
  }

  // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2+] is body
  const frontmatterStr = parts[1];
  const body = parts.slice(2).join('---').trim();

  let data: unknown;
  try {
    data = yaml.load(frontmatterStr);
  } catch (e) {
    throw new ParseError(`Invalid YAML in frontmatter: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ParseError('SKILL.md frontmatter must be a YAML mapping');
  }

  const metadata = data as Record<string, unknown>;

  // Ensure metadata values are strings
  if (metadata.metadata && typeof metadata.metadata === 'object' && !Array.isArray(metadata.metadata)) {
    const metaObj = metadata.metadata as Record<string, unknown>;
    metadata.metadata = Object.fromEntries(
      Object.entries(metaObj).map(([k, v]) => [String(k), String(v)])
    );
  }

  return { data: metadata, body };
}

/**
 * Read skill properties from SKILL.md frontmatter.
 *
 * This function parses the frontmatter and returns properties.
 * It does NOT perform full validation. Use validate() for that.
 *
 * @param skillDir - Path to the skill directory
 * @returns SkillProperties with parsed metadata
 * @throws ParseError if SKILL.md is missing or has invalid YAML
 * @throws ValidationError if required fields (name, description) are missing
 */
export function readProperties(skillDir: string): SkillProperties {
  const skillMd = findSkillMd(skillDir);

  if (skillMd === null) {
    throw new ParseError(`SKILL.md not found in ${skillDir}`);
  }

  const content = fs.readFileSync(skillMd, 'utf-8');
  const { data: metadata } = parseFrontmatter(content);

  if (!('name' in metadata)) {
    throw new ValidationError('Missing required field in frontmatter: name');
  }

  if (!('description' in metadata)) {
    throw new ValidationError('Missing required field in frontmatter: description');
  }

  const name = metadata.name;
  const description = metadata.description;

  if (typeof name !== 'string' || !name.trim()) {
    throw new ValidationError("Field 'name' must be a non-empty string");
  }

  if (typeof description !== 'string' || !description.trim()) {
    throw new ValidationError("Field 'description' must be a non-empty string");
  }

  return {
    name: name.trim(),
    description: description.trim(),
    license: typeof metadata.license === 'string' ? metadata.license : undefined,
    compatibility: typeof metadata.compatibility === 'string' ? metadata.compatibility : undefined,
    allowedTools: typeof metadata['allowed-tools'] === 'string' ? metadata['allowed-tools'] : undefined,
    metadata: metadata.metadata as Record<string, string> | undefined,
  };
}

/**
 * Read full skill content including body.
 *
 * @param skillDir - Path to the skill directory
 * @returns Object with properties and body content
 * @throws ParseError if SKILL.md is missing or has invalid YAML
 * @throws ValidationError if required fields are missing
 */
export function readSkillContent(skillDir: string): { properties: SkillProperties; body: string } {
  const skillMd = findSkillMd(skillDir);

  if (skillMd === null) {
    throw new ParseError(`SKILL.md not found in ${skillDir}`);
  }

  const content = fs.readFileSync(skillMd, 'utf-8');
  const { data: metadata, body } = parseFrontmatter(content);

  if (!('name' in metadata)) {
    throw new ValidationError('Missing required field in frontmatter: name');
  }

  if (!('description' in metadata)) {
    throw new ValidationError('Missing required field in frontmatter: description');
  }

  const name = metadata.name;
  const description = metadata.description;

  if (typeof name !== 'string' || !name.trim()) {
    throw new ValidationError("Field 'name' must be a non-empty string");
  }

  if (typeof description !== 'string' || !description.trim()) {
    throw new ValidationError("Field 'description' must be a non-empty string");
  }

  const properties: SkillProperties = {
    name: name.trim(),
    description: description.trim(),
    license: typeof metadata.license === 'string' ? metadata.license : undefined,
    compatibility: typeof metadata.compatibility === 'string' ? metadata.compatibility : undefined,
    allowedTools: typeof metadata['allowed-tools'] === 'string' ? metadata['allowed-tools'] : undefined,
    metadata: metadata.metadata as Record<string, string> | undefined,
  };

  return { properties, body };
}
