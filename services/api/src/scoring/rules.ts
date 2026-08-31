/**
 * Scoring rules — the tunable part of the scoring engine.
 *
 * These constants are the only thing you should need to edit when the business
 * learns something new about which leads actually convert. The engine in
 * `engine.ts` is generic over them, and `engine.test.ts` asserts the band
 * boundaries hold whatever the numbers are set to.
 *
 * The model is deliberately additive and bounded at 100 so a score is
 * explainable to a human: "48 for the category, 25 for a metro, 15 for having
 * a website" reads as a reason, where an opaque weighted product does not.
 */

import type { LeadScore, RegionTier } from '@lead/shared';

/** Maximum points each signal can contribute. They sum to 100. */
export const SIGNAL_CAPS = {
  category: 50,
  regionTier: 25,
  website: 15,
  contactable: 10,
} as const;

export const MAX_SCORE =
  SIGNAL_CAPS.category + SIGNAL_CAPS.regionTier + SIGNAL_CAPS.website + SIGNAL_CAPS.contactable;

/**
 * Band thresholds, inclusive lower bounds.
 *
 * A lead is `high` at >= 70, `medium` at >= 45, `low` below that. The gap
 * between them matters: 70 is reachable by a strong category in a tier-3 town
 * with a phone number but no website, which is exactly the profile of the
 * small-town dry-fruit distributor this business most wants to find.
 */
export const SCORE_THRESHOLDS = {
  high: 70,
  medium: 45,
} as const;

/**
 * Points by region tier. Metros carry larger order volumes and most of the
 * corporate gifting demand; tier-3 towns are cheaper to serve but order less.
 */
export const REGION_TIER_POINTS: Record<RegionTier, number> = {
  1: 25,
  2: 18,
  3: 10,
};

/**
 * Category weighting.
 *
 * `category` arrives as free text from directory listings — "Dry Fruit
 * Wholesaler", "Corporate Gifting Solutions Pvt Ltd", "Kirana Store". Matching
 * is therefore keyword-based rather than an enum lookup, and rules are
 * evaluated **in order, first match wins**, so the more specific patterns must
 * come first. "Dry fruit wholesaler" has to match the wholesaler rule, not the
 * retailer one.
 */
export interface CategoryRule {
  /** Stable identifier, surfaced in score reasons and easy to grep for. */
  id: string;
  /** Human-readable name used in the score explanation. */
  label: string;
  points: number;
  /** Matched case-insensitively against the normalised category text. */
  patterns: RegExp[];
  /**
   * Real directory-listing strings this rule is meant to catch.
   *
   * These are not decoration: `engine.test.ts` asserts every example routes to
   * its own rule, which is what caught `/\be-?commerce/` never matching —
   * `normalizeCategory` turns punctuation into spaces, so a pattern containing
   * a hyphen or an ampersand can look correct and match nothing.
   */
  examples: string[];
}


export const CATEGORY_RULES: CategoryRule[] = [
  // ORDER IS SPECIFICITY, NOT VALUE. Rules are evaluated top to bottom and the
  // first match wins, so a rule must sit above any broader rule that would
  // also match its listings. The point values below are therefore NOT in
  // descending order, and that is deliberate:
  //
  //   'Gift Hamper Suppliers'         -> gifting, not distributor ("supplier")
  //   'Cash and Carry Wholesale Club' -> retail chain, not distributor ("wholesale")
  //   'D2C Snack Brand'               -> e-commerce, not manufacturer ("snack brand"):
  //                                      a D2C brand outsources production, which is
  //                                      precisely what makes it a white-label lead
  //
  // Each of those was a real misclassification caught by the examples below.
  // If you add a rule, add its examples too and let the test tell you where in
  // this list it belongs.
  {
    id: 'private_label',
    label: 'Private label / contract manufacturing',
    points: 50,
    patterns: [
      /\bprivate\s*label\b/,
      /\bwhite\s*label\b/,
      /\bcontract\s+(manufactur|packag)/,
      /\bthird\s*party\s+manufactur/,
      /\boem\b/,
      /\bco\s*pack/,
    ],
    examples: [
      'Private Label Snack Manufacturing',
      'White Label Food Products',
      'Third Party Manufacturing Unit',
      'Contract Packaging Services',
      'OEM Food Supplier',
      'Co-Packing Company',
    ],
  },
  {
    id: 'corporate_gifting',
    label: 'Corporate gifting',
    points: 44,
    patterns: [
      /\bcorporate\s+gift/,
      /\bgifting\b/,
      /\bgift\s+(hamper|box|pack|articl|shop|item)/,
      /\bhamper/,
      /\bfestive\s+pack/,
      /\bpromotional\s+(gift|product)/,
    ],
    examples: [
      'Corporate Gifting Solutions',
      'Gift Hamper Suppliers',
      'Festive Packs and Hampers',
      'Promotional Gift Company',
      'Diwali Gifting Services',
    ],
  },
  {
    id: 'exporter',
    label: 'Exporter',
    points: 46,
    patterns: [/\bexport/, /\boverseas\s+trad/],
    examples: ['Agro Export House', 'Merchant Exporter', 'Overseas Trading Company'],
  },
  {
    id: 'retail_chain',
    label: 'Supermarket / retail chain',
    points: 42,
    patterns: [
      /\bsupermarket/,
      /\bhypermarket/,
      /\bretail\s+chain/,
      /\bdepartmental\s+store/,
      /\bmodern\s+trade/,
      /\bcash\s+(and\s+)?carry/,
      /\bmart\b/,
    ],
    examples: [
      'Supermarket Chain',
      'Hypermarket',
      'Departmental Store',
      'Modern Trade Retailer',
      'Cash and Carry Wholesale Club',
      'Big Mart',
    ],
  },
  {
    id: 'distributor',
    label: 'Distributor / wholesaler',
    points: 48,
    patterns: [
      /\bdistributor/,
      /\bwholesal/,
      /\bstockist/,
      /\bsupplier/,
      /\btrader/,
      /\bc\s+f\s+agent\b/,
      /\bcommission\s+agent/,
      /\bmandi\b/,
    ],
    examples: [
      'Dry Fruit Wholesaler',
      'FMCG Distributor',
      'Authorised Stockist',
      'Namkeen Supplier',
      'Grain Trader',
      'C & F Agent',
      'Commission Agent',
      'Mandi Trader',
    ],
  },
  {
    id: 'ecommerce',
    label: 'Online / e-commerce seller',
    points: 35,
    patterns: [
      /\be\s?commerce/,
      /\bonline\s+(seller|store|shop|retail|grocer)/,
      /\bd2c\b/,
      /\bmarketplace\s+seller/,
      /\bquick\s+commerce/,
    ],
    examples: [
      'E-Commerce Seller',
      'Online Grocery Store',
      'D2C Snack Brand',
      'Marketplace Seller',
      'Quick Commerce Partner',
    ],
  },
  {
    id: 'snack_manufacturer',
    label: 'Snack / food manufacturer',
    points: 40,
    patterns: [
      /\bmanufactur/,
      /\bfood\s+process/,
      /\bnamkeen\s+(manufactur|factory|unit)/,
      /\bsnack\s+(manufactur|compan|brand|factory)/,
      /\bfactory\b/,
      /\bprocessing\s+unit/,
      /\bfmcg\b/,
      /\broasting\b/,
    ],
    examples: [
      'Snack Manufacturing Company',
      'Food Processing Unit',
      'Namkeen Manufacturer',
      'FMCG Brand',
      'Roasting Factory',
    ],
  },
  {
    id: 'health_food',
    label: 'Health / organic food retail',
    points: 32,
    patterns: [
      /\borganic/,
      /\bhealth\s+(food|store|snack)/,
      /\bnutrition/,
      /\bvegan\b/,
      /\bayurved/,
      /\bwellness/,
    ],
    examples: [
      'Organic Food Store',
      'Health Snack Retailer',
      'Nutrition Products',
      'Ayurvedic Wellness Store',
      'Vegan Foods',
    ],
  },
  {
    id: 'dry_fruit_retail',
    label: 'Dry fruit / nut retail',
    points: 30,
    patterns: [
      /\bdry\s*fruit/,
      /\bdried\s+fruit/,
      /\bnut\s+(shop|store|retail|trading|counter)/,
      /\bmakhana/,
      /\bfox\s*nut/,
      /\bspice\s+(shop|store|merchant)/,
    ],
    examples: [
      'Dry Fruit Retail Shop',
      'Makhana Seller',
      'Fox Nut Trading Counter',
      'Nut Store',
      'Spice Merchant',
    ],
  },
  {
    id: 'sweet_namkeen',
    label: 'Sweet shop / namkeen retail',
    points: 26,
    patterns: [/\bsweet/, /\bmithai/, /\bnamkeen/, /\bconfection/, /\bbaker/, /\bhalwai/],
    examples: [
      'Sweet Shop',
      'Mithai Bhandar',
      'Namkeen Corner',
      'Confectionery Retail',
      'Bakery Outlet',
      'Halwai',
    ],
  },
  {
    id: 'horeca',
    label: 'Hotel / restaurant / catering',
    points: 20,
    patterns: [
      /\bcater/,
      /\brestaurant/,
      /\bhotel/,
      /\bbanquet/,
      /\bcafe\b/,
      /\bcloud\s+kitchen/,
      /\bhoreca\b/,
      /\bcanteen/,
      /\bmess\b/,
    ],
    examples: [
      'Catering Services',
      'Restaurant',
      'Hotel',
      'Banquet Hall',
      'Cafe',
      'Cloud Kitchen',
      'HORECA Supplies',
      'Corporate Canteen',
    ],
  },
  {
    id: 'general_retail',
    label: 'General / kirana retail',
    points: 14,
    patterns: [
      /\bkirana/,
      /\bgrocer/,
      /\bgeneral\s+store/,
      /\bprovision/,
      /\bretail/,
      /\bshop\b/,
      /\bstore\b/,
      /\boutlet\b/,
    ],
    examples: [
      'Kirana Store',
      'Grocery Shop',
      'General Store',
      'Provision Store',
      'Retail Outlet',
    ],
  },
];

/**
 * Points for a category the rules do not recognise.
 *
 * Deliberately mid-low rather than zero: an unmatched category usually means a
 * listing the scraper worded unusually, not a worthless lead, and scoring it
 * zero would bury it below genuinely poor prospects. If a large share of leads
 * land here, that is a signal to add a rule — `scoreLead` flags it in the
 * reasons so it is visible in the UI.
 */
export const UNKNOWN_CATEGORY_POINTS = 15;

export const SCORE_BANDS: readonly LeadScore[] = ['high', 'medium', 'low'];
