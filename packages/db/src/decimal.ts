import { Prisma } from '../generated/client/index.js';

/**
 * Money helpers.
 *
 * Prisma returns `Decimal` for numeric columns. Serialising one straight to
 * JSON yields an object, not a number, which silently breaks every arithmetic
 * operation in the frontend. Every API response therefore passes money through
 * `decimalToNumber` on the way out and `numberToDecimal` on the way in.
 */

export type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export function decimalToNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** Same as {@link decimalToNumber} but returns 0 instead of null. */
export function decimalToNumberOrZero(value: DecimalLike): number {
  return decimalToNumber(value) ?? 0;
}

export function numberToDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  return new Prisma.Decimal(value);
}

/** Sum a column of Decimals without floating-point drift. */
export function sumDecimals(values: DecimalLike[]): number {
  return values
    .reduce<Prisma.Decimal>((acc, v) => {
      if (v === null || v === undefined) return acc;
      return acc.add(new Prisma.Decimal(v.toString()));
    }, new Prisma.Decimal(0))
    .toNumber();
}
