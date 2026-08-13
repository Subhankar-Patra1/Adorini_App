import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/catalog_api.dart';
import '../data/product_model.dart';

final Provider<CatalogApi> catalogApiProvider = Provider<CatalogApi>(
  (Ref ref) => CatalogApi(ref.watch(dioProvider)),
);

final StateProvider<CatalogFilters> catalogFiltersProvider = StateProvider<CatalogFilters>(
  (Ref ref) => const CatalogFilters(),
);

final FutureProvider<List<Category>> categoriesProvider = FutureProvider<List<Category>>(
  (Ref ref) => ref.watch(catalogApiProvider).listCategories(),
);

final FutureProvider<List<Brand>> brandsProvider = FutureProvider<List<Brand>>(
  (Ref ref) => ref.watch(catalogApiProvider).listBrands(),
);

/// Paginated product list that accumulates pages as the grid is scrolled.
/// Rebuilds from scratch whenever the filters change.
final AsyncNotifierProvider<ProductListController, List<ProductSummary>> productListProvider =
    AsyncNotifierProvider<ProductListController, List<ProductSummary>>(ProductListController.new);

class ProductListController extends AsyncNotifier<List<ProductSummary>> {
  String? _nextCursor;
  bool _isLoadingMore = false;

  @override
  Future<List<ProductSummary>> build() async {
    final CatalogFilters filters = ref.watch(catalogFiltersProvider);
    final ProductPage page = await ref.watch(catalogApiProvider).listProducts(filters: filters);
    _nextCursor = page.nextCursor;
    return page.items;
  }

  bool get hasMore => _nextCursor != null;

  /// Appends the next page. No-op at the end of the list or while a fetch is
  /// already in flight — scroll listeners fire far faster than the network.
  Future<void> loadMore() async {
    if (_isLoadingMore || _nextCursor == null) return;
    final List<ProductSummary>? current = state.value;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final ProductPage page = await ref
          .read(catalogApiProvider)
          .listProducts(filters: ref.read(catalogFiltersProvider), cursor: _nextCursor);
      _nextCursor = page.nextCursor;
      state = AsyncData<List<ProductSummary>>(<ProductSummary>[...current, ...page.items]);
    } finally {
      _isLoadingMore = false;
    }
  }
}

final Provider<AsyncValue<List<ProductSummary>>> wishlistProvider =
    Provider<AsyncValue<List<ProductSummary>>>(
  (Ref ref) => const AsyncData<List<ProductSummary>>(<ProductSummary>[]),
);
