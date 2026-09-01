/**
 * Quotation (.docx).
 *
 * Laid out like an Indian commercial quotation: seller block with FSSAI and
 * GSTIN, buyer block, an HSN-coded line-item table, GST computed on the
 * subtotal, the amount in words, terms, and bank details.
 *
 * None of the business details are hardcoded — every one comes from the
 * BusinessProfile row, so updating the catalogue or the FSSAI number once
 * updates every quotation issued afterwards.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { QuotationContext } from '../lib/quotation-data.js';
import { computeTotals, formatIndian, type QuotationTotals } from '../lib/money.js';

const MOSS = '3A4A2E';
const INK = '1B2019';
const FAINT = '6B7266';

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const HAIRLINE = { style: BorderStyle.SINGLE, size: 1, color: 'DCD5C0' } as const;

function text(value: string, opts: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({
    text: value,
    bold: opts.bold ?? false,
    // docx sizes are half-points.
    size: (opts.size ?? 10) * 2,
    color: opts.color ?? INK,
    font: 'Calibri',
  });
}

function para(
  runs: TextRun[],
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: number } = {},
) {
  return new Paragraph({
    children: runs,
    ...(opts.align ? { alignment: opts.align } : {}),
    spacing: { after: opts.spacing ?? 60 },
  });
}

function cell(
  children: Paragraph[],
  opts: { width?: number; bold?: boolean; shaded?: boolean; align?: 'left' | 'right' | 'center' } = {},
) {
  return new TableCell({
    children,
    ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
    ...(opts.shaded ? { shading: { fill: 'F5F2E9' } } : {}),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    borders: { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE },
  });
}

const alignFor = (align?: 'left' | 'right' | 'center') =>
  align === 'right'
    ? AlignmentType.RIGHT
    : align === 'center'
      ? AlignmentType.CENTER
      : AlignmentType.LEFT;

function textCell(
  value: string,
  opts: { width?: number; bold?: boolean; shaded?: boolean; align?: 'left' | 'right' | 'center' } = {},
) {
  return cell(
    [
      new Paragraph({
        children: [text(value, { bold: opts.bold ?? false, size: 9.5 })],
        alignment: alignFor(opts.align),
      }),
    ],
    opts,
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sellerBlock(ctx: QuotationContext): Paragraph[] {
  const b = ctx.business;
  const address = [b.addressLine1, b.addressLine2, `${b.city}, ${b.state} ${b.pincode}`, b.country]
    .filter(Boolean)
    .join(', ');

  const lines: Paragraph[] = [
    para([text(b.brandName, { bold: true, size: 18, color: MOSS })], { spacing: 20 }),
  ];

  if (b.legalName !== b.brandName) {
    lines.push(para([text(b.legalName, { size: 9.5, color: FAINT })], { spacing: 20 }));
  }

  lines.push(para([text(address, { size: 9, color: FAINT })], { spacing: 20 }));

  const identifiers = [
    `FSSAI: ${b.fssaiNumber}`,
    b.gstin ? `GSTIN: ${b.gstin}` : null,
    `Phone: ${b.phone}`,
    `Email: ${b.email}`,
    b.website ? `Web: ${b.website}` : null,
  ]
    .filter(Boolean)
    .join('  |  ');

  lines.push(para([text(identifiers, { size: 9, color: FAINT })], { spacing: 160 }));
  return lines;
}

function partyTable(ctx: QuotationContext): Table {
  const validUntil = new Date(ctx.issuedAt);
  validUntil.setDate(validUntil.getDate() + ctx.validityDays);

  const buyerLines = [
    para([text('QUOTATION FOR', { bold: true, size: 8.5, color: FAINT })], { spacing: 30 }),
    para([text(ctx.lead.name, { bold: true, size: 11 })], { spacing: 20 }),
    para([text(ctx.lead.city, { size: 9.5, color: FAINT })], { spacing: 20 }),
  ];
  if (ctx.lead.phone) buyerLines.push(para([text(ctx.lead.phone, { size: 9, color: FAINT })], { spacing: 20 }));
  if (ctx.lead.email) buyerLines.push(para([text(ctx.lead.email, { size: 9, color: FAINT })], { spacing: 20 }));

  const metaLines = [
    para([text('QUOTATION NO.', { bold: true, size: 8.5, color: FAINT })], { spacing: 30 }),
    para([text(ctx.quotationNumber, { bold: true, size: 11 })], { spacing: 60 }),
    para([text(`Date: ${formatDate(ctx.issuedAt)}`, { size: 9.5 })], { spacing: 20 }),
    para([text(`Valid until: ${formatDate(validUntil)}`, { size: 9.5 })], { spacing: 20 }),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: buyerLines,
            width: { size: 60, type: WidthType.PERCENTAGE },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            margins: { top: 0, bottom: 0, left: 0, right: 120 },
          }),
          new TableCell({
            children: metaLines,
            width: { size: 40, type: WidthType.PERCENTAGE },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            margins: { top: 0, bottom: 0, left: 120, right: 0 },
          }),
        ],
      }),
    ],
  });
}

function itemsTable(totals: QuotationTotals): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      textCell('#', { width: 5, bold: true, shaded: true }),
      textCell('Description', { width: 39, bold: true, shaded: true }),
      textCell('HSN', { width: 10, bold: true, shaded: true }),
      textCell('Qty', { width: 12, bold: true, shaded: true, align: 'right' }),
      textCell('Rate', { width: 17, bold: true, shaded: true, align: 'right' }),
      textCell('Amount', { width: 17, bold: true, shaded: true, align: 'right' }),
    ],
  });

  const rows = totals.items.map(
    (item, index) =>
      new TableRow({
        children: [
          textCell(String(index + 1), { align: 'center' }),
          textCell(item.description),
          textCell(item.hsnCode ?? '—'),
          textCell(`${formatIndian(item.quantity)} ${item.unit}`, { align: 'right' }),
          textCell(formatIndian(item.pricePerUnit), { align: 'right' }),
          textCell(formatIndian(item.amount), { align: 'right', bold: true }),
        ],
      }),
  );

  const summary = (label: string, value: string, bold = false): TableRow =>
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [text(label, { bold, size: 9.5 })], alignment: AlignmentType.RIGHT })],
          columnSpan: 5,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          borders: { top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE },
          ...(bold ? { shading: { fill: 'F5F2E9' } } : {}),
        }),
        textCell(value, { align: 'right', bold, shaded: bold }),
      ],
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      header,
      ...rows,
      summary('Subtotal', formatIndian(totals.subtotal)),
      summary(`GST @ ${totals.taxPercent}%`, formatIndian(totals.taxAmount)),
      ...(totals.freight > 0 ? [summary('Freight & packaging', formatIndian(totals.freight))] : []),
      summary('Grand Total (Rs.)', formatIndian(totals.grandTotal), true),
    ],
  });
}

export async function generateQuotationDocx(ctx: QuotationContext): Promise<{
  buffer: Buffer;
  totals: QuotationTotals;
}> {
  const totals = computeTotals(ctx.items, {
    taxPercent: ctx.taxPercent,
    freight: ctx.freight,
  });

  const b = ctx.business;
  const children: (Paragraph | Table)[] = [
    ...sellerBlock(ctx),
    new Paragraph({
      children: [text('QUOTATION', { bold: true, size: 14, color: MOSS })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 200 },
    }),
    partyTable(ctx),
    new Paragraph({ text: '', spacing: { after: 200 } }),
    itemsTable(totals),
    new Paragraph({ text: '', spacing: { after: 160 } }),
    para([
      text('Amount in words: ', { bold: true, size: 9.5 }),
      text(totals.amountInWords, { size: 9.5 }),
    ], { spacing: 200 }),
  ];

  if (ctx.notes) {
    children.push(
      para([text('Notes', { bold: true, size: 10, color: MOSS })], { spacing: 40 }),
      para([text(ctx.notes, { size: 9.5 })], { spacing: 200 }),
    );
  }

  if (b.quotationTerms.length > 0) {
    children.push(para([text('Terms & Conditions', { bold: true, size: 10, color: MOSS })], { spacing: 60 }));
    for (const term of b.quotationTerms) {
      children.push(
        new Paragraph({
          children: [text(term, { size: 9, color: FAINT })],
          bullet: { level: 0 },
          spacing: { after: 40 },
        }),
      );
    }
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  }

  // Bank details only when they are actually configured — a quotation with an
  // empty "Account No.:" line looks careless.
  if (b.bankName && b.accountNumber) {
    const bank = [
      b.accountName ? `Account name: ${b.accountName}` : null,
      `Bank: ${b.bankName}`,
      `A/c No.: ${b.accountNumber}`,
      b.ifsc ? `IFSC: ${b.ifsc}` : null,
    ]
      .filter(Boolean)
      .join('  |  ');

    children.push(
      para([text('Bank Details', { bold: true, size: 10, color: MOSS })], { spacing: 40 }),
      para([text(bank, { size: 9, color: FAINT })], { spacing: 200 }),
    );
  }

  children.push(
    para([text(`For ${b.legalName}`, { size: 9.5 })], { align: AlignmentType.RIGHT, spacing: 400 }),
    para([text('Authorised Signatory', { size: 9, color: FAINT })], { align: AlignmentType.RIGHT }),
  );

  const doc = new Document({
    creator: b.legalName,
    title: `Quotation ${ctx.quotationNumber} — ${ctx.lead.name}`,
    description: `Quotation for ${ctx.lead.name}, ${ctx.lead.city}`,
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children,
      },
    ],
  });

  return { buffer: await Packer.toBuffer(doc), totals };
}
