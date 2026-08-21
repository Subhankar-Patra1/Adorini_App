import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:http_parser/http_parser.dart';

import '../../core/constants/api_constants.dart';

class AdminCategory {
  const AdminCategory({
    required this.id,
    required this.slug,
    required this.name,
    required this.isActive,
  });

  factory AdminCategory.fromJson(Map<String, dynamic> json) {
    return AdminCategory(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      isActive: json['isActive'] as bool,
    );
  }

  final String id;
  final String slug;
  final String name;
  final bool isActive;
}

class AdminBrand {
  const AdminBrand({
    required this.id,
    required this.slug,
    required this.name,
    required this.isActive,
  });

  factory AdminBrand.fromJson(Map<String, dynamic> json) {
    return AdminBrand(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      isActive: json['isActive'] as bool,
    );
  }

  final String id;
  final String slug;
  final String name;
  final bool isActive;
}

class AdminProduct {
  const AdminProduct({required this.id, required this.slug, required this.name});

  factory AdminProduct.fromJson(Map<String, dynamic> json) {
    return AdminProduct(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
    );
  }

  final String id;
  final String slug;
  final String name;
}

/// One image the caller selected to upload, already read into memory —
/// `file_picker` hands back bytes directly, no separate File I/O step.
class PickedImage {
  const PickedImage({required this.bytes, required this.filename, required this.mimeType});

  final Uint8List bytes;
  final String filename;
  final String mimeType;
}

/// A size/colour line the caller is adding alongside the product.
class VariantInput {
  const VariantInput({
    required this.sku,
    required this.nominalSize,
    required this.colour,
    required this.stockQuantity,
    this.pricePaise,
  });

  final String sku;
  final int nominalSize;
  final String colour;
  final int stockQuantity;
  final int? pricePaise;
}

/// Talks to `AdminCatalogController` (`src/modules/admin/`). Every call here
/// requires the signed-in account to have `isAdmin: true` — enforced
/// server-side by `AdminGuard`, not checked client-side.
class AdminCatalogApi {
  AdminCatalogApi(this._dio);

  final Dio _dio;

  /// Used as the "is this account actually staff?" probe right after login —
  /// any admin route works for this, this one is just the cheapest.
  Future<void> assertAdmin() async {
    await _dio.get<dynamic>(ApiConstants.adminProducts, queryParameters: <String, int>{'limit': 1});
  }

  Future<List<AdminCategory>> listCategories() async {
    final Response<List<dynamic>> response = await _dio.get<List<dynamic>>(
      ApiConstants.adminCategories,
    );
    return response.data!
        .map((dynamic json) => AdminCategory.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  Future<List<AdminBrand>> listBrands() async {
    final Response<List<dynamic>> response = await _dio.get<List<dynamic>>(
      ApiConstants.adminBrands,
    );
    return response.data!
        .map((dynamic json) => AdminBrand.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  Future<AdminProduct> createProduct({
    required String slug,
    required String name,
    String? description,
    required String categoryId,
    required String brandId,
    required int pricePaise,
    int? compareAtPricePaise,
    required String fabricType,
    String? printTechnique,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.adminProducts,
      data: <String, dynamic>{
        'slug': slug,
        'name': name,
        if (description != null && description.isNotEmpty) 'description': description,
        'categoryId': categoryId,
        'brandId': brandId,
        'pricePaise': pricePaise,
        if (compareAtPricePaise != null) 'compareAtPricePaise': compareAtPricePaise,
        'fabricType': fabricType,
        if (printTechnique != null) 'printTechnique': printTechnique,
      },
    );
    return AdminProduct.fromJson(response.data!);
  }

  Future<void> createVariant(String productId, VariantInput variant) async {
    await _dio.post<Map<String, dynamic>>(
      ApiConstants.adminVariants,
      data: <String, dynamic>{
        'productId': productId,
        'sku': variant.sku,
        'nominalSize': variant.nominalSize,
        'colour': variant.colour,
        'stockQuantity': variant.stockQuantity,
        if (variant.pricePaise != null) 'pricePaise': variant.pricePaise,
      },
    );
  }

  /// Uploads gallery images for a product, in list order — the first image
  /// ever uploaded for a product becomes its catalog thumbnail
  /// (`AdminCatalogService.attachProductMedia`, `displayOrder: 0`).
  Future<void> uploadProductMedia(String productId, List<PickedImage> images) async {
    if (images.isEmpty) return;

    final FormData form = FormData();
    for (final PickedImage image in images) {
      form.files.add(
        MapEntry<String, MultipartFile>(
          'images',
          MultipartFile.fromBytes(
            image.bytes,
            filename: image.filename,
            contentType: MediaType.parse(image.mimeType),
          ),
        ),
      );
    }

    await _dio.post<List<dynamic>>(ApiConstants.adminProductMedia(productId), data: form);
  }
}
