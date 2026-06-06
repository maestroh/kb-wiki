/**
 * Skill-related exceptions.
 * Port of skills-ref/errors.py
 */

/**
 * Base exception for all skill-related errors.
 */
export class SkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillError';
    Object.setPrototypeOf(this, SkillError.prototype);
  }
}

/**
 * Raised when SKILL.md parsing fails.
 */
export class ParseError extends SkillError {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

/**
 * Raised when skill properties are invalid.
 */
export class ValidationError extends SkillError {
  /** List of validation error messages */
  errors: string[];

  constructor(message: string, errors?: string[]) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors ?? [message];
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
