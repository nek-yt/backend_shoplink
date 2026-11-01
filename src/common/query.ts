import { Injectable, PipeTransform } from '@nestjs/common';
import { ApiError } from './api-error';
import { MAX_ID } from './constants';

// Query-string helpers. They return undefined when the parameter is absent.
export type Query = Record<string, unknown>;

export function queryString(query: Query, key: string): string | undefined {
  const v = query[key];
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string') throw new ApiError(400, `Query parameter ${key} must be a single value`);
  return v.trim();
}

export function queryNumber(
  query: Query,
  key: string,
  { min = -Infinity, max = Infinity, integer = false } = {},
): number | undefined {
  const s = queryString(query, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) {
    throw new ApiError(400, `Query parameter ${key} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return n;
}

export function queryBoolean(query: Query, key: string): boolean | undefined {
  const s = queryString(query, key);
  if (s === undefined) return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  throw new ApiError(400, `Query parameter ${key} must be true or false`);
}

export function queryEnum<T extends string>(query: Query, key: string, values: readonly T[]): T | undefined {
  const s = queryString(query, key);
  if (s === undefined) return undefined;
  if (!values.includes(s as T)) throw new ApiError(400, `Query parameter ${key} must be one of: ${values.join(', ')}`);
  return s as T;
}

export function queryPage(query: Query) {
  return {
    page: queryNumber(query, 'page', { min: 1, integer: true }) ?? 1,
    limit: queryNumber(query, 'limit', { min: 1, max: 100, integer: true }) ?? 20,
  };
}

export function paginate(total: number, page: number, limit: number) {
  return { total, page, limit, pages: Math.ceil(total / limit) };
}

/** `:id` route parameter → a valid database id, or 400 "Invalid id". */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(raw: string): number {
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1 || n > MAX_ID) throw new ApiError(400, 'Invalid id');
    return n;
  }
}
