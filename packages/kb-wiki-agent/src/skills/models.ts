/**
 * Data models for Agent Skills.
 * Port of skills-ref/models.py
 */

/**
 * Properties parsed from a skill's SKILL.md frontmatter.
 */
export interface SkillProperties {
  /** Skill name in kebab-case (required, 1-64 chars) */
  name: string;

  /** What the skill does and when the model should use it (required, 1-1024 chars) */
  description: string;

  /** License for the skill (optional) */
  license?: string;

  /** Compatibility information - environment requirements, system packages, network access (optional, 1-500 chars) */
  compatibility?: string;

  /** Tool patterns the skill requires, space-delimited (optional, experimental) */
  allowedTools?: string;

  /** Key-value pairs for client-specific properties (optional) */
  metadata?: Record<string, string>;
}

/**
 * A fully loaded skill including body content and available resources.
 */
export interface LoadedSkill extends SkillProperties {
  /** Absolute path to the skill directory */
  path: string;

  /** Path to the SKILL.md file */
  skillMdPath: string;

  /** Markdown body content (instructions) */
  body: string;

  /** Available script files in scripts/ directory */
  scripts: string[];

  /** Available reference files in references/ directory */
  references: string[];

  /** Available asset files in assets/ directory */
  assets: string[];
}

/**
 * Convert SkillProperties to a plain object, excluding undefined values.
 * Mirrors Python's to_dict() method.
 */
export function skillPropertiesToDict(props: SkillProperties): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: props.name,
    description: props.description,
  };

  if (props.license !== undefined) {
    result.license = props.license;
  }

  if (props.compatibility !== undefined) {
    result.compatibility = props.compatibility;
  }

  if (props.allowedTools !== undefined) {
    result['allowed-tools'] = props.allowedTools;
  }

  if (props.metadata && Object.keys(props.metadata).length > 0) {
    result.metadata = props.metadata;
  }

  return result;
}
