import 'reflect-metadata';
import type { DataSource } from 'typeorm';

import { AppDataSource } from '../data-source';
import { Brand, Category, Product, ProductVariant } from '../entities';
import { buildSizeChart, NOMINAL_SIZES } from './size-charts';
import { FabricType, PrintTechnique } from '../../common/enums/domain.enums';

/**
 * Reference data for local development and fresh environments.
 *
 * Every seed is an upsert keyed on a natural unique column (`slug`, `sku`), so
 * running this repeatedly converges rather than erroring or duplicating. A seed
 * that can only be run once is a seed nobody runs.
 */

const CATEGORIES = [
  {
    slug: 'kurtis',
    name: 'Kurtis',
    displayOrder: 1,
    description: 'Everyday and occasion kurtis in traditional prints.',
  },
  {
    slug: 'two-piece-suit-sets',
    name: 'Two-Piece Suit Sets',
    displayOrder: 2,
    description: 'Kurta and bottom pairings.',
  },
  {
    slug: 'three-piece-suit-sets',
    name: 'Three-Piece Suit Sets',
    displayOrder: 3,
    description: 'Kurta, bottom and dupatta sets.',
  },
  {
    slug: 'blouses',
    name: 'Blouses',
    displayOrder: 4,
    description: 'Saree blouses, stitched and ready to wear.',
  },
  {
    slug: 'petticoats',
    name: 'Petticoats',
    displayOrder: 5,
    description: 'Cotton and satin petticoats.',
  },
  {
    slug: 'leggings',
    name: 'Leggings',
    displayOrder: 6,
    description: 'Ankle-length leggings in cotton and stretch blends.',
  },
  {
    slug: 'palazzos',
    name: 'Palazzos',
    displayOrder: 7,
    description: 'Wide-leg flowy palazzo pants.',
  },
  {
    slug: 'straight-pencil-pants',
    name: 'Straight/Pencil Pants',
    displayOrder: 8,
    description: 'Straight-fit and pencil-fit bottoms.',
  },
  {
    slug: 'one-piece',
    name: 'One-Piece',
    displayOrder: 9,
    description: 'Single-piece dresses and gowns.',
  },
  {
    slug: 'kaftaans',
    name: 'Kaftaans',
    displayOrder: 10,
    description: 'Loose-fit flowy kaftaans.',
  },
];

const BRANDS = [
  { slug: 'sana', name: 'sana', displayOrder: 1 },
  { slug: 'mg', name: 'mg', displayOrder: 2 },
  { slug: 'mm', name: 'mm', displayOrder: 3 },
  { slug: 'navranga', name: 'NAVRANGA', displayOrder: 4 },
];

/**
 * Products chosen to cover both fit archetypes across the price band
 * (₹300–1,500), so the PDP's dynamic size chart has something real to render on
 * either branch.
 */
const PRODUCTS = [
  {
    slug: 'kalankari-cotton-straight-kurti',
    name: 'Kalankari Cotton Straight Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'sana',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.KALANKARI,
    pricePaise: 89900,
    compareAtPricePaise: 129900,
    garmentLengthCm: 110,
    colours: ['Indigo', 'Rust'],
    description: 'Hand-block Kalankari print on rigid cotton. True to size with no stretch.',
  },
  {
    slug: 'ajrak-viscose-stretch-kurti',
    name: 'Ajrak Viscose Stretch Kurti',
    categorySlug: 'kurtis',
    brandSlug: 'mg',
    fabricType: FabricType.STRETCH,
    printTechnique: PrintTechnique.AJRAK,
    pricePaise: 74900,
    compareAtPricePaise: 99900,
    garmentLengthCm: 108,
    colours: ['Maroon', 'Teal'],
    description: 'Ajrak print on stretch viscose blend with up to 6cm of give.',
  },
  {
    slug: 'batik-three-piece-suit-set',
    name: 'Batik Three-Piece Suit Set',
    categorySlug: 'three-piece-suit-sets',
    brandSlug: 'navranga',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.BATIK,
    pricePaise: 149900,
    compareAtPricePaise: null,
    garmentLengthCm: 112,
    colours: ['Mustard'],
    description: 'Batik-dyed kurta, bottom and dupatta in rigid cotton.',
  },
  {
    slug: 'aplik-stretch-saree-blouse',
    name: 'Aplik Stretch Saree Blouse',
    categorySlug: 'blouses',
    brandSlug: 'mm',
    fabricType: FabricType.STRETCH,
    printTechnique: PrintTechnique.APLIK,
    pricePaise: 39900,
    compareAtPricePaise: 54900,
    garmentLengthCm: 38,
    colours: ['Black', 'Gold'],
    description: 'Aplik work on stretch lycra blend. Ready to wear.',
  },
  {
    slug: 'fancy-cotton-petticoat',
    name: 'Fancy Cotton Petticoat',
    categorySlug: 'petticoats',
    brandSlug: 'sana',
    fabricType: FabricType.RIGID,
    printTechnique: PrintTechnique.FANCY,
    pricePaise: 32900,
    compareAtPricePaise: null,
    garmentLengthCm: 100,
    colours: ['White', 'Beige'],
    description: 'Plain cotton petticoat with drawstring waist.',
  },
];

async function seedCategories(ds: DataSource): Promise<Map<string, string>> {
  const repo = ds.getRepository(Category);
  await repo.upsert(
    CATEGORIES.map((c) => ({ ...c, isActive: true })),
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
        sizeRules: buildSizeChart(p.fabricType, p.garmentLengthCm),
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

    return p.colours.flatMap((colour) =>
      NOMINAL_SIZES.map((nominalSize) => ({
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
