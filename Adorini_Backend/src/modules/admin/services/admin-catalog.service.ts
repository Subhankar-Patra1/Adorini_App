import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { Brand } from '../../../database/entities/brand.entity';
import { Category } from '../../../database/entities/category.entity';
import { MediaAsset } from '../../../database/entities/media-asset.entity';
import { Product } from '../../../database/entities/product.entity';
import { ProductVariant } from '../../../database/entities/product-variant.entity';
import { SizeEnquiry } from '../../../database/entities/size-enquiry.entity';
import { sizeRulesSchema } from '../../../common/schemas/size-rules.schema';
import { MediaProvenance, MediaType } from '../../../common/enums/domain.enums';
import type { FabricType, SizeEnquiryStatus } from '../../../common/enums/domain.enums';
import type { Env } from '../../../config/env.validation';
import { StorageService } from '../../../providers/storage/storage.service';
import type {
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
} from '../dto/admin.dto';

const PG_UNIQUE_VIOLATION = '23505';

/** Kept in step with the same map in `PdpService` — the two never need to agree with each other, only with what they each actually name their own objects. */
const MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variants: Repository<ProductVariant>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Brand) private readonly brands: Repository<Brand>,
    @InjectRepository(SizeEnquiry) private readonly enquiries: Repository<SizeEnquiry>,
    @InjectRepository(MediaAsset) private readonly media: Repository<MediaAsset>,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async listProducts(includeInactive: boolean, limit: number, offset: number) {
    const rows = await this.products.find({
      where: includeInactive ? {} : { isActive: true },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    if (rows.length === 0) {
      return [];
    }

    // Grouped count rather than one query per product — the admin list is
    // exactly where an N+1 becomes a visibly slow page.
    const counts = await this.variants
      .createQueryBuilder('variant')
      .select('variant.product_id', 'productId')
      .addSelect('COUNT(*)', 'total')
      .where('variant.product_id IN (:...ids)', { ids: rows.map((r) => r.id) })
      .groupBy('variant.product_id')
      .getRawMany<{ productId: string; total: string }>();

    const countByProduct = new Map(counts.map((c) => [c.productId, Number(c.total)]));

    return rows.map((product) => this.toAdminProduct(product, countByProduct.get(product.id) ?? 0));
  }

  async createProduct(dto: CreateProductDto) {
    await this.assertCategoryAndBrandExist(dto.categoryId, dto.brandId);
    this.assertSizeRulesMatchFabric(dto.sizeRules ?? null, dto.fabricType);

    try {
      const saved = await this.products.save(
        this.products.create({
          ...dto,
          description: dto.description ?? null,
          compareAtPricePaise: dto.compareAtPricePaise ?? null,
          printTechnique: dto.printTechnique ?? null,
          sizeRules: dto.sizeRules ?? null,
        }),
      );

      this.logger.log(`Product created: ${saved.slug}`);
      return this.toAdminProduct(saved, 0);
    } catch (error) {
      throw this.translateUniqueViolation(error, 'A product with that slug already exists');
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const product = await this.products.findOne({ where: { id } });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (dto.categoryId || dto.brandId) {
      await this.assertCategoryAndBrandExist(
        dto.categoryId ?? product.categoryId,
        dto.brandId ?? product.brandId,
      );
    }

    // Validated against whichever fabric the product will have *after* this
    // update, not the one it had before.
    if (dto.sizeRules !== undefined) {
      this.assertSizeRulesMatchFabric(dto.sizeRules ?? null, dto.fabricType ?? product.fabricType);
    } else if (dto.fabricType && product.sizeRules) {
      // Changing the fabric alone would silently leave a chart describing the
      // old one — and the chart is the whole returns-reduction mechanism.
      this.assertSizeRulesMatchFabric(product.sizeRules, dto.fabricType);
    }

    Object.assign(product, dto);

    try {
      const saved = await this.products.save(product);
      const variantCount = await this.variants.countBy({ productId: saved.id });
      return this.toAdminProduct(saved, variantCount);
    } catch (error) {
      throw this.translateUniqueViolation(error, 'A product with that slug already exists');
    }
  }

  async listVariants(productId: string) {
    await this.requireProduct(productId);

    const rows = await this.variants.find({
      where: { productId },
      order: { nominalSize: 'ASC', colour: 'ASC' },
    });

    return rows.map((variant) => this.toAdminVariant(variant));
  }

  async createVariant(dto: CreateVariantDto) {
    await this.requireProduct(dto.productId);

    try {
      const saved = await this.variants.save(
        this.variants.create({
          ...dto,
          pricePaise: dto.pricePaise ?? null,
        }),
      );

      return this.toAdminVariant(saved);
    } catch (error) {
      throw this.translateUniqueViolation(
        error,
        'That SKU, or that size/colour for this product, already exists',
      );
    }
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    const variant = await this.variants.findOne({ where: { id } });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    Object.assign(variant, dto);

    try {
      return this.toAdminVariant(await this.variants.save(variant));
    } catch (error) {
      throw this.translateUniqueViolation(
        error,
        'That SKU, or that size/colour for this product, already exists',
      );
    }
  }

  /**
   * Categories/brands with their real ids, for the product-creation form.
   *
   * The public `GET /catalog/categories`/`brands` deliberately only ever
   * return `slug` — the storefront has no use for the id, and there is no
   * reason to hand it out to anyone who doesn't need it. `POST /admin/products`
   * needs the actual UUID, so admin gets its own read of the same tables.
   * Includes inactive rows, same as every other admin listing.
   */
  async listCategoriesForAdmin() {
    const rows = await this.categories.find({ order: { displayOrder: 'ASC' } });
    return rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, isActive: c.isActive }));
  }

  async listBrandsForAdmin() {
    const rows = await this.brands.find({ order: { displayOrder: 'ASC' } });
    return rows.map((b) => ({ id: b.id, slug: b.slug, name: b.name, isActive: b.isActive }));
  }

  /**
   * Attaches admin-curated gallery images to a product.
   *
   * `startIndex` is the count of media already on the product, not a fixed 0 —
   * a second call appends rather than overwriting the `displayOrder: 0` row,
   * which is the one `CatalogService.listProducts` reads as the catalog
   * thumbnail (`catalog.service.ts`). For a brand-new product this is always
   * 0, so the first image uploaded here is what buyers see in the catalog.
   */
  async attachProductMedia(productId: string, files: Express.Multer.File[]) {
    await this.requireProduct(productId);

    if (files.length === 0) {
      return [];
    }

    const startIndex = await this.media.countBy({ productId });

    const uploaded = await Promise.all(
      files.map(async (file, index) => {
        const extension = MEDIA_MIME_EXTENSIONS[file.mimetype] ?? 'jpg';
        const objectKey = `products/${productId}/${startIndex + index}.${extension}`;
        await this.storage.uploadFile(objectKey, file.buffer, file.mimetype);

        return this.media.create({
          productId,
          objectKey,
          type: MediaType.IMAGE,
          provenance: MediaProvenance.ADMIN,
          uploadedByUserId: null,
          reviewId: null,
          displayOrder: startIndex + index,
        });
      }),
    );

    const saved = await this.media.save(uploaded);
    return saved.map((m) => this.toAdminMedia(m));
  }

  /** The custom-size enquiry inbox — demand data as much as a support queue. */
  async listEnquiries(status: SizeEnquiryStatus | undefined, limit: number, offset: number) {
    const rows = await this.enquiries.find({
      where: status ? { status } : {},
      relations: { product: true },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return rows.map((enquiry) => ({
      id: enquiry.id,
      productId: enquiry.productId,
      productName: enquiry.product?.name ?? 'Unknown product',
      requestedSize: enquiry.requestedSize,
      contactPhone: enquiry.contactPhone,
      message: enquiry.message,
      status: enquiry.status,
      adminResponse: enquiry.adminResponse,
      createdAt: enquiry.createdAt.toISOString(),
    }));
  }

  async respondToEnquiry(id: string, status: SizeEnquiryStatus, adminResponse?: string | null) {
    const enquiry = await this.enquiries.findOne({
      where: { id },
      relations: { product: true },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    enquiry.status = status;
    if (adminResponse !== undefined) {
      enquiry.adminResponse = adminResponse;
    }

    const saved = await this.enquiries.save(enquiry);

    return {
      id: saved.id,
      productId: saved.productId,
      productName: enquiry.product?.name ?? 'Unknown product',
      requestedSize: saved.requestedSize,
      contactPhone: saved.contactPhone,
      message: saved.message,
      status: saved.status,
      adminResponse: saved.adminResponse,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  // ---- internals ----

  /**
   * @GUARD Risk #5 (MEDIUM): `size_rules` is validated on write and malformed
   * charts are rejected, never persisted.
   *
   * The Zod schema (shared with the seeds and the PDP) already covers ordering,
   * duplicate sizes and the 40–48 band. What it cannot check on its own is
   * agreement with the product's `fabric_type`, since that lives on a different
   * column — and a stretch chart attached to a rigid garment is precisely the
   * mistake that sends a buyer the wrong size and produces the return this
   * feature exists to prevent.
   */
  private assertSizeRulesMatchFabric(sizeRules: unknown, fabricType: FabricType): void {
    if (sizeRules === null || sizeRules === undefined) {
      return;
    }

    const parsed = sizeRulesSchema.safeParse(sizeRules);

    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_SIZE_RULES',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'sizeRules'}: ${issue.message}`)
          .join('; '),
      });
    }

    if (parsed.data.fabricType !== fabricType) {
      throw new BadRequestException({
        code: 'SIZE_RULES_FABRIC_MISMATCH',
        message: `The size chart is for ${parsed.data.fabricType} fabric but the product is ${fabricType}.`,
      });
    }
  }

  private async assertCategoryAndBrandExist(categoryId: string, brandId: string): Promise<void> {
    const [categoryCount, brandCount] = await Promise.all([
      this.categories.countBy({ id: categoryId }),
      this.brands.countBy({ id: brandId }),
    ]);

    if (categoryCount === 0) {
      throw new BadRequestException('Unknown category');
    }
    if (brandCount === 0) {
      throw new BadRequestException('Unknown brand');
    }
  }

  private async requireProduct(productId: string): Promise<Product> {
    const product = await this.products.findOne({ where: { id: productId } });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private translateUniqueViolation(error: unknown, message: string): unknown {
    if (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
    ) {
      // Named specifically so an admin knows which field collided, rather than
      // getting the filter's generic "that value is already in use".
      return new ConflictException(message);
    }

    return error;
  }

  private toAdminProduct(product: Product, variantCount: number) {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId,
      brandId: product.brandId,
      pricePaise: product.pricePaise,
      compareAtPricePaise: product.compareAtPricePaise,
      fabricType: product.fabricType,
      printTechnique: product.printTechnique,
      isActive: product.isActive,
      hasSizeChart: product.sizeRules !== null,
      variantCount,
    };
  }

  private toAdminVariant(variant: ProductVariant) {
    return {
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      nominalSize: variant.nominalSize,
      colour: variant.colour,
      pricePaise: variant.pricePaise,
      stockQuantity: variant.stockQuantity,
      isActive: variant.isActive,
    };
  }

  private toAdminMedia(media: MediaAsset) {
    return {
      id: media.id,
      url: this.toPublicUrl(media.objectKey),
      displayOrder: media.displayOrder,
    };
  }

  private toPublicUrl(objectKey: string): string {
    const base = this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
    return `${base.replace(/\/$/, '')}/${objectKey}`;
  }
}
