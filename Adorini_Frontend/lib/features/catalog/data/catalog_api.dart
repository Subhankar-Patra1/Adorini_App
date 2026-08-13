import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';
import 'product_model.dart';

/// Query for `/catalog/products`.
///
/// Note [size] is a **nominal size integer** in the stocked 40–48 band, not an
/// S/M/L label — Adorini sizes garments numerically. Prices are paise.
class CatalogFilters {
  const CatalogFilters({
    this.category,
    this.brand,
    this.fabricType,
    this.printTechnique,
    this.size,
    this.minPricePaise,
    this.maxPricePaise,
    this.query,
    this.sort = CatalogSort.newest,
  });

  final String? category;
  final String? brand;
  final FabricType? fabricType;
  final PrintTechnique? printTechnique;
  final int? size;
  final int? minPricePaise;
  final int? maxPricePaise;
  final String? query;
  final CatalogSort sort;

  Map<String, dynamic> toQuery() {
    return <String, dynamic>{
      if (category != null) 'category': category,
      if (brand != null) 'brand': brand,
      if (fabricType != null) 'fabricType': fabricType!.wire,
      if (printTechnique != null) 'printTechnique': printTechnique!.wire,
      if (size != null) 'size': size,
      if (minPricePaise != null) 'minPrice': minPricePaise,
      if (maxPricePaise != null) 'maxPrice': maxPricePaise,
      if (query != null && query!.isNotEmpty) 'q': query,
      'sort': sort.wire,
    };
  }

  CatalogFilters copyWith({
    String? category,
    String? brand,
    FabricType? fabricType,
    PrintTechnique? printTechnique,
    int? size,
    int? minPricePaise,
    int? maxPricePaise,
    String? query,
    CatalogSort? sort,
  }) {
    return CatalogFilters(
      category: category,
      brand: brand,
      fabricType: fabricType,
      printTechnique: printTechnique,
      size: size,
      minPricePaise: minPricePaise,
      maxPricePaise: maxPricePaise,
      query: query,
      sort: sort ?? this.sort,
    );
  }

  bool get isEmpty =>
      category == null &&
      brand == null &&
      fabricType == null &&
      printTechnique == null &&
      size == null &&
      minPricePaise == null &&
      maxPricePaise == null &&
      (query == null || query!.isEmpty);
}

class CatalogApi {
  CatalogApi(this._dio);

  final Dio _dio;

  /// Cursor-based rather than offset-based: infinite scroll under concurrent
  /// catalog writes would otherwise skip or repeat items.
  Future<ProductPage> listProducts({
    CatalogFilters filters = const CatalogFilters(),
    String? cursor,
    int limit = 20,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.get<Map<String, dynamic>>(
      ApiConstants.products,
      queryParameters: <String, dynamic>{
        ...filters.toQuery(),
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
    );
    return ProductPage.fromJson(response.data!);
  }

  Future<List<Category>> listCategories() async {
    final Response<List<dynamic>> response =
        await _dio.get<List<dynamic>>(ApiConstants.categories);
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => Category.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<Brand>> listBrands() async {
    final Response<List<dynamic>> response = await _dio.get<List<dynamic>>(ApiConstants.brands);
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => Brand.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
