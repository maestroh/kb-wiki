/**
 * Generate <available_skills> XML prompt block for agent system prompts.
 * Port of skills-ref/prompt.py
 */

import * as fs from 'fs';
import * as path from 'path';
import { findSkillMd, readProperties } from './parser';

/**
 * List script files in a skill's scripts directory.
 */
function listScripts(skillDir: string): string[] {
  const scriptsDir = path.join(skillDir, 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    return [];
  }

  try {
    return fs.readdirSync(scriptsDir).filter(name => {
      const fullPath = path.join(scriptsDir, name);
      return fs.statSync(fullPath).isFile() && (name.endsWith('.ts') || name.endsWith('.js'));
    });
  } catch {
    return [];
  }
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate the <available_skills> XML block for inclusion in agent prompts.
 *
 * This XML format is what Anthropic uses and recommends for Claude models.
 * Skill Clients may format skill information differently to suit their
 * models or preferences.
 *
 * @param skillDirs - List of paths to skill directories
 * @returns XML string with <available_skills> block containing each skill's
 *          name, description, and location.
 *
 * @example
 * ```typescript
 * const xml = toPrompt(['/path/to/pdf-reader', '/path/to/web-search']);
 * // Returns:
 * // <available_skills>
 * // <skill>
 * // <name>pdf-reader</name>
 * // <description>Read and extract text from PDF files</description>
 * // <location>/path/to/pdf-reader/SKILL.md</location>
 * // </skill>
 * // ...
 * // </available_skills>
 * ```
 */
export function toPrompt(skillDirs: string[]): string {
  if (skillDirs.length === 0) {
    return '<available_skills>\n</available_skills>';
  }

  const lines: string[] = ['<available_skills>'];

  for (const skillDir of skillDirs) {
    const resolvedPath = path.resolve(skillDir);
    const props = readProperties(resolvedPath);
    const scripts = listScripts(resolvedPath);

    lines.push('<skill>');
    lines.push('<name>');
    lines.push(escapeHtml(props.name));
    lines.push('</name>');
    lines.push('<description>');
    lines.push(escapeHtml(props.description));
    lines.push('</description>');

    // Include available scripts so the LLM knows exact script names
    if (scripts.length > 0) {
      lines.push('<scripts>');
      scripts.forEach(script => {
        lines.push(`<script>${escapeHtml(script)}</script>`);
      });
      lines.push('</scripts>');
    }

    const skillMdPath = findSkillMd(resolvedPath);
    lines.push('<location>');
    lines.push(skillMdPath || '');
    lines.push('</location>');

    lines.push('</skill>');
  }

  lines.push('</available_skills>');

  return lines.join('\n');
}

/**
 * Generate a compact single-line XML representation for a skill.
 * Useful for logging or debugging.
 *
 * @param skillDir - Path to the skill directory
 * @returns Single-line XML string for the skill
 */
export function toCompactPrompt(skillDir: string): string {
  const resolvedPath = path.resolve(skillDir);
  const props = readProperties(resolvedPath);
  const skillMdPath = findSkillMd(resolvedPath);

  return `<skill><name>${escapeHtml(props.name)}</name><description>${escapeHtml(props.description)}</description><location>${skillMdPath || ''}</location></skill>`;
}

/**
 * Generate instructions for how the agent should use skills.
 * This can be appended to the system prompt along with available_skills.
 *
 * @returns Instructions text for skill usage
 */
export function getSkillUsageInstructions(): string {
  return `
<skills_instructions>
You have access to skills that provide specialized capabilities. Each skill has one or more scripts you can execute.

## Skill Workflow: Activate Before Execute

Skills follow a two-step process:

### Step 1: Activate the Skill
Before executing a skill, read its full instructions to understand available arguments and usage:

read_skill_instructions(skill="gmail")

This returns the complete skill documentation including:
- Available scripts and their purposes
- Command-line arguments (e.g., --today, --date, --limit)
- Usage examples
- Output format

### Step 2: Execute with Proper Arguments
After reading the instructions, execute the script with the correct arguments:

execute_skill_script(skill="gmail", script="get-summary.ts", args=["--today"])

## Examples

To get emails from a specific date:
1. read_skill_instructions(skill="gmail") → Learn about --date argument
2. execute_skill_script(skill="gmail", script="get-summary.ts", args=["--date", "2026-01-21"])

To search the web:
1. read_skill_instructions(skill="web-search") → Learn about query format
2. execute_skill_script(skill="web-search", script="search.ts", args=["your search query"])

## Important Rules

1. **Always activate first**: Read skill instructions before executing, especially for unfamiliar skills
2. **Use exact script names**: Only use scripts listed in the skill's instructions
3. **Pass arguments correctly**: Arguments are an array of strings (e.g., ["--date", "2026-01-21"])
4. **Chain skills when needed**: Multiple skills can be used in sequence
5. **Summarize results**: Parse JSON output and summarize findings for the user
</skills_instructions>
`.trim();
}
