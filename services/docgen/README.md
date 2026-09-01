# `@lead/docgen` — quotations and presentations

Generates `.docx` quotations and `.pptx` capability decks. Files are written to
`STORAGE_DIR` and recorded as `Document` rows linked to the lead, so a
prospect's document history appears in their detail view instead of being a file
somebody has to remember they made.

```bash
pnpm --filter @lead/docgen dev     # http://localhost:4100
pnpm --filter @lead/docgen test
```

This service is **not exposed to browsers**. The API proxies to it and every
route requires `x-internal-token`.

## Nothing is hardcoded per document

Every business detail — legal name, brand, FSSAI number, GSTIN, address, bank
details, quotation terms, validity period — comes from the `BusinessProfile`
row. Product names, HSN codes, units and prices come from the catalogue. Update
your rate once under **Catalogue** in the CRM and every quotation issued
afterwards uses it.

## Prices are resolved, then snapshotted

At generation time the price for each line is resolved from the product's tier
ladder using the quantity ordered. That resolved figure, along with a copy of
every line item and the business identifiers, is written into `Document.meta`.

This is what makes the catalogue safely editable. Changing a rate changes
**future** quotations; already-issued ones are reproducible exactly as they were
sent, even if the product is later retired or hard-deleted.

An explicit `pricePerUnit` on a line overrides the ladder — that is how a
negotiated rate gets quoted without editing the catalogue.

A quantity below the lowest tier is refused with a message naming the minimum,
rather than being silently priced from the cheapest band.

## Arithmetic

All money is computed in integer paise and converted back at the edges. Doing
GST on floating-point rupees produces totals that are off by a paisa in ways
that are visible on a printed document.

Amounts are rendered with Indian digit grouping (`4,50,750.00`, not
`450,750.00`) and spelled out using lakh and crore — a test asserts that
₹1,00,000 never renders as "One Hundred Thousand".

Freight is added **after** tax and is not itself taxed. If your accountant wants
it taxed, that is a one-line change in `computeTotals`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/documents/quotation` | Body: `leadId`, `items[]`, `taxPercent`, `freight`, `notes` |
| POST | `/documents/presentation` | Body: optional `leadId`, `title`, `includePricing` |
| GET | `/documents/:id/download` | Streams the stored file |
| GET | `/health` | Unauthenticated |

A line item takes either a `productId` (priced from the catalogue) or an
explicit `description` plus `pricePerUnit` for one-off items.

## The presentation

Six slides built from the same config: title, who we are, product range,
optional pricing, white-label capability, next steps. Uses the CRM's moss and
parchment palette so a deck and a quotation look like they came from the same
business.

`includePricing` defaults to **false** — a cold first-touch deck should not lead
with rates.

## Storage

Files are partitioned as `<type>/<year>/<month>/<slug>-<date>-<token>.<ext>`, so
a directory listing stays usable after a few thousand quotations and two
quotations for the same lead on the same day cannot collide.

`Document.storagePath` is stored **relative** to `STORAGE_DIR`, so the volume
can move without rewriting rows. Paths are resolved through a check that refuses
anything escaping the storage root — the path comes from a database row, and
treating it as trusted would turn one bad row into an arbitrary-file read.

If a stored file goes missing, the download returns 410 with a message saying to
regenerate — the `meta` snapshot still holds everything needed to reproduce it.

## Testing

41 tests covering the money arithmetic (rounding to paise, GST, freight
ordering, Indian numbering and amount-in-words) and storage path safety
(traversal refusal, collision resistance).
