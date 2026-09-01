/**
 * Capability deck (.pptx).
 *
 * Everything on these slides comes from the BusinessProfile row and the
 * product catalogue, so the deck stays current as the business changes rather
 * than becoming a stale file someone forgot to re-export.
 *
 * The pricing slide is opt-in: a cold first-touch deck should not lead with
 * rates, and `includePricing` defaults to false for that reason.
 */

import PptxGenJS from 'pptxgenjs';
import { decimalToNumber, type Prisma } from '@lead/db';
import { formatIndian } from '../lib/money.js';

type ProductWithTiers = Prisma.ProductGetPayload<{ include: { priceTiers: true } }>;
type BusinessProfile = Prisma.BusinessProfileGetPayload<Record<string, never>>;

// The ledger palette, matching the CRM.
const MOSS_DARK = '2A3722';
const MOSS = '4C5F3C';
const MOSS_LIGHT = 'A3B594';
const PARCHMENT = 'F5F2E9';
const INK = '1B2019';
const FAINT = '6B7266';

export interface PresentationOptions {
  business: BusinessProfile;
  products: ProductWithTiers[];
  leadName?: string | undefined;
  title?: string | undefined;
  includePricing: boolean;
}

export async function generatePresentationPptx(
  options: PresentationOptions,
): Promise<{ buffer: Buffer; slideCount: number }> {
  const { business: b, products } = options;
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_16x9';
  pptx.author = b.legalName;
  pptx.company = b.brandName;
  pptx.title = options.title ?? `${b.brandName} — Capability Overview`;

  pptx.defineSlideMaster({
    title: 'LEDGER',
    background: { color: PARCHMENT },
    objects: [
      { rect: { x: 0, y: 5.15, w: '100%', h: 0.48, fill: { color: MOSS_DARK } } },
      {
        text: {
          text: `${b.brandName}  |  FSSAI ${b.fssaiNumber}  |  ${b.phone}`,
          options: { x: 0.4, y: 5.19, w: 9.2, h: 0.4, fontSize: 9, color: MOSS_LIGHT },
        },
      },
    ],
  });

  let slideCount = 0;
  const slide = () => {
    slideCount += 1;
    return pptx.addSlide({ masterName: 'LEDGER' });
  };

  // --- title ---------------------------------------------------------------
  const title = slide();
  title.background = { color: MOSS_DARK };
  title.addText(b.brandName, {
    x: 0.7,
    y: 1.6,
    w: 8.6,
    h: 0.9,
    fontSize: 40,
    bold: true,
    color: PARCHMENT,
  });
  title.addText(options.title ?? 'Makhana — wholesale & white-label manufacturing', {
    x: 0.7,
    y: 2.5,
    w: 8.6,
    h: 0.5,
    fontSize: 18,
    color: MOSS_LIGHT,
  });
  if (options.leadName) {
    title.addText(`Prepared for ${options.leadName}`, {
      x: 0.7,
      y: 3.2,
      w: 8.6,
      h: 0.4,
      fontSize: 13,
      color: MOSS_LIGHT,
      italic: true,
    });
  }
  title.addText(`${b.city}, ${b.state}  ·  ${b.phone}  ·  ${b.email}`, {
    x: 0.7,
    y: 4.3,
    w: 8.6,
    h: 0.4,
    fontSize: 11,
    color: MOSS_LIGHT,
  });

  // --- about ---------------------------------------------------------------
  const about = slide();
  about.addText('Who we are', {
    x: 0.6,
    y: 0.45,
    w: 9,
    h: 0.6,
    fontSize: 26,
    bold: true,
    color: MOSS_DARK,
  });
  about.addText(
    [
      {
        text: `${b.legalName} supplies makhana (fox nut) at wholesale, and manufactures under private label for brands that want their own packaging.`,
        options: { breakLine: true, bullet: true },
      },
      {
        text: `Based in ${b.city}, ${b.state} — inside the growing belt, which keeps sourcing short and rates competitive.`,
        options: { breakLine: true, bullet: true },
      },
      {
        text: `FSSAI licensed (${b.fssaiNumber})${b.gstin ? `, GSTIN ${b.gstin}` : ''}.`,
        options: { breakLine: true, bullet: true },
      },
      {
        text: 'Graded by sut size, moisture controlled below 8%, packed in food-grade laminated pouches.',
        options: { breakLine: true, bullet: true },
      },
    ],
    { x: 0.8, y: 1.3, w: 8.4, h: 3, fontSize: 15, color: INK, lineSpacingMultiple: 1.4 },
  );

  // --- product range -------------------------------------------------------
  const active = products.filter((p) => p.active);
  if (active.length > 0) {
    const range = slide();
    range.addText('Product range', {
      x: 0.6,
      y: 0.45,
      w: 9,
      h: 0.6,
      fontSize: 26,
      bold: true,
      color: MOSS_DARK,
    });

    const rows: PptxGenJS.TableRow[] = [
      [
        { text: 'Product', options: { bold: true, color: PARCHMENT, fill: { color: MOSS } } },
        { text: 'Grade', options: { bold: true, color: PARCHMENT, fill: { color: MOSS } } },
        { text: 'Notes', options: { bold: true, color: PARCHMENT, fill: { color: MOSS } } },
      ],
      ...active
        .slice(0, 8)
        .map((p): PptxGenJS.TableRow => [
          { text: p.name, options: { bold: true } },
          { text: p.grade ?? '—' },
          { text: (p.description ?? '').slice(0, 120), options: { fontSize: 10, color: FAINT } },
        ]),
    ];

    range.addTable(rows, {
      x: 0.6,
      y: 1.25,
      w: 8.8,
      colW: [3.1, 1.4, 4.3],
      fontSize: 11,
      border: { type: 'solid', color: 'DCD5C0', pt: 1 },
      autoPage: false,
    });
  }

  // --- pricing (opt-in) ----------------------------------------------------
  if (options.includePricing) {
    const priced = active.filter((p) => p.priceTiers.length > 0);

    if (priced.length > 0) {
      const pricing = slide();
      pricing.addText('Indicative pricing', {
        x: 0.6,
        y: 0.45,
        w: 9,
        h: 0.6,
        fontSize: 26,
        bold: true,
        color: MOSS_DARK,
      });
      pricing.addText('Ex-works, exclusive of GST. Rates firm for the quotation validity period.', {
        x: 0.6,
        y: 1.0,
        w: 9,
        h: 0.3,
        fontSize: 11,
        color: FAINT,
        italic: true,
      });

      const rows: PptxGenJS.TableRow[] = [
        [
          { text: 'Product', options: { bold: true, color: PARCHMENT, fill: { color: MOSS } } },
          { text: 'Quantity', options: { bold: true, color: PARCHMENT, fill: { color: MOSS } } },
          { text: 'Rate', options: { bold: true, color: PARCHMENT, fill: { color: MOSS } } },
        ],
      ];

      for (const product of priced.slice(0, 5)) {
        const tiers = [...product.priceTiers].sort((a, b2) => a.minQty - b2.minQty);
        tiers.forEach((tier, index) => {
          rows.push([
            { text: index === 0 ? product.name : '', options: { bold: index === 0 } },
            {
              text: `${tier.minQty}${tier.maxQty === null ? '+' : `–${tier.maxQty}`} ${product.unit}`,
            },
            {
              text: `Rs. ${formatIndian(decimalToNumber(tier.pricePerUnit) ?? 0)} / ${product.unit}`,
            },
          ]);
        });
      }

      pricing.addTable(rows, {
        x: 0.6,
        y: 1.45,
        w: 8.8,
        colW: [4.0, 2.4, 2.4],
        fontSize: 11,
        border: { type: 'solid', color: 'DCD5C0', pt: 1 },
        autoPage: false,
      });
    }
  }

  // --- white label ---------------------------------------------------------
  const whiteLabel = slide();
  whiteLabel.addText('White-label manufacturing', {
    x: 0.6,
    y: 0.45,
    w: 9,
    h: 0.6,
    fontSize: 26,
    bold: true,
    color: MOSS_DARK,
  });
  whiteLabel.addText(
    [
      { text: 'Your brand, our production line', options: { breakLine: true, bullet: true } },
      {
        text: 'Roasting, flavouring, pouch filling and labelling under one roof',
        options: { breakLine: true, bullet: true },
      },
      {
        text: 'Artwork approval before production begins — no surprises on the shelf',
        options: { breakLine: true, bullet: true },
      },
      {
        text: 'Nitrogen-flushed pouches for shelf life on ready-to-eat lines',
        options: { breakLine: true, bullet: true },
      },
      {
        text: 'Typical MOQ 200 kg per SKU; lead time 7–10 working days after advance',
        options: { breakLine: true, bullet: true },
      },
    ],
    { x: 0.8, y: 1.3, w: 8.4, h: 3, fontSize: 15, color: INK, lineSpacingMultiple: 1.4 },
  );

  // --- next steps ----------------------------------------------------------
  const contact = slide();
  contact.background = { color: MOSS_DARK };
  contact.addText('Next steps', {
    x: 0.7,
    y: 1.3,
    w: 8.6,
    h: 0.7,
    fontSize: 30,
    bold: true,
    color: PARCHMENT,
  });
  contact.addText(
    [
      {
        text: 'Tell us your grade, volume and packing format',
        options: { breakLine: true, bullet: true },
      },
      { text: 'We send samples and a firm quotation', options: { breakLine: true, bullet: true } },
      {
        text: 'Confirm the order with 50% advance; dispatch in 7–10 working days',
        options: { breakLine: true, bullet: true },
      },
    ],
    { x: 0.9, y: 2.2, w: 8.2, h: 1.5, fontSize: 15, color: MOSS_LIGHT, lineSpacingMultiple: 1.4 },
  );
  contact.addText(`${b.phone}   ·   ${b.email}${b.website ? `   ·   ${b.website}` : ''}`, {
    x: 0.7,
    y: 4.1,
    w: 8.6,
    h: 0.5,
    fontSize: 14,
    bold: true,
    color: PARCHMENT,
  });

  const data = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return { buffer: data, slideCount };
}
