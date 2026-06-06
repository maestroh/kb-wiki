/**
 * SkillService - Main service coordinating skill discovery, loading, and prompt generation.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { LoadedSkill } from './models';
import { DiscoveryConfig, DiscoveredSkill, DiscoveryResult, discoverSkills, watchSkills } from './discovery';
import { loadSkill, loadReference, loadAsset, getScriptPath } from './loader';
import { toPrompt, getSkillUsageInstructions } from './prompt';
import { SkillExecutor, ExecutorConfig, ExecutionResult } from './executor';
import { ExecutionHistory, getExecutionHistory, SkillExecution } from './execution-history';
import logger from '../llm/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration for the SkillService.
 */
export interface SkillServiceConfig {
  /** Whether skills are enabled */
  enabled: boolean;

  /** Directories to scan for skills */
  paths: string[];

  /** Whether to watch for changes and hot-reload */
  watchForChanges?: boolean;

  /** Whether to skip invalid skills (default: true) */
  skipInvalid?: boolean;

  /** Script execution configuration */
  execution?: Partial<ExecutorConfig>;
}

/**
 * Default configuration for the SkillService.
 */
export const DEFAULT_SKILL_CONFIG: SkillServiceConfig = {
  enabled: true,
  paths: ['./skills'],
  watchForChanges: false,
  skipInvalid: true,
};

/**
 * Main service for managing skills.
 *
 * Coordinates skill discovery, loading, and prompt generation.
 * Provides a unified API for the agent to interact with skills.
 */
export class SkillService {
  private config: SkillServiceConfig;
  private skills: Map<string, DiscoveredSkill> = new Map();
  private loadedSkills: Map<string, LoadedSkill> = new Map();
  private stopWatching: (() => void) | null = null;
  private initialized: boolean = false;
  private executor: SkillExecutor;
  private history: ExecutionHistory;

  constructor(config: Partial<SkillServiceConfig> = {}) {
    this.config = { ...DEFAULT_SKILL_CONFIG, ...config };
    this.executor = new SkillExecutor(config.execution);
    this.history = getExecutionHistory();
  }

  /**
   * Initialize the service: discover skills and optionally start watching.
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Skills are disabled');
      this.initialized = true;
      return;
    }

    // Resolve paths relative to project root
    const resolvedPaths = this.config.paths.map(p => {
      if (path.isAbsolute(p)) {
        return p;
      }
      // Resolve relative to backend directory
      return path.resolve(__dirname, '../..', p);
    });

    const discoveryConfig: DiscoveryConfig = {
      skillsPaths: resolvedPaths,
      skipInvalid: this.config.skipInvalid,
    };

    // Initial discovery
    const result = discoverSkills(discoveryConfig);
    this.updateSkillsFromResult(result);

    // Start watching if enabled
    if (this.config.watchForChanges) {
      this.stopWatching = watchSkills(discoveryConfig, (newResult) => {
        this.updateSkillsFromResult(newResult);
        // Clear loaded skills cache on change
        this.loadedSkills.clear();
        logger.info('Skills reloaded due to file changes');
      });
    }

    this.initialized = true;

    logger.info('SkillService initialized', {
      enabled: this.config.enabled,
      skillCount: this.skills.size,
      paths: resolvedPaths,
      watching: this.config.watchForChanges,
    });
  }

  /**
   * Shutdown the service: stop watching for changes.
   */
  async shutdown(): Promise<void> {
    if (this.stopWatching) {
      this.stopWatching();
      this.stopWatching = null;
    }

    this.skills.clear();
    this.loadedSkills.clear();
    this.initialized = false;

    logger.info('SkillService shutdown');
  }

  /**
   * Update internal skill map from discovery result.
   */
  private updateSkillsFromResult(result: DiscoveryResult): void {
    this.skills.clear();

    for (const skill of result.skills) {
      this.skills.set(skill.name, skill);
    }
  }

  /**
   * Get all discovered skills (metadata only).
   */
  getAvailableSkills(): DiscoveredSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name (metadata only).
   */
  getSkill(name: string): DiscoveredSkill | null {
    return this.skills.get(name) || null;
  }

  /**
   * Check if a skill exists.
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Load full skill content (including body, scripts, references).
   * Results are cached.
   */
  loadSkill(name: string): LoadedSkill | null {
    const skill = this.skills.get(name);
    if (!skill) {
      return null;
    }

    // Check cache
    const cached = this.loadedSkills.get(name);
    if (cached) {
      return cached;
    }

    // Load and cache
    try {
      const loaded = loadSkill(skill.path);
      this.loadedSkills.set(name, loaded);
      return loaded;
    } catch (err) {
      logger.error(`Failed to load skill: ${name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Get full skill instructions (body content from SKILL.md).
   * This "activates" the skill by loading and returning its complete documentation.
   * Use this before executing a skill to understand available arguments and usage.
   *
   * @param name - Name of the skill to activate
   * @returns Object with skill name, description, body (full instructions), and available scripts
   */
  getSkillInstructions(name: string): {
    success: boolean;
    skill?: string;
    description?: string;
    instructions?: string;
    scripts?: string[];
    error?: string;
  } {
    const loaded = this.loadSkill(name);

    if (!loaded) {
      return {
        success: false,
        error: `Skill not found: ${name}. Available skills: ${Array.from(this.skills.keys()).join(', ')}`,
      };
    }

    return {
      success: true,
      skill: loaded.name,
      description: loaded.description,
      instructions: loaded.body,
      scripts: loaded.scripts,
    };
  }

  /**
   * Load a reference file from a skill.
   */
  loadReference(skillName: string, refName: string): string | null {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }

    try {
      return loadReference(skill.path, refName);
    } catch (err) {
      logger.warn(`Failed to load reference: ${skillName}/${refName}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Load an asset file from a skill.
   */
  loadAsset(skillName: string, assetName: string): Buffer | null {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }

    try {
      return loadAsset(skill.path, assetName);
    } catch (err) {
      logger.warn(`Failed to load asset: ${skillName}/${assetName}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Get the path to a script in a skill.
   */
  getScriptPath(skillName: string, scriptName: string): string | null {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }

    try {
      return getScriptPath(skill.path, scriptName);
    } catch (err) {
      return null;
    }
  }

  /**
   * Generate the <available_skills> XML block for inclusion in agent prompts.
   * Returns empty string if skills are disabled or none are available.
   */
  getAvailableSkillsPrompt(): string {
    if (!this.config.enabled || this.skills.size === 0) {
      return '';
    }

    const skillPaths = Array.from(this.skills.values()).map(s => s.path);
    return toPrompt(skillPaths);
  }

  /**
   * Get skill usage instructions for the agent.
   * Returns empty string if skills are disabled.
   */
  getSkillUsageInstructions(): string {
    if (!this.config.enabled || this.skills.size === 0) {
      return '';
    }

    return getSkillUsageInstructions();
  }

  /**
   * Get the complete skills prompt (available skills + usage instructions).
   */
  getFullSkillsPrompt(): string {
    if (!this.config.enabled || this.skills.size === 0) {
      return '';
    }

    const skillsXml = this.getAvailableSkillsPrompt();
    const instructions = this.getSkillUsageInstructions();

    return `${skillsXml}\n\n${instructions}`;
  }

  /**
   * Force refresh skills (re-scan directories).
   */
  async refresh(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Clear caches
    this.loadedSkills.clear();

    // Re-discover
    const resolvedPaths = this.config.paths.map(p => {
      if (path.isAbsolute(p)) {
        return p;
      }
      return path.resolve(__dirname, '../..', p);
    });

    const result = discoverSkills({
      skillsPaths: resolvedPaths,
      skipInvalid: this.config.skipInvalid,
    });

    this.updateSkillsFromResult(result);

    logger.info('Skills refreshed', { skillCount: this.skills.size });
  }

  /**
   * Check if the service is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if skills are enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the number of available skills.
   */
  getSkillCount(): number {
    return this.skills.size;
  }

  // =========================================================================
  // Script Execution (Phase 3)
  // =========================================================================

  /**
   * Execute a script from a skill.
   *
   * @param skillName - Name of the skill
   * @param scriptName - Name of the script file in scripts/
   * @param args - Arguments to pass to the script
   * @returns Execution result
   */
  async executeScript(
    skillName: string,
    scriptName: string,
    args: string[] = []
  ): Promise<ExecutionResult> {
    logger.info('[SkillService] executeScript called', {
      skillName,
      scriptName,
      args,
    });

    const skill = this.skills.get(skillName);

    if (!skill) {
      logger.error('[SkillService] Skill not found', {
        skillName,
        availableSkills: Array.from(this.skills.keys()),
      });

      const failedResult: ExecutionResult = {
        success: false,
        stdout: '',
        stderr: `Skill not found: ${skillName}`,
        exitCode: 1,
        signal: null,
        executionTime: 0,
        timedOut: false,
        truncated: false,
      };

      // Record failed execution
      this.history.record(skillName, scriptName, args, failedResult);

      return failedResult;
    }

    logger.info('[SkillService] Executing skill script', {
      skillName,
      skillPath: skill.path,
      scriptName,
      args,
    });

    const result = await this.executor.execute(skill.path, scriptName, args);

    logger.info('[SkillService] Script execution result', {
      skillName,
      scriptName,
      success: result.success,
      exitCode: result.exitCode,
      executionTime: result.executionTime,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
      stdoutPreview: result.stdout.substring(0, 300),
      stderrPreview: result.stderr.substring(0, 300),
    });

    // Record execution in history (also logs with full details)
    this.history.record(skillName, scriptName, args, result);

    return result;
  }

  /**
   * Get recent skill executions.
   */
  getExecutionHistory(limit: number = 20): SkillExecution[] {
    return this.history.getRecent(limit);
  }

  /**
   * Get execution statistics.
   */
  getExecutionStats() {
    return this.history.getStats();
  }

  /**
   * Get the executor configuration.
   */
  getExecutorConfig(): ExecutorConfig {
    return this.executor.getConfig();
  }

  /**
   * Update the executor configuration.
   */
  updateExecutorConfig(config: Partial<ExecutorConfig>): void {
    this.executor.updateConfig(config);
  }

  /**
   * Set a provider function for additional environment variables
   * to be injected into skill script child processes.
   * Used for Google OAuth token injection.
   */
  setAdditionalEnvProvider(fn: () => Promise<Record<string, string>>): void {
    this.executor.setAdditionalEnvProvider(fn);
  }
}

// Singleton instance
let skillServiceInstance: SkillService | null = null;

/**
 * Get the singleton SkillService instance.
 */
export function getSkillService(): SkillService {
  if (!skillServiceInstance) {
    skillServiceInstance = new SkillService();
  }
  return skillServiceInstance;
}

/**
 * Initialize the singleton SkillService with custom config.
 */
export async function initializeSkillService(
  config: Partial<SkillServiceConfig> = {}
): Promise<SkillService> {
  skillServiceInstance = new SkillService(config);
  await skillServiceInstance.initialize();
  return skillServiceInstance;
}
