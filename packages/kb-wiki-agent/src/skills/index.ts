/**
 * Agent Skills module for Willikins.
 *
 * Implements the Agent Skills specification (https://agentskills.io)
 * for extensible agent capabilities.
 *
 * @example
 * ```typescript
 * // Using the SkillService (recommended)
 * import { initializeSkillService, getSkillService } from './skills';
 *
 * // Initialize at startup
 * await initializeSkillService({
 *   enabled: true,
 *   paths: ['./skills'],
 * });
 *
 * // Get the service
 * const skillService = getSkillService();
 *
 * // Get skills prompt for agent
 * const prompt = skillService.getFullSkillsPrompt();
 *
 * // Load a specific skill
 * const skill = skillService.loadSkill('web-search');
 * ```
 *
 * @example
 * ```typescript
 * // Using low-level functions directly
 * import { validate, readProperties, toPrompt } from './skills';
 *
 * // Validate a skill directory
 * const errors = validate('/path/to/my-skill');
 *
 * // Read skill properties
 * const props = readProperties('/path/to/my-skill');
 *
 * // Generate prompt XML
 * const xml = toPrompt(['/path/to/skill-a', '/path/to/skill-b']);
 * ```
 */

// ============================================================================
// Models
// ============================================================================
export type { SkillProperties, LoadedSkill } from './models';
export { skillPropertiesToDict } from './models';

// ============================================================================
// Errors
// ============================================================================
export { SkillError, ParseError, ValidationError } from './errors';

// ============================================================================
// Parser (Phase 1)
// ============================================================================
export {
  findSkillMd,
  parseFrontmatter,
  readProperties,
  readSkillContent,
} from './parser';
export type { ParsedFrontmatter } from './parser';

// ============================================================================
// Validator (Phase 1)
// ============================================================================
export {
  validate,
  validateMetadata,
  MAX_SKILL_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_COMPATIBILITY_LENGTH,
  ALLOWED_FIELDS,
} from './validator';

// ============================================================================
// Prompt Generation (Phase 1)
// ============================================================================
export {
  toPrompt,
  toCompactPrompt,
  getSkillUsageInstructions,
} from './prompt';

// ============================================================================
// Discovery (Phase 2)
// ============================================================================
export {
  discoverSkills,
  watchSkills,
} from './discovery';
export type {
  DiscoveryConfig,
  DiscoveredSkill,
  DiscoveryResult,
} from './discovery';

// ============================================================================
// Loader (Phase 2)
// ============================================================================
export {
  loadSkill,
  loadReference,
  loadAsset,
  getScriptPath,
  hasScript,
  hasReference,
} from './loader';

// ============================================================================
// Executor (Phase 3)
// ============================================================================
export {
  executeScript,
  SkillExecutor,
  DEFAULT_EXECUTOR_CONFIG,
} from './executor';
export type {
  ExecutorConfig,
  ExecutionResult,
} from './executor';

// ============================================================================
// SkillService (Phase 2 + 3)
// ============================================================================
export {
  SkillService,
  getSkillService,
  initializeSkillService,
  DEFAULT_SKILL_CONFIG,
} from './SkillService';
export type { SkillServiceConfig } from './SkillService';

// ============================================================================
// Execution History (Observability)
// ============================================================================
export {
  ExecutionHistory,
  getExecutionHistory,
  initializeExecutionHistory,
} from './execution-history';
export type {
  SkillExecution,
  ExecutionHistoryConfig,
} from './execution-history';
