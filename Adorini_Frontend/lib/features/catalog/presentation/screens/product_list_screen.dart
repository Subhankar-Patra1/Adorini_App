import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../data/catalog_api.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';
import '../../domain/home_providers.dart';
import '../widgets/catalog_category_rail.dart';
import '../widgets/filter_bottom_sheet.dart';
import '../widgets/product_card.dart';

class ProductListScreen extends ConsumerStatefulWidget {
  const ProductListScreen({super.key});

  @override
  ConsumerState<ProductListScreen> createState() => _ProductListScreenState();
}

class _ProductListScreenState extends ConsumerState<ProductListScreen> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final double remaining = _scrollController.position.maxScrollExtent -
        _scrollController.position.pixels;
    if (remaining < 600) {
      ref.read(productListProvider.notifier).loadMore();
    }
  }

  void _selectCategory(String? category) {
    final CatalogFilters current = ref.read(catalogFiltersProvider);
    ref.read(catalogFiltersProvider.notifier).state = CatalogFilters(
      category: category,
      brand: current.brand,
      fabricType: current.fabricType,
      printTechnique: current.printTechnique,
      size: current.size,
      minPricePaise: current.minPricePaise,
      maxPricePaise: current.maxPricePaise,
      query: current.query,
      sort: category == null ? CatalogSort.newest : current.sort,
    );
    if (_scrollController.hasClients) {
      _scrollController.jumpTo(0);
    }
  }

  void _setSort(CatalogSort sort) {
    final CatalogFilters current = ref.read(catalogFiltersProvider);
    ref.read(catalogFiltersProvider.notifier).state = CatalogFilters(
      category: current.category,
      brand: current.brand,
      fabricType: current.fabricType,
      printTechnique: current.printTechnique,
      size: current.size,
      minPricePaise: current.minPricePaise,
      maxPricePaise: current.maxPricePaise,
      query: current.query,
      sort: sort,
    );
  }

  void _setQuery(String? query) {
    final CatalogFilters current = ref.read(catalogFiltersProvider);
    final String normalizedQuery = query?.trim() ?? '';
    ref.read(catalogFiltersProvider.notifier).state = CatalogFilters(
      category: current.category,
      brand: current.brand,
      fabricType: current.fabricType,
      printTechnique: current.printTechnique,
      size: current.size,
      minPricePaise: current.minPricePaise,
      maxPricePaise: current.maxPricePaise,
      query: normalizedQuery.isEmpty ? null : normalizedQuery,
      sort: current.sort,
    );
  }

  Future<void> _openSearch() async {
    final CatalogFilters filters = ref.read(catalogFiltersProvider);
    final TextEditingController controller =
        TextEditingController(text: filters.query);
    final String? result = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text('Search catalog'),
          content: TextField(
            controller: controller,
            autofocus: true,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              hintText: 'Search styles and products',
              prefixIcon: Icon(Icons.search),
            ),
            onSubmitted: (String value) =>
                Navigator.of(dialogContext).pop(value),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('CANCEL'),
            ),
            if (filters.query != null)
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(''),
                child: const Text('CLEAR'),
              ),
            FilledButton(
              onPressed: () =>
                  Navigator.of(dialogContext).pop(controller.text),
              child: const Text('SEARCH'),
            ),
          ],
        );
      },
    );
    controller.dispose();
    if (result != null) _setQuery(result);
  }

  Future<void> _openSort() async {
    final CatalogSort current = ref.read(catalogFiltersProvider).sort;
    final CatalogSort? selected = await showModalBottomSheet<CatalogSort>(
      context: context,
      useRootNavigator: true,
      showDragHandle: false,
      builder: (BuildContext sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const _CompactSheetHandle(),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.containerMargin,
                ),
                child: Text('Sort by', style: AppTypography.titleMd),
              ),
              for (final CatalogSort sort in CatalogSort.values)
                ListTile(
                  title: Text(sort.label),
                  trailing: sort == current
                      ? const Icon(Icons.check, color: AppColors.primary)
                      : null,
                  onTap: () => Navigator.of(sheetContext).pop(sort),
                ),
            ],
          ),
        );
      },
    );
    if (selected != null) _setSort(selected);
  }

  Future<void> _openFilters() {
    return showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      showDragHandle: false,
      builder: (BuildContext context) => const FilterBottomSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final CatalogFilters filters = ref.watch(catalogFiltersProvider);
    final AsyncValue<List<ProductSummary>> products =
        ref.watch(productListProvider);
    final List<ProductSummary> previews =
        ref.watch(homeFeedProvider).valueOrNull ?? <ProductSummary>[];
    final List<Category> categories =
        ref.watch(categoriesProvider).valueOrNull ?? <Category>[];

    return Scaffold(
      backgroundColor: AppColors.surfaceContainerLow,
      appBar: AppBar(
        backgroundColor: AppColors.surfaceContainerLowest,
        title: const Text('Catalog'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Search',
            onPressed: _openSearch,
            icon: Badge(
              isLabelVisible: filters.query != null,
              smallSize: 6,
              child: const Icon(Icons.search),
            ),
          ),
          IconButton(
            tooltip: 'Wishlist',
            onPressed: () => context.go('/wishlist'),
            icon: const Icon(Icons.favorite_border),
          ),
          IconButton(
            tooltip: 'Bag',
            onPressed: () => context.push('/cart'),
            icon: const Icon(Icons.shopping_bag_outlined),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          CatalogCategoryRail(
            selectedSlug: filters.category,
            previewProducts: previews,
            onSelected: _selectCategory,
          ),
          Expanded(
            child: DecoratedBox(
              decoration: const BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(AppRadius.card),
                ),
              ),
              child: Column(
                children: <Widget>[
                  _CatalogToolbar(
                    title: _categoryTitle(filters.category, categories),
                    productCount: products.valueOrNull?.length,
                    activeFilterCount: _activeFilterCount(filters),
                    sortLabel: filters.sort.label,
                    onSort: _openSort,
                    onFilter: _openFilters,
                  ),
                  const Divider(height: 1, thickness: 0.5),
                  Expanded(
                    child: products.when(
                      data: (List<ProductSummary> items) {
                        if (items.isEmpty) {
                          return _CatalogEmptyState(
                            categoryName: _categoryTitle(filters.category, categories),
                            isEmptySeedCategory:
                                filters.category == 'two-piece-suit-sets',
                            onBrowseAll: () => _selectCategory(null),
                          );
                        }
                        return LayoutBuilder(
                          builder: (
                            BuildContext context,
                            BoxConstraints constraints,
                          ) {
                            const double sidePadding = 10;
                            const double crossSpacing = 8;
                            final double cellWidth =
                                (constraints.maxWidth -
                                    sidePadding * 2 -
                                    crossSpacing) /
                                2;
                            return GridView.builder(
                              controller: _scrollController,
                              padding: const EdgeInsets.fromLTRB(
                                sidePadding,
                                10,
                                sidePadding,
                                112,
                              ),
                              gridDelegate:
                                  SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 2,
                                mainAxisSpacing: 12,
                                crossAxisSpacing: crossSpacing,
                                mainAxisExtent: ProductCard.extentFor(
                                  context,
                                  cellWidth: cellWidth,
                                ),
                              ),
                              itemCount: items.length,
                              itemBuilder: (BuildContext context, int index) {
                                final ProductSummary product = items[index];
                                return ProductCard(
                                  product: product,
                                  onTap: () => context.push(
                                    '/catalog/product/${product.slug}',
                                  ),
                                );
                              },
                            );
                          },
                        );
                      },
                      error: (Object error, StackTrace stackTrace) =>
                          _CatalogErrorState(
                        message: friendlyErrorMessage(error),
                        onRetry: () => ref.invalidate(productListProvider),
                      ),
                      loading: () => const Center(
                        child: CircularProgressIndicator(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static int _activeFilterCount(CatalogFilters filters) {
    int count = 0;
    if (filters.brand != null) count++;
    if (filters.fabricType != null) count++;
    if (filters.printTechnique != null) count++;
    if (filters.size != null) count++;
    if (filters.minPricePaise != null || filters.maxPricePaise != null) count++;
    return count;
  }

  /// The heading over the grid.
  ///
  /// Resolved from the fetched categories rather than a switch over slugs: the
  /// old map knew five of eleven, so selecting Kaftaan in the rail left the
  /// grid titled "New arrivals". Falling back to the slug keeps the heading
  /// truthful if the list has not loaded yet.
  static String _categoryTitle(String? slug, List<Category> categories) {
    if (slug == null) return 'New arrivals';
    for (final Category category in categories) {
      if (category.slug == slug) return category.name;
    }
    return slug;
  }
}

class _CompactSheetHandle extends StatelessWidget {
  const _CompactSheetHandle();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: Padding(
        padding: const EdgeInsets.only(top: 10, bottom: 10),
        child: Container(
          width: 34,
          height: 3,
          decoration: BoxDecoration(
            color: AppColors.outlineVariant,
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
        ),
      ),
    );
  }
}

class _CatalogToolbar extends StatelessWidget {
  const _CatalogToolbar({
    required this.title,
    required this.productCount,
    required this.activeFilterCount,
    required this.sortLabel,
    required this.onSort,
    required this.onFilter,
  });

  final String title;
  final int? productCount;
  final int activeFilterCount;
  final String sortLabel;
  final VoidCallback onSort;
  final VoidCallback onFilter;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.titleMd.copyWith(fontSize: 17),
          ),
          const SizedBox(height: 5),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  productCount == null
                      ? 'Loading styles…'
                      : '$productCount ${productCount == 1 ? 'style' : 'styles'}',
                  style: AppTypography.bodyMd.copyWith(
                    fontSize: 11,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ),
              _ToolbarAction(
                icon: Icons.swap_vert,
                label: 'Sort',
                tooltip: sortLabel,
                onTap: onSort,
              ),
              const SizedBox(width: 4),
              _ToolbarAction(
                icon: Icons.tune,
                label: activeFilterCount == 0
                    ? 'Filter'
                    : 'Filter $activeFilterCount',
                onTap: onFilter,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ToolbarAction extends StatelessWidget {
  const _ToolbarAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.tooltip,
  });

  final IconData icon;
  final String label;
  final String? tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip ?? label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.outlineVariant, width: 0.7),
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon, size: 14, color: AppColors.primary),
              const SizedBox(width: 3),
              Text(
                label,
                style: AppTypography.bodyMdBold.copyWith(
                  fontSize: 10,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CatalogEmptyState extends StatelessWidget {
  const _CatalogEmptyState({
    required this.categoryName,
    required this.isEmptySeedCategory,
    required this.onBrowseAll,
  });

  final String categoryName;
  final bool isEmptySeedCategory;
  final VoidCallback onBrowseAll;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(22, 24, 22, 112),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 68,
              height: 68,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.surfaceContainer,
              ),
              child: const Icon(
                Icons.checkroom_outlined,
                size: 32,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              isEmptySeedCategory
                  ? 'No Two-Piece Suit Sets yet'
                  : 'No styles found',
              textAlign: TextAlign.center,
              style: AppTypography.titleMd.copyWith(fontSize: 17),
            ),
            const SizedBox(height: AppSpacing.base),
            Text(
              isEmptySeedCategory
                  ? 'New pieces are being prepared for this collection.'
                  : 'Try clearing a filter or exploring another category.',
              textAlign: TextAlign.center,
              style: AppTypography.bodyMd.copyWith(
                fontSize: 12,
                color: AppColors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(
              onPressed: onBrowseAll,
              child: const Text('BROWSE NEW ARRIVALS'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CatalogErrorState extends StatelessWidget {
  const _CatalogErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.md),
            TextButton(onPressed: onRetry, child: const Text('TRY AGAIN')),
          ],
        ),
      ),
    );
  }
}
