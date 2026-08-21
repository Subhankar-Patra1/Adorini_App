import 'reflect-metadata';
import type { DataSource } from 'typeorm';

import { AppDataSource } from '../data-source';
import { Brand, Category, Product, ProductVariant } from '../entities';
import { buildSizeChart } from './size-charts';
import { FabricType, PrintTechnique } from '../../common/enums/domain.enums';

/**
 * Reference data for local development and fresh environments.
 *
 * Every seed is an upsert keyed on a natural unique column (`slug`, `sku`), so
 * running this repeatedly converges rather than erroring or duplicating. A seed
 * that can only be run once is a seed nobody runs.
 */

/**
 * The band a category is stocked in unless it says otherwise. Applied
 * explicitly to every row below rather than left to the column default,
 * because `upsert` spreads each object into one multi-row statement — a
 * category omitting the key would contribute `undefined` to that statement
 * instead of falling through to the default.
 */
const DEFAULT_SIZE_BAND = [40, 42, 44, 46, 48];

/**
 * Stored on every free-size variant. Meaningless by construction — see the
 * `AddFreeSizeProducts` migration for why the column cannot simply be null.
 */
const FREE_SIZE_PLACEHOLDER = 40;

/** The band a category stocks, for charts and variant generation alike. */
function bandFor(categorySlug: string): number[] {
  const category = CATEGORIES.find((c) => c.slug === categorySlug);
  if (!category) {
    throw new Error(`No category seed for "${categorySlug}"`);
  }
  return category.sizes ?? DEFAULT_SIZE_BAND;
}

interface CategorySeed {
  slug: string;
  name: string;
  displayOrder: number;
  description: string;
  /** Omit to take [DEFAULT_SIZE_BAND]. */
  sizes?: number[];
}

const CATEGORIES: CategorySeed[] = [
  {
    slug: 'kurtis',
    name: 'Kurti',
    displayOrder: 1,
    description: 'Everyday and occasion kurtis in traditional prints.',
  },
  {
    slug: 'two-piece-suit-sets',
    name: 'Two-Piece Set',
    displayOrder: 2,
    description: 'Kurta and bottom pairings.',
  },
  {
    slug: 'three-piece-suit-sets',
    name: 'Three-Piece Set',
    displayOrder: 3,
    description: 'Kurta, bottom and dupatta sets.',
  },
  {
    slug: 'blouses',
    name: 'Blouse',
    displayOrder: 4,
    description: 'Saree blouses, stitched and ready to wear.',
    // The one category that departs from the 40–48 garment band. Blouse sizing
    // is the bust measurement of the blouse itself rather than the wearer's
    // outer garment size, so the numbers sit a full band lower.
    sizes: [32, 34, 36],
  },
  {
    slug: 'petticoats',
    name: 'Petticoat',
    displayOrder: 5,
    description: 'Cotton and satin petticoats.',
  },
  {
    slug: 'leggings',
    name: 'Leggings',
    displayOrder: 6,
    // One category, deliberately. It holds both ankle-length stock (sized in
    // the band below) and free-size stock such as the Lyra churidar range,
    // which is distinguished per product by `isFreeSize` rather than by living
    // in a category of its own.
    description: 'Ankle-length and free-size leggings in cotton and stretch blends.',
  },
  {
    slug: 'palazzos',
    name: 'Palazzo',
    displayOrder: 7,
    description: 'Wide-leg flowy palazzo pants.',
  },
  // Split from a single "Straight/Pencil Pants" category. They are different
  // silhouettes and a shopper browsing for one does not want the other, so the
  // combined tile was doing the job of a filter rather than a category.
  {
    slug: 'straight-pants',
    name: 'Straight Pant',
    displayOrder: 8,
    description: 'Straight-fit bottoms.',
  },
  {
    slug: 'pencil-pants',
    name: 'Pencil Pant',
    displayOrder: 9,
    description: 'Slim, tapered pencil-fit bottoms.',
  },
  {
    slug: 'one-piece',
    name: 'One-Piece',
    displayOrder: 10,
    description: 'Single-piece dresses and gowns.',
  },
  {
    slug: 'kaftaans',
    name: 'Kaftaan',
    displayOrder: 11,
    description: 'Loose-fit flowy kaftaans.',
  },
];

const BRANDS = [
  { slug: 'sana', name: 'sana', displayOrder: 1 },
  { slug: 'mg', name: 'mg', displayOrder: 2 },
  { slug: 'mm', name: 'mm', displayOrder: 3 },
  { slug: 'navranga', name: 'NAVRANGA', displayOrder: 4 },
  { slug: 'lyra', name: 'Lyra', displayOrder: 5 },
];

interface ProductSeed {
  slug: string;
  name: string;
  categorySlug: string;
  brandSlug: string;
  fabricType: FabricType;
  printTechnique: PrintTechnique;
  /** PLACEHOLDER - see the note on PRODUCTS. */
  pricePaise: number;
  compareAtPricePaise: number | null;
  garmentLengthCm: number;
  colours: string[];
  description: string;
  /** One size, one variant per colour. Omit for banded stock. */
  isFreeSize?: boolean;
}

/**
 * The catalogue, transcribed from the supplier PDFs (Kalamkari Kurti
 * collection, Lyra Premium Churidar Leggings).
 *
 * ### Two fields are invented and must be replaced before launch
 *
 * **`pricePaise` / `compareAtPricePaise`** - neither PDF quotes a price, and
 * the column is NOT NULL. Every number below is a plausible-looking
 * placeholder, not a business decision. Grep this file before going live.
 *
 * **`brandSlug`** - the PDFs name no brand. Garments are filed under `navranga`
 * and the leggings under `lyra`, which is the only attribution the source
 * actually supports.
 *
 * ### Category comes from "Package Contains", not from the title
 *
 * The PDF titles almost everything a "Kurti", including pieces that ship with a
 * bottom. Filing by title would drop kurta+pant sets into the list a shopper
 * browses for a single kurti, where their price looks inexplicable. So the
 * package contents decide:
 *
 * - `1 Kurti` / `1 Kurta` / `1 Tunic`             -> kurtis
 * - `1 Kurta, 1 Pant|Palazzo|Legging|Pajama`      -> two-piece-suit-sets
 * - `1 Kaftan Dress` / `1 Kaftan Tunic`           -> kaftaans
 * - `1 Dress`                                     -> one-piece
 *
 * One judgement call: "Navy Batik Folk-Art Kaftan Kurti" is named a kaftan but
 * packaged as `1 Kurti`, so it is filed as a kurti.
 */
const PRODUCTS: ProductSeed[] = [
  // ---- Kurti (11) ----
  {
    slug: 'maroon-kalamkari-panel-straight-kurti',
    name: 'Maroon Kalamkari Panel Straight Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.KALANKARI,
    pricePaise: 119900,
    compareAtPricePaise: 149900,
    garmentLengthCm: 110,
    colours: ['Maroon'],
    description:
      'Rich maroon straight kurta with a hand-crafted Kalamkari-style patch panel down the front, framed with zigzag borders. Round neck, three-quarter sleeves with contrast cuffs, calf-length straight fit.',
  },
  {
    slug: 'teal-blue-kalamkari-patchwork-kurti',
    name: 'Teal Blue Kalamkari Patchwork Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.KALANKARI,
    pricePaise: 109900,
    compareAtPricePaise: 139900,
    garmentLengthCm: 120,
    colours: ['Teal Blue'],
    description:
      'Asymmetric Kalamkari-style patchwork panels in rust, mustard and off-white across the front. V-neckline with contrast embroidered border, patch cuffs, ankle-length straight fit with side slits.',
  },
  {
    slug: 'mustard-yellow-floral-printed-kurta',
    name: 'Mustard Yellow Floral Printed Kurta',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 89900,
    compareAtPricePaise: null,
    garmentLengthCm: 120,
    colours: ['Mustard Yellow'],
    description:
      'All-over multicolour floral print in soft pink, mint and lavender. V-neckline and cuffs trimmed with white lace, full sleeves, flowy ankle-length straight fit with side slits.',
  },
  {
    slug: 'mustard-embroidered-angrakha-kurti',
    name: 'Mustard Embroidered Angrakha Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 99900,
    compareAtPricePaise: 129900,
    garmentLengthCm: 105,
    colours: ['Mustard Green'],
    description:
      'Angrakha-style wrap kurta in mustard-green with white medallion embroidery, closing with a side tassel tie. White lace trims the neckline, wrap edge and cuffs.',
  },
  {
    slug: 'purple-lotus-v-yoke-kurti',
    name: 'Purple Lotus V-Yoke Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 104900,
    compareAtPricePaise: null,
    garmentLengthCm: 120,
    colours: ['Cream'],
    description:
      'Long kurti on a cream base with purple vine and golden lotus print. Crimson perforated V-yoke trimmed with white lace, contrast red cuffs and hem edging.',
  },
  {
    slug: 'burnt-orange-patchwork-kurti',
    name: 'Burnt Orange Patchwork Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.APLIK,
    pricePaise: 94900,
    compareAtPricePaise: null,
    garmentLengthCm: 95,
    colours: ['Burnt Orange'],
    description:
      'Handloom cotton kurta with a multi-coloured geometric patchwork yoke edged in tribal-style trim, and a matching button-closed patch pocket. Knee-length with side slits.',
  },
  {
    slug: 'teal-floral-center-panel-kurti',
    name: 'Teal Floral Center-Panel Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 92900,
    compareAtPricePaise: 119900,
    garmentLengthCm: 120,
    colours: ['Teal'],
    description:
      'Ikat leaf print across the body with a contrasting off-white centre panel carrying a hand-block floral vine, trimmed in scalloped white lace. Dark olive cuffs, round neck, ankle-length.',
  },
  {
    slug: 'navy-batik-folk-art-kaftan-kurti',
    name: 'Navy Batik Folk-Art Kaftan Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.BATIK,
    pricePaise: 114900,
    compareAtPricePaise: null,
    garmentLengthCm: 105,
    colours: ['Navy Blue'],
    description:
      'Kaftan-style kurti with a hand-painted batik folk figure at the front framed by white dot and flame motifs. Half sleeves and back in a blue-and-black batik crackle print, V-neck, relaxed fit.',
  },
  {
    slug: 'fusion-peacock-fish-print-tunic',
    name: 'Fusion Peacock & Fish Print Tunic',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.APLIK,
    pricePaise: 97900,
    compareAtPricePaise: null,
    garmentLengthCm: 120,
    colours: ['Green'],
    description:
      'Green tunic with a cream centre panel in a fine fish-motif print and a woven red-and-black border. A circular black patch at the chest holds a hand-embroidered peacock pair.',
  },
  {
    slug: 'lime-green-bengali-text-embroidered-kurti',
    name: 'Lime Green Bengali Text-Embroidered Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.APLIK,
    pricePaise: 101900,
    compareAtPricePaise: null,
    garmentLengthCm: 105,
    colours: ['Lime Green'],
    description:
      'Solid lime green kurti with a red Bengali folk verse embroidered down the front and a hand-appliqued ektara motif in black and red, alongside a vertical row of patchwork squares.',
  },
  {
    slug: 'teal-kalamkari-patchwork-peacock-kurti',
    name: 'Teal Kalamkari Patchwork Peacock Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.KALANKARI,
    pricePaise: 107900,
    compareAtPricePaise: 134900,
    garmentLengthCm: 120,
    colours: ['Teal'],
    description:
      'Rust-and-maroon Kalamkari print running diagonally from yoke to hem, with a hand-painted peacock feather motif in gold and teal at the chest. Matching print trims the cuffs.',
  },

  // ---- Two-Piece Set (8) - everything packaged with a bottom ----
  {
    slug: 'maroon-printed-cotton-kurta-palazzo-set',
    name: 'Maroon Printed Cotton Kurta and Palazzo Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 149900,
    compareAtPricePaise: 189900,
    garmentLengthCm: 105,
    colours: ['Maroon'],
    description:
      'All-over white floral print on the kurta with a white wave print on the palazzo. Round neck with tasseled front slit and lace-trimmed placket. Includes 1 kurta and 1 palazzo pant.',
  },
  {
    slug: 'sage-green-floral-kurta-pant-set',
    name: 'Sage Green Floral Printed Kurta and Pant Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 144900,
    compareAtPricePaise: null,
    garmentLengthCm: 95,
    colours: ['Sage Green'],
    description:
      'All-over multicolour floral print in pink, yellow and rust. V-neckline and cuffs trimmed with white crochet lace. Includes 1 kurta and 1 pant.',
  },
  {
    slug: 'yellow-floral-kurta-pant-set',
    name: 'Yellow Floral Printed Kurta and Pant Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 144900,
    compareAtPricePaise: null,
    garmentLengthCm: 95,
    colours: ['Yellow'],
    description:
      'All-over floral print in pink, white and green with white crochet lace at the V-neckline and cuffs. The same design as the sage green set in an alternate colourway. Includes 1 kurta and 1 pant.',
  },
  {
    slug: 'cerulean-blue-kalamkari-kurta-set',
    name: 'Cerulean Blue Kalamkari Printed Kurta Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.KALANKARI,
    pricePaise: 159900,
    compareAtPricePaise: 199900,
    garmentLengthCm: 95,
    colours: ['Cerulean Blue'],
    description:
      'Solid cerulean blue kurta with a hand-painted Kalamkari yoke, pocket panels and cuffs in maroon, mustard and white floral motifs, with button and bead detail along the yoke. Includes 1 kurta and 1 pant.',
  },
  {
    slug: 'black-maroon-asymmetric-wrap-kurti-set',
    name: 'Black Maroon Asymmetric Wrap Kurti Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 154900,
    compareAtPricePaise: null,
    garmentLengthCm: 105,
    colours: ['Black'],
    description:
      'Maroon asymmetric wrap panel edged with a grey geometric hand-block border and a tasseled side tie, over a black body scattered with grey booti dots. Includes 1 kurti and 1 pant.',
  },
  {
    slug: 'ivory-ikat-mirror-work-wrap-kurti-set',
    name: 'Ivory Ikat Mirror-Work Wrap Kurti Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 169900,
    compareAtPricePaise: 209900,
    garmentLengthCm: 120,
    colours: ['Ivory'],
    description:
      'Chevron ikat weave finished with a wrap-style V-neck bordered in mirror-work and cream embroidery, with scattered booti motifs and tasseled ties. Includes 1 kurti and 1 pant.',
  },
  {
    slug: 'red-batik-folk-motif-kurta-legging-set',
    name: 'Red Batik Folk-Motif Kurta & Legging Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.BATIK,
    pricePaise: 139900,
    compareAtPricePaise: 174900,
    garmentLengthCm: 95,
    colours: ['Red'],
    description:
      'Hand-painted batik folk figure at the front framed by flame and dot motifs, with a bead-trimmed V-neck, mustard batik-print sleeves and a matching hem border. Includes 1 kurta and 1 legging.',
  },
  {
    slug: 'red-handloom-cotton-kurti-pajama-set',
    name: 'Red Handloom Cotton Kurti-Pajama Set',
    categorySlug: 'two-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 134900,
    compareAtPricePaise: null,
    garmentLengthCm: 120,
    colours: ['Red'],
    description:
      'Handloom cotton with an all-over white hand-block floral and stripe print. V-neck and short-sleeve cuffs trimmed in white crochet lace. Includes 1 kurti and 1 striped pajama.',
  },

  // ---- Kaftaan (2) ----
  {
    slug: 'indigo-spiral-kaftan-dress',
    name: 'Indigo Spiral Kaftan Dress',
    categorySlug: 'kaftaans',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.BATIK,
    pricePaise: 124900,
    compareAtPricePaise: null,
    garmentLengthCm: 120,
    colours: ['Indigo Blue'],
    description:
      'Block-printed leaf pattern across body and sleeves with a central geometric panel of concentric spiral-eye motifs front and back. Drawstring ties with tassels at the side seams.',
  },
  {
    slug: 'purple-hand-embroidered-kaftan-tunic',
    name: 'Purple Hand-Embroidered Kaftan Tunic',
    categorySlug: 'kaftaans',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.APLIK,
    pricePaise: 129900,
    compareAtPricePaise: 159900,
    garmentLengthCm: 95,
    colours: ['Plum Purple'],
    description:
      'Plum-purple kaftan tunic with hand-embroidered floral motifs in gold, green and white across a diamond-trellis yoke. Rust block-print kimono sleeves and an adjustable waist drawstring.',
  },

  // ---- One-Piece (1) ----
  {
    slug: 'magenta-ikat-print-sleeveless-dress',
    name: 'Magenta Ikat Print Sleeveless Dress',
    categorySlug: 'one-piece',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 99900,
    compareAtPricePaise: null,
    garmentLengthCm: 95,
    colours: ['Magenta'],
    description:
      'Sleeveless dress in magenta with an all-over white zigzag ikat print. Wrap-style V-neck closing with a white tassel tie, edged with bead and ring embellishments.',
  },

  // ---- Leggings (1 product, 9 colourways, free size) ----
  {
    slug: 'lyra-premium-churidar-legging',
    name: 'Lyra Premium Churidar Legging',
    categorySlug: 'leggings',
    brandSlug: 'lyra',
    // The only stretch garment in the catalogue: a 4-way stretch cotton blend.
    fabricType: FabricType.STRETCH,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 39900,
    compareAtPricePaise: 49900,
    garmentLengthCm: 95,
    // One product, nine colourways. They are the same garment; nine products
    // would put nine near-identical cards in the grid and scatter one SKU
    // family across nine PDPs.
    colours: [
      'Bright Blue',
      'Deep Maroon',
      'Red',
      'White',
      'Bright Aqua Blue',
      'Mustard Yellow',
      'Vibrant Purple',
      'True Black',
      'Lavender Purple',
    ],
    isFreeSize: true,
    description:
      'Churidar-style legging in a 4-way stretch cotton blend, fitted through the leg and gathered at the ankle. Soft, breathable and fade-resistant. Free size fits a standard adult range.',
  },
];

async function seedCategories(ds: DataSource): Promise<Map<string, string>> {
  const repo = ds.getRepository(Category);
  await repo.upsert(
    CATEGORIES.map((c) => ({ ...c, sizes: c.sizes ?? DEFAULT_SIZE_BAND, isActive: true })),
    ['slug'],
  );

  const rows = await repo.find();
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function seedBrands(ds: DataSource): Promise<Map<string, string>> {
  const repo = ds.getRepository(Brand);
  await repo.upsert(
    BRANDS.map((b) => ({ ...b, isActive: true })),
    ['slug'],
  );

  const rows = await repo.find();
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function seedProducts(
  ds: DataSource,
  categoryIds: Map<string, string>,
  brandIds: Map<string, string>,
): Promise<number> {
  const productRepo = ds.getRepository(Product);
  const variantRepo = ds.getRepository(ProductVariant);

  await productRepo.upsert(
    PRODUCTS.map((p) => {
      const categoryId = categoryIds.get(p.categorySlug);
      const brandId = brandIds.get(p.brandSlug);
      if (!categoryId || !brandId) {
        throw new Error(
          `Product "${p.slug}" references unknown category "${p.categorySlug}" or brand "${p.brandSlug}"`,
        );
      }

      return {
        slug: p.slug,
        name: p.name,
        description: p.description,
        categoryId,
        brandId,
        pricePaise: p.pricePaise,
        compareAtPricePaise: p.compareAtPricePaise,
        fabricType: p.fabricType,
        printTechnique: p.printTechnique,
        // The chart is derived from the fabric, never hand-written per product —
        // that is what keeps stretch and rigid guidance consistent catalogue-wide.
        isFreeSize: p.isFreeSize ?? false,
        // Null for free size: a measurement chart implies a choice between
        // sizes, and there is none. Otherwise charted over the *category's*
        // band, so a Blouse gets 32-36 rather than the garment default.
        sizeRules: p.isFreeSize
          ? null
          : buildSizeChart(p.fabricType, p.garmentLengthCm, bandFor(p.categorySlug)),
        isActive: true,
      };
    }),
    ['slug'],
  );

  const products = await productRepo.find();
  const productIdBySlug = new Map(products.map((p) => [p.slug, p.id]));

  const variants = PRODUCTS.flatMap((p) => {
    const productId = productIdBySlug.get(p.slug);
    if (!productId) {
      throw new Error(`Product "${p.slug}" was not persisted`);
    }

    // Free size is one variant per colour. The stored `nominalSize` is the
    // placeholder documented in `AddFreeSizeProducts` — a NOT NULL artefact,
    // never shown, and the trigger rejects a second one.
    const sizes = p.isFreeSize ? [FREE_SIZE_PLACEHOLDER] : bandFor(p.categorySlug);

    return p.colours.flatMap((colour) =>
      sizes.map((nominalSize) => ({
        productId,
        sku: `${p.slug}-${colour}-${nominalSize}`.toUpperCase().replace(/ /g, ''),
        nominalSize,
        colour,
        pricePaise: null,
        stockQuantity: 25,
        isActive: true,
      })),
    );
  });

  await variantRepo.upsert(variants, ['sku']);

  return variants.length;
}

export async function runSeeds(ds: DataSource): Promise<void> {
  const categoryIds = await seedCategories(ds);
  console.log(`  categories: ${categoryIds.size}`);

  const brandIds = await seedBrands(ds);
  console.log(`  brands:     ${brandIds.size}`);

  const variantCount = await seedProducts(ds, categoryIds, brandIds);
  console.log(`  products:   ${PRODUCTS.length}`);
  console.log(`  variants:   ${variantCount}`);
}

async function main(): Promise<void> {
  const ds = await AppDataSource.initialize();
  console.log('Seeding Adorini reference data...');

  try {
    await runSeeds(ds);
    console.log('Seeding complete.');
  } finally {
    await ds.destroy();
  }
}

// Only self-execute when invoked directly (`npm run seed`), so tests can import
// `runSeeds` without the process tearing down the connection underneath them.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}
