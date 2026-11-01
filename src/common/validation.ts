import { applyDecorators, ArgumentMetadata, Injectable, ValidationError, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ValidateBy, ValidateIf } from 'class-validator';
import { ApiError, validationFailed } from './api-error';

type RuleResult = { value: unknown } | { error: string };
type Rule = (v: unknown) => RuleResult;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{7,15}$/;

export const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export const normalizePhone = (s: string) => s.replace(/[\s\-()]/g, '');

/**
 * The checks behind every DTO field. Each returns the cleaned-up value (trimmed, lowercased...) or an
 * error that reads after the field name: "email" + "must be a valid email".
 */
export const rules = {
  text:
    ({ min = 0, max = 255, trim = true } = {}): Rule =>
    (v) => {
      if (typeof v !== 'string') return { error: 'must be a string' };
      const s = trim ? v.trim() : v;
      if (s.length < min) return { error: min === 1 ? 'must not be empty' : `must be at least ${min} characters` };
      if (s.length > max) return { error: `must be at most ${max} characters` };
      return { value: s };
    },

  password: (): Rule => (v) => {
    if (typeof v !== 'string') return { error: 'must be a string' };
    if (v.length < 8) return { error: 'must be at least 8 characters' };
    // bcrypt ignores everything after 72 bytes.
    if (Buffer.byteLength(v, 'utf8') > 72) return { error: 'is too long' };
    return { value: v };
  },

  email: (): Rule => (v) => {
    if (typeof v !== 'string') return { error: 'must be a string' };
    const s = v.trim().toLowerCase();
    if (s.length > 254 || !EMAIL_RE.test(s)) return { error: 'must be a valid email' };
    return { value: s };
  },

  phone: (): Rule => (v) => {
    if (typeof v !== 'string') return { error: 'must be a string' };
    const s = normalizePhone(v.trim());
    if (!PHONE_RE.test(s)) return { error: 'must be a valid phone number, e.g. +998901234567' };
    return { value: s };
  },

  username: (): Rule => (v) => {
    if (typeof v !== 'string') return { error: 'must be a string' };
    const s = v.trim().replace(/^@+/, '');
    if (!s) return { error: 'must not be empty' };
    if (s.length > 100) return { error: 'must be at most 100 characters' };
    return { value: s };
  },

  number:
    ({ min = -Infinity, max = Infinity, decimals }: { min?: number; max?: number; decimals?: number } = {}): Rule =>
    (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'must be a number' };
      if (v < min || v > max) return { error: `must be between ${min} and ${max}` };
      if (decimals !== undefined) {
        const scaled = v * 10 ** decimals;
        if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return { error: `must have at most ${decimals} decimal places` };
      }
      return { value: v };
    },

  integer:
    ({ min = -Infinity, max = Infinity } = {}): Rule =>
    (v) => {
      if (!Number.isSafeInteger(v)) return { error: 'must be an integer' };
      if ((v as number) < min || (v as number) > max) return { error: `must be between ${min} and ${max}` };
      return { value: v };
    },

  oneOf:
    (values: readonly string[]): Rule =>
    (v) =>
      values.includes(v as string) ? { value: v } : { error: `must be one of: ${values.join(', ')}` },

  stringList:
    ({ maxItems = 50, maxLength = 50 } = {}): Rule =>
    (v) => {
      if (!Array.isArray(v)) return { error: 'must be an array of strings' };
      if (v.length > maxItems) return { error: `must have at most ${maxItems} items` };
      const out: string[] = [];
      for (const item of v) {
        if (typeof item !== 'string' || !item.trim()) return { error: 'must contain only non-empty strings' };
        const s = item.trim();
        if (s.length > maxLength) return { error: `items must be at most ${maxLength} characters` };
        if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
      }
      return { value: out };
    },

  url: (): Rule => (v) => {
    if (typeof v !== 'string') return { error: 'must be a string' };
    const s = v.trim();
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      return { error: 'must be a valid URL' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || s.length > 2048) return { error: 'must be a valid http(s) URL' };
    return { value: s };
  },

  nonEmptyArray:
    ({ max = Infinity } = {}): Rule =>
    (v) => {
      if (!Array.isArray(v) || v.length === 0) return { error: 'must be a non-empty array' };
      if (v.length > max) return { error: `must have at most ${max} entries` };
      return { value: v };
    },
};

/**
 * Checks a DTO field with one of the rules above and stores the cleaned-up value.
 * A missing field fails with "is required" unless it is marked with Optional() or Nullable().
 */
export function Check(rule: Rule): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => {
      if (value === undefined || value === null) return value;
      const r = rule(value);
      return 'value' in r ? r.value : value;
    }),
    ValidateBy({
      name: 'check',
      validator: {
        validate: (value) => value !== undefined && 'value' in rule(value),
        defaultMessage: (args) => {
          if (args?.value === undefined) return 'is required';
          const r = rule(args.value);
          return 'error' in r ? r.error : 'is invalid';
        },
      },
    }),
  );
}

/** The field may be left out (but not set to null). */
export const Optional = () => ValidateIf((_, value) => value !== undefined);
/** The field may be left out or set to null. */
export const Nullable = () => ValidateIf((_, value) => value !== undefined && value !== null);

/** Turns class-validator's error tree into ["name must not be empty", "items[0].quantity is required"]. */
export function flattenErrors(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = /^\d+$/.test(e.property) ? `${parent}[${e.property}]` : parent ? `${parent}.${e.property}` : e.property;
    const first = e.constraints && Object.values(e.constraints)[0];
    if (first) return [`${path} ${first}`];
    return flattenErrors(e.children ?? [], path);
  });
}

/** Global pipe: validates DTOs, drops unknown fields, and reports every problem as `errors`. */
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => validationFailed(...flattenErrors(errors)),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type === 'body' && metadata.metatype && this.toValidate(metadata) && !isPlainObject(value)) {
      throw new ApiError(400, 'Request body must be a JSON object');
    }
    return super.transform(value, metadata);
  }
}
