/**
 * Skill script executor with sandboxing.
 *
 * Executes scripts from skills in a controlled environment with:
 * - Timeout limits
 * - Environment variable filtering
 * - Working directory isolation
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import logger from '../llm/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration for script execution.
 */
export interface ExecutorConfig {
  /** Maximum execution time in milliseconds (default: 30000) */
  timeout: number;

  /** Allow scripts to access network (default: true) */
  allowNetwork: boolean;

  /** Environment variables scripts can access */
  allowedEnv: string[];

  /** Maximum output size in bytes (default: 1MB) */
  maxOutputSize: number;
}

/**
 * Default executor configuration.
 */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  timeout: 30000,
  allowNetwork: true,
  allowedEnv: ['HOME', 'PATH', 'NODE_ENV', 'LANG', 'LC_ALL'],
  maxOutputSize: 1024 * 1024, // 1MB
};

/**
 * Result of script execution.
 */
export interface ExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;

  /** Combined stdout output */
  stdout: string;

  /** Combined stderr output */
  stderr: string;

  /** Exit code (null if killed by signal) */
  exitCode: number | null;

  /** Signal that killed the process (if any) */
  signal: string | null;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Whether execution was terminated due to timeout */
  timedOut: boolean;

  /** Whether output was truncated due to size limit */
  truncated: boolean;
}

/**
 * Supported script types and their interpreters.
 */
const SCRIPT_INTERPRETERS: Record<string, string[]> = {
  '.ts': ['npx', 'tsx'],
  '.js': ['node'],
  '.py': ['python3'],
  '.sh': ['bash'],
  '.bash': ['bash'],
};

/**
 * Path to compiled skills directory (relative to backend root).
 */
const SKILLS_COMPILED_DIR = path.join(__dirname, '../../skills-compiled');

/**
 * Resolve a TypeScript script to its compiled JavaScript version if available.
 * Returns the compiled .js path if it exists, otherwise returns the original path.
 */
function resolveCompiledScript(scriptPath: string): { path: string; useNode: boolean } {
  const ext = path.extname(scriptPath).toLowerCase();

  // Only process TypeScript files
  if (ext !== '.ts') {
    return { path: scriptPath, useNode: false };
  }

  // Extract the relative path within skills directory
  // scriptPath: /app/skills/gmail/scripts/fetch-emails.ts
  // We need: gmail/scripts/fetch-emails.js
  const skillsMatch = scriptPath.match(/skills[/\\](.+)\.ts$/);
  if (!skillsMatch) {
    return { path: scriptPath, useNode: false };
  }

  const relativePath = skillsMatch[1] + '.js';
  const compiledPath = path.join(SKILLS_COMPILED_DIR, relativePath);

  logger.debug('[SkillExecutor] Checking for compiled script', {
    originalPath: scriptPath,
    compiledPath,
    exists: fs.existsSync(compiledPath),
  });

  if (fs.existsSync(compiledPath)) {
    logger.info('[SkillExecutor] Using pre-compiled JavaScript version', {
      originalPath: scriptPath,
      compiledPath,
    });
    return { path: compiledPath, useNode: true };
  }

  return { path: scriptPath, useNode: false };
}

/**
 * Get the interpreter for a script based on extension.
 */
function getInterpreter(scriptPath: string, useNode: boolean = false): string[] | null {
  // If we're using a pre-compiled script, always use node
  if (useNode) {
    return ['node'];
  }

  const ext = path.extname(scriptPath).toLowerCase();
  return SCRIPT_INTERPRETERS[ext] || null;
}

/**
 * Filter environment variables to only allowed ones.
 */
function filterEnv(allowedEnv: string[]): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const key of allowedEnv) {
    if (process.env[key] !== undefined) {
      filtered[key] = process.env[key]!;
    }
  }

  return filtered;
}

/**
 * Execute a script with sandboxing.
 *
 * @param scriptPath - Absolute path to the script file
 * @param args - Arguments to pass to the script
 * @param config - Executor configuration
 * @param workingDir - Working directory for the script (defaults to script's directory)
 * @param additionalEnv - Extra environment variables to merge (e.g., Google OAuth tokens)
 * @returns Execution result
 */
export async function executeScript(
  scriptPath: string,
  args: string[] = [],
  config: Partial<ExecutorConfig> = {},
  workingDir?: string,
  additionalEnv?: Record<string, string>
): Promise<ExecutionResult> {
  const fullConfig = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  const startTime = Date.now();

  // Validate script exists
  if (!fs.existsSync(scriptPath)) {
    return {
      success: false,
      stdout: '',
      stderr: `Script not found: ${scriptPath}`,
      exitCode: 1,
      signal: null,
      executionTime: 0,
      timedOut: false,
      truncated: false,
    };
  }

  // Resolve to compiled script if available (saves memory in production)
  const { path: resolvedPath, useNode } = resolveCompiledScript(scriptPath);

  // Get interpreter
  const interpreter = getInterpreter(resolvedPath, useNode);
  if (!interpreter) {
    return {
      success: false,
      stdout: '',
      stderr: `Unsupported script type: ${path.extname(resolvedPath)}`,
      exitCode: 1,
      signal: null,
      executionTime: 0,
      timedOut: false,
      truncated: false,
    };
  }

  // Build command
  const command = interpreter[0];
  const commandArgs = [...interpreter.slice(1), resolvedPath, ...args];
  const cwd = workingDir || path.dirname(scriptPath);

  // Filter environment and merge additional env vars
  const env = { ...filterEnv(fullConfig.allowedEnv), ...additionalEnv };

  logger.info('[SkillExecutor] Executing script', {
    scriptPath,
    command,
    args: commandArgs,
    cwd,
    timeout: fullConfig.timeout,
    envKeys: Object.keys(env),
  });

  return new Promise<ExecutionResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let truncated = false;
    let child: ChildProcess;

    try {
      child = spawn(command, commandArgs, {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const executionTime = Date.now() - startTime;
      resolve({
        success: false,
        stdout: '',
        stderr: `Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: 1,
        signal: null,
        executionTime,
        timedOut: false,
        truncated: false,
      });
      return;
    }

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, fullConfig.timeout);

    // Collect stdout
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length + chunk.length <= fullConfig.maxOutputSize) {
        stdout += chunk;
      } else {
        truncated = true;
        const remaining = fullConfig.maxOutputSize - stdout.length;
        if (remaining > 0) {
          stdout += chunk.slice(0, remaining);
        }
      }
    });

    // Collect stderr
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length <= fullConfig.maxOutputSize) {
        stderr += chunk;
      } else {
        truncated = true;
        const remaining = fullConfig.maxOutputSize - stderr.length;
        if (remaining > 0) {
          stderr += chunk.slice(0, remaining);
        }
      }
    });

    // Handle completion
    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      const executionTime = Date.now() - startTime;

      const success = code === 0 && !timedOut;

      logger.info('[SkillExecutor] Script execution completed', {
        scriptPath,
        success,
        exitCode: code,
        signal,
        executionTime,
        timedOut,
        truncated,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        stderrPreview: stderr ? stderr.substring(0, 200) : '',
      });

      resolve({
        success,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        signal: signal as string | null,
        executionTime,
        timedOut,
        truncated,
      });
    });

    // Handle errors
    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const executionTime = Date.now() - startTime;

      logger.error('Script execution error', {
        scriptPath,
        error: err.message,
      });

      resolve({
        success: false,
        stdout: stdout.trim(),
        stderr: `Execution error: ${err.message}\n${stderr}`.trim(),
        exitCode: 1,
        signal: null,
        executionTime,
        timedOut: false,
        truncated,
      });
    });
  });
}

/**
 * Skill Executor class for managing script execution.
 */
export class SkillExecutor {
  private config: ExecutorConfig;
  private additionalEnvProvider?: () => Promise<Record<string, string>>;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  /**
   * Set a provider function that returns additional env vars for child processes.
   * Used for injecting Google OAuth tokens into skill scripts.
   */
  setAdditionalEnvProvider(fn: () => Promise<Record<string, string>>): void {
    this.additionalEnvProvider = fn;
  }

  /**
   * Execute a script from a skill.
   *
   * @param skillPath - Path to the skill directory
   * @param scriptName - Name of the script file in scripts/
   * @param args - Arguments to pass to the script
   * @returns Execution result
   */
  async execute(
    skillPath: string,
    scriptName: string,
    args: string[] = []
  ): Promise<ExecutionResult> {
    const scriptFullPath = path.join(skillPath, 'scripts', scriptName);

    // Check script exists
    if (!fs.existsSync(scriptFullPath)) {
      return {
        success: false,
        stdout: '',
        stderr: `Script not found: ${scriptName} in skill at ${skillPath}`,
        exitCode: 1,
        signal: null,
        executionTime: 0,
        timedOut: false,
        truncated: false,
      };
    }

    // Resolve additional env vars (e.g., Google OAuth tokens)
    let additionalEnv: Record<string, string> | undefined;
    if (this.additionalEnvProvider) {
      try {
        additionalEnv = await this.additionalEnvProvider();
      } catch (err) {
        logger.warn('[SkillExecutor] Failed to get additional env vars', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return executeScript(scriptFullPath, args, this.config, skillPath, additionalEnv);
  }

  /**
   * Update executor configuration.
   */
  updateConfig(config: Partial<ExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): ExecutorConfig {
    return { ...this.config };
  }
}
