import '../../../core/constants/domain_enums.dart';

/// `productSummarySchema` — the thin catalog grid projection.
/// Full detail is the PDP module's job.
class ProductSummary {
  const ProductSummary({
    required this.id,
    required this.slug,
    required this.name,
    required this.pricePaise,
    required this.fabricType,
    required this.categorySlug,
    required this.brandSlug,
    this.compareAtPricePaise,
    this.printTechnique,
    this.thumbnailUrl,
  });

  factory ProductSummary.fromJson(Map<String, dynamic> json) {
    return ProductSummary(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      pricePaise: json['pricePaise'] as int,
      compareAtPricePaise: json['compareAtPricePaise'] as int?,
      fabricType: FabricType.fromWire(json['fabricType'] as String),
      printTechnique: PrintTechnique.fromWire(json['printTechnique'] as String?),
      categorySlug: json['categorySlug'] as String,
      brandSlug: json['brandSlug'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String?,
    );
  }

  final String id;
  final String slug;
  final String name;
  final int pricePaise;
  final int? compareAtPricePaise;
  final FabricType fabricType;
  final PrintTechnique? printTechnique;
  final String categorySlug;
  final String brandSlug;
  final String? thumbnailUrl;

  bool get isDiscounted =>
      compareAtPricePaise != null && compareAtPricePaise! > pricePaise;
}

/// One page of a cursor-paginated product list.
class ProductPage {
  const ProductPage({required this.items, this.nextCursor});

  factory ProductPage.fromJson(Map<String, dynamic> json) {
    return ProductPage(
      items: (json['items'] as List<dynamic>)
          .map((dynamic e) => ProductSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<ProductSummary> items;

  /// `null` means this was the last page.
  final String? nextCursor;

  bool get hasMore => nextCursor != null;
}

class Category {
  const Category({required this.slug, required this.name});

  factory Category.fromJson(Map<String, dynamic> json) =>
      Category(slug: json['slug'] as String, name: json['name'] as String);

  final String slug;
  final String name;
}

class Brand {
  const Brand({required this.slug, required this.name});

  factory Brand.fromJson(Map<String, dynamic> json) =>
      Brand(slug: json['slug'] as String, name: json['name'] as String);

  final String slug;
  final String name;
}
