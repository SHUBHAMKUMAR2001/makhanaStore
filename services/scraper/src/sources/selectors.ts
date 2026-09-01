/**
 * Per-site CSS selectors, isolated here on purpose.
 *
 * When a directory redesigns — and they do — the fix is this one file, not a
 * hunt through the scraping logic. Each site declares several candidate
 * selectors per field; the extractor takes the first that matches, so a
 * partial redesign degrades instead of breaking outright.
 *
 * IndiaMART is deliberately NOT here: it is parsed from its embedded
 * `window.__INITIAL_STATE__` JSON, which survives visual redesigns that would
 * invalidate every selector below. See `indiamart.ts`.
 */

export interface SiteSelectors {
  /** Human name, used in logs and error messages. */
  label: string;
  host: string;
  /** Build the search URL for a page of results (1-indexed). */
  searchUrl: (params: { category: string; city: string; page: number }) => string;
  /** Container for one business listing. First match wins. */
  resultItem: string[];
  /** Fields, relative to a result item. */
  name: string[];
  phone: string[];
  website: string[];
  address: string[];
  category: string[];
  /** Present when the site rendered results but found none. */
  noResults: string[];
  /** Link/button to the next page, if the site paginates that way. */
  nextPage: string[];
}

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const JUSTDIAL: SiteSelectors = {
  label: 'Justdial',
  host: 'justdial.com',
  searchUrl: ({ category, city, page }) =>
    `https://www.justdial.com/${encodeURIComponent(city)}/${encodeURIComponent(slug(category))}/page-${page}`,
  resultItem: [
    '.resultbox',
    '[class*="resultbox_info"]',
    '.store-details',
    'li[id^="sp"]',
    '[data-testid="listing-card"]',
  ],
  name: [
    '.resultbox_title_anchor',
    '[class*="resultbox_title"]',
    '.store-name span',
    '.lng_cont_name',
    'h2 a',
    'h3 a',
  ],
  phone: [
    '.callcontent',
    '[class*="callcontent"]',
    '.contact-info span',
    '.mobilesv',
    'a[href^="tel:"]',
  ],
  website: ['a.website', '[class*="website"]', 'a[title*="Website"]'],
  address: ['.resultbox_address', '[class*="address"]', '.cont_sw_addr', '.adrstxt'],
  category: ['.resultbox_cat', '[class*="category"]', '.jcn + .cat'],
  noResults: ['.no_result', '[class*="noResult"]', '.emptyResult'],
  nextPage: ['a[rel="next"]', '.pagination a.next'],
};

export const TRADEINDIA: SiteSelectors = {
  label: 'TradeIndia',
  host: 'tradeindia.com',
  searchUrl: ({ category, city, page }) =>
    `https://www.tradeindia.com/search.html?keyword=${encodeURIComponent(category)}&city=${encodeURIComponent(city)}&page=${page}`,
  resultItem: [
    '.sc-company-card',
    '[class*="CompanyCard"]',
    '.company-list-item',
    '.seller-card',
    'div[data-company-id]',
  ],
  name: ['.company-name', '[class*="companyName"]', 'h2 a', 'h3 a', '.sc-company-name'],
  phone: ['.contact-number', '[class*="phone"]', 'a[href^="tel:"]', '.mobile-no'],
  website: ['a.company-website', '[class*="website"]', 'a[href*="tradeindia.com/"][rel="nofollow"]'],
  address: ['.company-address', '[class*="address"]', '.location-text'],
  category: ['.business-type', '[class*="businessType"]', '.company-category'],
  noResults: ['.no-result-found', '[class*="noResult"]', '.empty-state'],
  nextPage: ['a[rel="next"]', '.pagination .next a'],
};

export const SITE_SELECTORS = {
  justdial: JUSTDIAL,
  tradeindia: TRADEINDIA,
} as const;

export type SelectorSite = keyof typeof SITE_SELECTORS;
