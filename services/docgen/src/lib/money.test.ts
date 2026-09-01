/**
 * Quotation arithmetic.
 *
 * These numbers go to a customer on a printed document, so the coverage here
 * is about rounding and Indian numbering conventions rather than happy paths.
 */

import { describe, expect, it } from 'vitest';
import { amountInWords, computeLineAmount, computeTotals, formatIndian } from './money.js';

describe('computeLineAmount', () => {
  it('multiplies quantity by rate', () => {
    expect(computeLineAmount(100, 585)).toBe(58_500);
  });

  it('rounds to paise rather than accumulating float error', () => {
    // 0.1 * 3 is 0.30000000000000004 in IEEE754.
    expect(computeLineAmount(3, 0.1)).toBe(0.3);
  });

  it('handles fractional quantities', () => {
    expect(computeLineAmount(2.5, 620)).toBe(1550);
  });
});

describe('computeTotals', () => {
  const items = [
    { description: '6 Sut', quantity: 100, unit: 'kg', pricePerUnit: 680 },
    { description: '5 Sut', quantity: 200, unit: 'kg', pricePerUnit: 585 },
  ];

  it('sums line amounts into a subtotal', () => {
    const totals = computeTotals(items, { taxPercent: 5, freight: 0 });
    expect(totals.subtotal).toBe(68_000 + 117_000);
    expect(totals.items[0]!.amount).toBe(68_000);
  });

  it('applies GST to the subtotal', () => {
    const totals = computeTotals(items, { taxPercent: 5, freight: 0 });
    expect(totals.taxAmount).toBe(9_250);
    expect(totals.grandTotal).toBe(185_000 + 9_250);
  });

  it('adds freight after tax, not before', () => {
    const totals = computeTotals(items, { taxPercent: 5, freight: 2_000 });
    // Freight is not taxed here; taxing it would change the number.
    expect(totals.taxAmount).toBe(9_250);
    expect(totals.grandTotal).toBe(185_000 + 9_250 + 2_000);
  });

  it('handles zero tax', () => {
    const totals = computeTotals(items, { taxPercent: 0, freight: 0 });
    expect(totals.taxAmount).toBe(0);
    expect(totals.grandTotal).toBe(totals.subtotal);
  });

  it('rounds tax to paise', () => {
    const totals = computeTotals(
      [{ description: 'x', quantity: 1, unit: 'kg', pricePerUnit: 33.33 }],
      { taxPercent: 5, freight: 0 },
    );
    expect(totals.taxAmount).toBe(1.67);
    expect(totals.grandTotal).toBe(35);
  });

  it('rejects an empty quotation', () => {
    expect(() => computeTotals([], { taxPercent: 5, freight: 0 })).toThrow(/at least one line item/);
  });

  it('rejects a zero or negative quantity', () => {
    expect(() =>
      computeTotals([{ description: 'x', quantity: 0, unit: 'kg', pricePerUnit: 10 }], {
        taxPercent: 5,
        freight: 0,
      }),
    ).toThrow(/greater than zero/);
  });

  it('rejects a negative price', () => {
    expect(() =>
      computeTotals([{ description: 'x', quantity: 1, unit: 'kg', pricePerUnit: -1 }], {
        taxPercent: 5,
        freight: 0,
      }),
    ).toThrow(/cannot be negative/);
  });

  it('keeps subtotal, tax and freight consistent with the grand total', () => {
    const totals = computeTotals(items, { taxPercent: 18, freight: 1_234.56 });
    expect(totals.subtotal + totals.taxAmount + totals.freight).toBeCloseTo(totals.grandTotal, 2);
  });
});

describe('amountInWords — Indian numbering', () => {
  it.each([
    [0, 'Zero Rupees Only'],
    [1, 'One Rupees Only'],
    [15, 'Fifteen Rupees Only'],
    [42, 'Forty Two Rupees Only'],
    [100, 'One Hundred Rupees Only'],
    [999, 'Nine Hundred Ninety Nine Rupees Only'],
    [1_000, 'One Thousand Rupees Only'],
    [12_345, 'Twelve Thousand Three Hundred Forty Five Rupees Only'],
    [100_000, 'One Lakh Rupees Only'],
    [1_23_456, 'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only'],
    [10_000_000, 'One Crore Rupees Only'],
    [1_94_250, 'One Lakh Ninety Four Thousand Two Hundred Fifty Rupees Only'],
  ])('%i -> %s', (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });

  it('uses lakh and crore rather than the short scale', () => {
    // The failure this guards: "One Hundred Thousand" on an Indian invoice.
    expect(amountInWords(100_000)).not.toContain('Hundred Thousand');
    expect(amountInWords(10_000_000)).not.toContain('Million');
  });

  it('spells out paise', () => {
    expect(amountInWords(1_250.75)).toBe(
      'One Thousand Two Hundred Fifty Rupees and Seventy Five Paise Only',
    );
  });

  it('handles a negative amount', () => {
    expect(amountInWords(-500)).toBe('Minus Five Hundred Rupees Only');
  });
});

describe('formatIndian', () => {
  it('groups digits the Indian way, not in thousands', () => {
    expect(formatIndian(1_234_567)).toBe('12,34,567.00');
    expect(formatIndian(100_000)).toBe('1,00,000.00');
  });

  it('always shows two decimal places', () => {
    expect(formatIndian(585)).toBe('585.00');
    expect(formatIndian(585.5)).toBe('585.50');
  });
});
