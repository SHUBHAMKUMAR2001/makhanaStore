/**
 * Money and quantity arithmetic for quotations.
 *
 * Kept separate and pure so it can be tested exhaustively. A quotation with a
 * wrong total is worse than no quotation — it goes to a customer.
 *
 * Everything works in paise internally (integers) and converts back at the
 * edges. Doing GST on floating-point rupees produces totals that are off by a
 * paisa in ways that are visible on a printed document.
 */

export interface LineItemInput {
  description: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  hsnCode?: string | undefined;
}

export interface ComputedLineItem extends LineItemInput {
  /** quantity × pricePerUnit, rounded to paise. */
  amount: number;
}

export interface QuotationTotals {
  items: ComputedLineItem[];
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  freight: number;
  grandTotal: number;
  /** Grand total spelled out, as Indian invoices conventionally carry. */
  amountInWords: string;
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const toRupees = (paise: number): number => Math.round(paise) / 100;

export function computeLineAmount(quantity: number, pricePerUnit: number): number {
  return toRupees(toPaise(quantity * pricePerUnit));
}

export function computeTotals(
  items: LineItemInput[],
  options: { taxPercent: number; freight: number },
): QuotationTotals {
  if (items.length === 0) {
    throw new Error('A quotation needs at least one line item');
  }

  const computed: ComputedLineItem[] = items.map((item) => {
    if (item.quantity <= 0) {
      throw new Error(`Quantity for "${item.description}" must be greater than zero`);
    }
    if (item.pricePerUnit < 0) {
      throw new Error(`Price for "${item.description}" cannot be negative`);
    }
    return { ...item, amount: computeLineAmount(item.quantity, item.pricePerUnit) };
  });

  const subtotalPaise = computed.reduce((sum, item) => sum + toPaise(item.amount), 0);
  const taxPaise = Math.round((subtotalPaise * options.taxPercent) / 100);
  const freightPaise = toPaise(options.freight);
  const grandPaise = subtotalPaise + taxPaise + freightPaise;

  return {
    items: computed,
    subtotal: toRupees(subtotalPaise),
    taxPercent: options.taxPercent,
    taxAmount: toRupees(taxPaise),
    freight: toRupees(freightPaise),
    grandTotal: toRupees(grandPaise),
    amountInWords: amountInWords(toRupees(grandPaise)),
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  const ones = ONES[n % 10]!;
  return ones ? `${tens} ${ones}` : tens;
}

function threeDigits(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/**
 * Indian numbering: crore, lakh, thousand, hundred — not the short scale.
 * "One Lakh Twenty Three Thousand" is what an Indian invoice must say.
 */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  if (amount === 0) return 'Zero Rupees Only';

  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const rupees = Math.floor(absolute);
  const paise = Math.round((absolute - rupees) * 100);

  const groups: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;

  if (crore) groups.push(`${threeDigits(crore)} Crore`);
  if (lakh) groups.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) groups.push(`${twoDigits(thousand)} Thousand`);
  if (rest) groups.push(threeDigits(rest));

  let words = groups.join(' ').trim();
  words = words ? `${words} Rupees` : 'Zero Rupees';
  if (paise > 0) words += ` and ${twoDigits(paise)} Paise`;

  return `${negative ? 'Minus ' : ''}${words} Only`;
}

/** Indian digit grouping: 12,34,567 rather than 1,234,567. */
export function formatIndian(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatRupees(amount: number): string {
  return `Rs. ${formatIndian(amount)}`;
}
