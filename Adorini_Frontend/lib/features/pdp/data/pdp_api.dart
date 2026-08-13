import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';

/// A gallery item. [isOfficial] is the trust signal the whole product is built
/// around — official and buyer media arrive in separate arrays precisely so a
/// client cannot render a buyer photo under the "Official Media" badge.
class MediaItem {
  const MediaItem({
    required this.id,
    required this.url,
    required this.type,
    required this.isOfficial,
    this.altText,
  });

  factory MediaItem.fromJson(Map<String, dynamic> json) {
    return MediaItem(
      id: json['id'] as String,
      url: json['url'] as String,
      type: MediaType.fromWire(json['type'] as String),
      altText: json['altText'] as String?,
      isOfficial: json['isOfficial'] as bool,
    );
  }

  final String id;
  final String url;
  final MediaType type;
  final String? altText;
  final bool isOfficial;
}

/// A buyable size/colour combination. The cart takes [id] as its `variantId` —
/// never the product id.
class ProductVariant {
  const ProductVariant({
    required this.id,
    required this.sku,
    required this.nominalSize,
    required this.colour,
    required this.pricePaise,
    required this.stockQuantity,
    required this.inStock,
  });

  factory ProductVariant.fromJson(Map<String, dynamic> json) {
    return ProductVariant(
      id: json['id'] as String,
      sku: json['sku'] as String,
      nominalSize: json['nominalSize'] as int,
      colour: json['colour'] as String,
      pricePaise: json['pricePaise'] as int,
      stockQuantity: json['stockQuantity'] as int,
      inStock: json['inStock'] as bool,
    );
  }

  final String id;
  final String sku;
  final int nominalSize;
  final String colour;
  final int pricePaise;
  final int stockQuantity;
  final bool inStock;
}

class ReviewSummary {
  const ReviewSummary({
    required this.totalCount,
    required this.ratingCounts,
    required this.fitTagCounts,
    this.averageRating,
  });

  factory ReviewSummary.fromJson(Map<String, dynamic> json) {
    return ReviewSummary(
      totalCount: json['totalCount'] as int,
      // Null rather than 0 when there are no reviews — 0.0 stars reads as a
      // bad product rather than an unreviewed one.
      averageRating: (json['averageRating'] as num?)?.toDouble(),
      ratingCounts: (json['ratingCounts'] as Map<String, dynamic>? ?? <String, dynamic>{})
          .map((String k, dynamic v) => MapEntry<String, int>(k, v as int)),
      fitTagCounts: (json['fitTagCounts'] as Map<String, dynamic>? ?? <String, dynamic>{})
          .map((String k, dynamic v) => MapEntry<String, int>(k, v as int)),
    );
  }

  final int totalCount;
  final double? averageRating;
  final Map<String, int> ratingCounts;
  final Map<String, int> fitTagCounts;

  /// Powers the "most buyers say this runs small" line above the size chart.
  FitTag? get dominantFitTag {
    if (fitTagCounts.isEmpty) return null;
    final MapEntry<String, int> top =
        fitTagCounts.entries.reduce((MapEntry<String, int> a, MapEntry<String, int> b) =>
            a.value >= b.value ? a : b);
    return top.value > 0 ? FitTag.fromWire(top.key) : null;
  }
}

class ProductDetail {
  const ProductDetail({
    required this.id,
    required this.slug,
    required this.name,
    required this.pricePaise,
    required this.fabricType,
    required this.categoryName,
    required this.brandName,
    required this.variants,
    required this.availableSizes,
    required this.availableColours,
    required this.officialMedia,
    required this.buyerMedia,
    required this.reviewSummary,
    this.description,
    this.compareAtPricePaise,
    this.printTechnique,
    this.sizeChart,
  });

  factory ProductDetail.fromJson(Map<String, dynamic> json) {
    List<MediaItem> media(String key) => (json[key] as List<dynamic>? ?? <dynamic>[])
        .map((dynamic e) => MediaItem.fromJson(e as Map<String, dynamic>))
        .toList();

    return ProductDetail(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      pricePaise: json['pricePaise'] as int,
      compareAtPricePaise: json['compareAtPricePaise'] as int?,
      fabricType: FabricType.fromWire(json['fabricType'] as String),
      printTechnique: PrintTechnique.fromWire(json['printTechnique'] as String?),
      categoryName: (json['category'] as Map<String, dynamic>)['name'] as String,
      brandName: (json['brand'] as Map<String, dynamic>)['name'] as String,
      variants: (json['variants'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => ProductVariant.fromJson(e as Map<String, dynamic>))
          .toList(),
      availableSizes: (json['availableSizes'] as List<dynamic>? ?? <dynamic>[]).cast<int>(),
      availableColours: (json['availableColours'] as List<dynamic>? ?? <dynamic>[]).cast<String>(),
      officialMedia: media('officialMedia'),
      buyerMedia: media('buyerMedia'),
      // Null when the product has no chart, or a malformed one — the UI falls
      // back to the size-enquiry form.
      sizeChart: json['sizeChart'] as Map<String, dynamic>?,
      reviewSummary: ReviewSummary.fromJson(json['reviewSummary'] as Map<String, dynamic>),
    );
  }

  final String id;
  final String slug;
  final String name;
  final String? description;
  final int pricePaise;
  final int? compareAtPricePaise;
  final FabricType fabricType;
  final PrintTechnique? printTechnique;
  final String categoryName;
  final String brandName;
  final List<ProductVariant> variants;
  final List<int> availableSizes;
  final List<String> availableColours;
  final List<MediaItem> officialMedia;
  final List<MediaItem> buyerMedia;
  final Map<String, dynamic>? sizeChart;
  final ReviewSummary reviewSummary;

  bool get isDiscounted => compareAtPricePaise != null && compareAtPricePaise! > pricePaise;

  /// The variant to add to the cart for a chosen size/colour, or null if that
  /// combination is not stocked.
  ProductVariant? variantFor({required int size, String? colour}) {
    for (final ProductVariant v in variants) {
      if (v.nominalSize == size && (colour == null || v.colour == colour)) return v;
    }
    return null;
  }
}

class SizeEnquiryResult {
  const SizeEnquiryResult({required this.id, required this.requestedSize, required this.status});

  factory SizeEnquiryResult.fromJson(Map<String, dynamic> json) {
    return SizeEnquiryResult(
      id: json['id'] as String,
      requestedSize: json['requestedSize'] as String,
      status: json['status'] as String,
    );
  }

  final String id;
  final String requestedSize;
  final String status;
}

class PdpApi {
  PdpApi(this._dio);

  final Dio _dio;

  /// Keyed by **slug**, not id — `/pdp/:slug`.
  Future<ProductDetail> getProductDetail(String slug) async {
    final Response<Map<String, dynamic>> response =
        await _dio.get<Map<String, dynamic>>(ApiConstants.productDetail(slug));
    return ProductDetail.fromJson(response.data!);
  }

  /// For sizes outside the stocked 40–48 band. [requestedSize] is free text
  /// ("50", "custom 46 with longer sleeves") — that is the whole point.
  /// Works signed-out, so a contact phone is always required.
  Future<SizeEnquiryResult> createSizeEnquiry({
    required String slug,
    required String requestedSize,
    required String contactPhone,
    String? message,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.sizeEnquiry(slug),
      data: <String, String>{
        'requestedSize': requestedSize,
        'contactPhone': contactPhone,
        if (message != null && message.isNotEmpty) 'message': message,
      },
    );
    return SizeEnquiryResult.fromJson(response.data!);
  }
}
