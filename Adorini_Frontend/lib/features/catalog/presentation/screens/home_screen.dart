import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../cart/data/cart_api.dart';
import '../../../cart/domain/cart_controller.dart';
import '../../data/catalog_api.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';
import '../../domain/home_providers.dart';
import '../widgets/home/hero_carousel.dart';
import '../widgets/home/home_sections.dart';
import '../widgets/home/home_skeletons.dart';
import '../widgets/home/product_rail.dart';

/// The storefront.
///
/// Built as one [CustomScrollView] of slivers rather than a scrolling Column:
/// the endless product grid at the foot has to share the page's scroll, and
/// only a sliver grid can be built lazily as it is reached.
///
/// Each rail owns its own request and its own failure. A page that resolves
/// all six sections before painting anything shows a blank screen for as long
/// as its slowest query, and a page that gives up entirely because one rail
/// 500s throws away five working ones.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
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

  /// Pre-fetches the next page while the shopper is still 600pt from the end,
  /// so the grid extends before they reach the bottom rather than stalling
  /// there with a spinner.
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final double remaining = _scrollController.position.maxScrollExtent -
        _scrollController.position.pixels;
    if (remaining < 600) {
      ref.read(homeFeedProvider.notifier).loadMore();
    }
  }

  /// Drops [filters] on the catalog and switches to that tab.
  void _openCatalog(CatalogFilters filters) {
    ref.read(catalogFiltersProvider.notifier).state = filters;
    context.go('/catalog');
  }

  Future<void> _refresh() async {
    // Invalidated together and awaited as one, so the pull-to-refresh spinner
    // stays up until the page is actually rebuilt rather than snapping away
    // while four requests are still in flight.
    ref.invalidate(categoriesProvider);
    ref.invalidate(newArrivalsProvider);
    ref.invalidate(trendingNowProvider);
    ref.invalidate(homeFeedProvider);
    await Future.wait<void>(<Future<void>>[
      ref.read(newArrivalsProvider.future),
      ref.read(homeFeedProvider.future),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<CartView> cart = ref.watch(cartControllerProvider);
    final int cartCount = cart.valueOrNull?.itemCount ?? 0;

    return Scaffold(
      backgroundColor: AppColors.surfaceContainerLow,
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          controller: _scrollController,
          slivers: <Widget>[
            _HomeAppBar(
              cartCount: cartCount,
              onSearch: () => context.push('/search'),
              onCart: () => context.push('/cart'),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xs)),
            const SliverToBoxAdapter(child: HeroCarousel()),
            SliverToBoxAdapter(
              child: SectionHeader(
                title: 'Shop by category',
                compact: true,
                onSeeAll: () => _openCatalog(const CatalogFilters()),
              ),
            ),
            const SliverToBoxAdapter(child: CategoryRail()),
            _railSliver(
              provider: newArrivalsProvider,
              title: 'New this week',
              subtitle: 'The latest pieces in the boutique',
              compact: true,
              onSeeAll: () =>
                  _openCatalog(const CatalogFilters(sort: CatalogSort.newest)),
            ),
            _railSliver(
              provider: trendingNowProvider,
              title: 'Trending now',
              subtitle: 'Styles shoppers are noticing',
              onSeeAll: () => _openCatalog(const CatalogFilters()),
            ),
            const SliverToBoxAdapter(
              child: SectionHeader(
                title: 'For you',
                subtitle: 'A personal edit from Adorini',
              ),
            ),
            ..._feedSlivers(),
            const SliverToBoxAdapter(child: SizedBox(height: 112)),
          ],
        ),
      ),
    );
  }

  /// One product rail, with its loading, error and empty states.
  ///
  /// Takes the provider rather than a resolved list so the rail can render its
  /// own skeleton — passing an `AsyncValue` down would work equally, but this
  /// keeps the retry able to invalidate exactly the provider that failed.
  Widget _railSliver({
    required FutureProvider<List<ProductSummary>> provider,
    required String title,
    required String? subtitle,
    required VoidCallback? onSeeAll,
    bool compact = false,
  }) {
    return Consumer(
      builder: (BuildContext context, WidgetRef ref, Widget? child) {
        final AsyncValue<List<ProductSummary>> value = ref.watch(provider);
        return SliverToBoxAdapter(
          child: value.when(
            loading: () => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const SectionHeaderSkeleton(),
                RailSkeleton(
                  cardWidth: compact
                      ? ProductRail.compactCardWidth
                      : ProductRail.cardWidth,
                  height: compact
                      ? ProductRail.compactHeight
                      : ProductRail.heightFor(context),
                ),
              ],
            ),
            error: (Object error, StackTrace stack) => SectionError(
              message: friendlyErrorMessage(error),
              onRetry: () => ref.invalidate(provider),
            ),
            data: (List<ProductSummary> items) => ProductRail(
              title: title,
              subtitle: subtitle,
              products: items,
              compact: compact,
              onSeeAll: onSeeAll,
            ),
          ),
        );
      },
    );
  }

  /// The endless grid, plus whatever belongs under it for the current state.
  List<Widget> _feedSlivers() {
    final AsyncValue<List<ProductSummary>> feed = ref.watch(homeFeedProvider);

    return feed.when(
      loading: () => <Widget>[
        const SliverToBoxAdapter(
          child: Padding(
            padding: EdgeInsets.all(AppSpacing.xl),
            child: Center(child: CircularProgressIndicator()),
          ),
        ),
      ],
      error: (Object error, StackTrace stack) => <Widget>[
        SliverToBoxAdapter(
          child: SectionError(
            message: friendlyErrorMessage(error),
            onRetry: () => ref.invalidate(homeFeedProvider),
          ),
        ),
      ],
      data: (List<ProductSummary> items) => <Widget>[
        HomeProductGrid(products: items),
        if (ref.read(homeFeedProvider.notifier).hasMore)
          const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(AppSpacing.lg),
              child: Center(
                child: SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Editorial brand header, search and bag.
///
/// Pinned so the brand header, bag and search remain available while the
/// editorial Home sections scroll underneath.
class _HomeAppBar extends StatelessWidget {
  const _HomeAppBar({
    required this.cartCount,
    required this.onSearch,
    required this.onCart,
  });

  final int cartCount;
  final VoidCallback onSearch;
  final VoidCallback onCart;

  @override
  Widget build(BuildContext context) {
    return SliverAppBar(
      pinned: true,
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          bottom: Radius.circular(AppRadius.card),
        ),
      ),
      toolbarHeight: 66,
      titleSpacing: AppSpacing.containerMargin,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            'Adorini',
            style: AppTypography.headlineLgMobile.copyWith(
              fontSize: 27,
              color: AppColors.primary,
            ),
          ),
          Text(
            'Find your signature look',
            style: AppTypography.bodyMd.copyWith(
              fontSize: 11,
              color: AppColors.onSurfaceVariant,
            ),
          ),
        ],
      ),
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(50),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            6,
          ),
          child: SizedBox(
            height: 44,
            child: TextField(
              readOnly: true,
              canRequestFocus: false,
              onTap: onSearch,
              style: AppTypography.bodyMd.copyWith(fontSize: 14),
              decoration: InputDecoration(
                hintText: 'Search styles, brands and more',
                hintStyle: AppTypography.bodyMd.copyWith(
                  fontSize: 13,
                  color: AppColors.onSurfaceVariant,
                ),
                prefixIcon: const Icon(
                  Icons.search,
                  size: 20,
                  color: AppColors.onSurfaceVariant,
                ),
                suffixIcon: const Icon(
                  Icons.tune,
                  size: 19,
                  color: AppColors.primary,
                ),
                filled: true,
                fillColor: AppColors.surfaceContainerLowest,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  borderSide: const BorderSide(
                    color: AppColors.outlineVariant,
                  ),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  borderSide: const BorderSide(
                    color: AppColors.outlineVariant,
                  ),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.full),
                  borderSide: const BorderSide(color: AppColors.primary),
                ),
              ),
            ),
          ),
        ),
      ),
      actions: <Widget>[
        IconButton(
          onPressed: onCart,
          tooltip: 'Bag',
          icon: Badge(
            isLabelVisible: cartCount > 0,
            label: Text('$cartCount'),
            child: const Icon(Icons.shopping_bag_outlined),
          ),
        ),
        const SizedBox(width: AppSpacing.base),
      ],
    );
  }
}
