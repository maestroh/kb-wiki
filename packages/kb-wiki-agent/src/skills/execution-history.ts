/**
 * Skill Execution History - Tracks recent skill executions for observability.
 *
 * Stores the last N executions in memory for debugging and monitoring.
 */

import { ExecutionResult } from './executor';
import logger from '../llm/logger';

/**
 * A recorded skill execution with full context.
 */
export interface SkillExecution {
  /** Unique execution ID */
  id: string;

  /** When the execution started */
  timestamp: string;

  /** Skill name */
  skill: string;

  /** Script name */
  script: string;

  /** Arguments passed to the script */
  args: string[];

  /** Whether execution succeeded */
  success: boolean;

  /** Exit code */
  exitCode: number | null;

  /** Execution duration in milliseconds */
  duration: number;

  /** Script stdout (may be truncated) */
  stdout: string;

  /** Script stderr (may be truncated) */
  stderr: string;

  /** Whether the script timed out */
  timedOut: boolean;

  /** Whether output was truncated */
  truncated: boolean;
}

/**
 * Configuration for execution history.
 */
export interface ExecutionHistoryConfig {
  /** Maximum number of executions to keep (default: 100) */
  maxEntries: number;

  /** Maximum stdout/stderr length to store per execution (default: 10000) */
  maxOutputLength: number;
}

const DEFAULT_CONFIG: ExecutionHistoryConfig = {
  maxEntries: 100,
  maxOutputLength: 10000,
};

/**
 * In-memory storage for recent skill executions.
 */
export class ExecutionHistory {
  private executions: SkillExecution[] = [];
  private config: ExecutionHistoryConfig;
  private executionCounter = 0;

  constructor(config: Partial<ExecutionHistoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a skill execution.
   */
  record(
    skill: string,
    script: string,
    args: string[],
    result: ExecutionResult
  ): SkillExecution {
    this.executionCounter++;
    const id = `exec_${Date.now()}_${this.executionCounter}`;

    const execution: SkillExecution = {
      id,
      timestamp: new Date().toISOString(),
      skill,
      script,
      args,
      success: result.success,
      exitCode: result.exitCode,
      duration: result.executionTime,
      stdout: this.truncateOutput(result.stdout),
      stderr: this.truncateOutput(result.stderr),
      timedOut: result.timedOut,
      truncated: result.truncated,
    };

    // Add to front of array (most recent first)
    this.executions.unshift(execution);

    // Trim if over max entries
    if (this.executions.length > this.config.maxEntries) {
      this.executions = this.executions.slice(0, this.config.maxEntries);
    }

    // Log with full details for console observability
    this.logExecution(execution);

    return execution;
  }

  /**
   * Get recent executions.
   */
  getRecent(limit: number = 20): SkillExecution[] {
    return this.executions.slice(0, limit);
  }

  /**
   * Get a specific execution by ID.
   */
  get(id: string): SkillExecution | undefined {
    return this.executions.find((e) => e.id === id);
  }

  /**
   * Get executions for a specific skill.
   */
  getBySkill(skill: string, limit: number = 20): SkillExecution[] {
    return this.executions.filter((e) => e.skill === skill).slice(0, limit);
  }

  /**
   * Get execution statistics.
   */
  getStats(): {
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
    bySkill: Record<string, { count: number; successRate: number }>;
  } {
    const total = this.executions.length;
    const successful = this.executions.filter((e) => e.success).length;
    const failed = total - successful;
    const avgDuration =
      total > 0
        ? this.executions.reduce((sum, e) => sum + e.duration, 0) / total
        : 0;

    // Group by skill
    const bySkill: Record<string, { count: number; successRate: number }> = {};
    for (const exec of this.executions) {
      if (!bySkill[exec.skill]) {
        bySkill[exec.skill] = { count: 0, successRate: 0 };
      }
      bySkill[exec.skill].count++;
    }

    // Calculate success rates
    for (const skill of Object.keys(bySkill)) {
      const skillExecs = this.executions.filter((e) => e.skill === skill);
      const skillSuccess = skillExecs.filter((e) => e.success).length;
      bySkill[skill].successRate =
        skillExecs.length > 0 ? skillSuccess / skillExecs.length : 0;
    }

    return { total, successful, failed, avgDuration, bySkill };
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.executions = [];
    logger.info('Skill execution history cleared');
  }

  /**
   * Truncate output to configured max length.
   */
  private truncateOutput(output: string): string {
    if (output.length <= this.config.maxOutputLength) {
      return output;
    }
    return (
      output.slice(0, this.config.maxOutputLength) +
      `\n... [truncated, ${output.length - this.config.maxOutputLength} more bytes]`
    );
  }

  /**
   * Log execution with full details for console observability.
   */
  private logExecution(execution: SkillExecution): void {
    const status = execution.success ? 'SUCCESS' : 'FAILED';
    const outputPreview = execution.stdout
      ? execution.stdout.slice(0, 200).replace(/\n/g, ' ')
      : '(no output)';

    logger.info(`Skill execution [${status}]: ${execution.skill}/${execution.script}`, {
      id: execution.id,
      args: execution.args,
      duration: `${execution.duration}ms`,
      exitCode: execution.exitCode,
      timedOut: execution.timedOut,
      outputPreview:
        outputPreview.length < execution.stdout.length
          ? outputPreview + '...'
          : outputPreview,
    });

    // Log full output at debug level
    if (execution.stdout) {
      logger.debug(`Skill stdout [${execution.id}]:`, {
        stdout: execution.stdout,
      });
    }

    if (execution.stderr) {
      logger.warn(`Skill stderr [${execution.id}]:`, {
        stderr: execution.stderr,
      });
    }
  }
}

// Singleton instance
let historyInstance: ExecutionHistory | null = null;

/**
 * Get the singleton ExecutionHistory instance.
 */
export function getExecutionHistory(): ExecutionHistory {
  if (!historyInstance) {
    historyInstance = new ExecutionHistory();
  }
  return historyInstance;
}

/**
 * Initialize the singleton with custom config.
 */
export function initializeExecutionHistory(
  config: Partial<ExecutionHistoryConfig> = {}
): ExecutionHistory {
  historyInstance = new ExecutionHistory(config);
  return historyInstance;
}
