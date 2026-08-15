import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/domain_enums.dart';
import '../data/catalog_api.dart';
import '../data/product_model.dart';
import 'catalog_providers.dart';

/// Products shown in one horizontal rail.
///
/// Ten rather than a full page: a rail is a teaser with a "See all" at its
/// head, so fetching twenty would mean paying for ten products the shopper
/// has to swipe past the "See all" affordance to ever reach.
const int _railLength = 10;

/// Ceiling for the budget rail, in paise (₹1,499).
///
/// Named because it appears twice — once in the query, once in the rail's
/// title — and a title advertising a price the query does not enforce is the
/// kind of drift that only surfaces as a customer complaint.
const int budgetRailCeilingPaise = 149900;

/// One slide of the home hero carousel.
@immutable
class HeroSlide {
  const HeroSlide({
    required this.eyebrow,
    required this.headline,
    required this.cta,
    required this.filters,
    this.imageAsset,
  });

  final String eyebrow;
  final String headline;
  final String cta;

  /// Pushed into [catalogFiltersProvider] before jumping to the catalog tab,
  /// so a slide promising "under ₹1,499" lands on exactly that list rather
  /// than on the unfiltered grid.
  final CatalogFilters filters;

  /// Optional backdrop. Slides without one render as a typographic panel in
  /// the theme's own tones, which is why the carousel works at all with the
  /// single fashion image this app currently bundles.
  final String? imageAsset;
}

/// The hero slides.
///
/// Authored in the app rather than fetched: there is no `/catalog/collections`
/// endpoint, so there is nothing to fetch them from. Kept behind a provider
/// anyway so that swapping in a real feed later changes this declaration and
/// nothing else — every consumer already reads it through `ref.watch`.
///
/// Each slide's copy is tied to the filter beneath it. That pairing is the
/// point: a merchandising banner that does not narrow the catalog is just
/// decoration, and shoppers learn quickly to stop tapping it.
final Provider<List<HeroSlide>> heroSlidesProvider = Provider<List<HeroSlide>>(
  (Ref ref) => const <HeroSlide>[
    HeroSlide(
      eyebrow: 'NEW SEASON',
      headline: 'Handpicked\nethnic edits',
      cta: 'Explore new arrivals',
      filters: CatalogFilters(),
      imageAsset: 'assets/images/onboarding_fashion_collage.webp',
    ),
    HeroSlide(
      eyebrow: 'EVERYDAY EDIT',
      headline: 'Under ₹1,499',
      cta: 'Shop the edit',
      filters: CatalogFilters(
        maxPricePaise: budgetRailCeilingPaise,
        sort: CatalogSort.priceAsc,
      ),
    ),
    // Keyed to a craft rather than a fabric: `FabricType` only distinguishes
    // STRETCH from RIGID, which is a fit property no shopper browses by.
    // `PrintTechnique` is the axis that carries a story worth a banner.
    HeroSlide(
      eyebrow: 'HAND-BLOCKED',
      headline: 'The Kalankari\ncollection',
      cta: 'Shop Kalankari',
      filters: CatalogFilters(printTechnique: PrintTechnique.kalankari),
    ),
  ],
);

/// Newest arrivals, for the rail of the same name.
final FutureProvider<List<ProductSummary>> newArrivalsProvider =
    FutureProvider<List<ProductSummary>>((Ref ref) async {
  final ProductPage page = await ref.watch(catalogApiProvider).listProducts(
        filters: const CatalogFilters(sort: CatalogSort.newest),
        limit: _railLength,
      );
  return page.items;
});

/// Products carrying a struck-through compare-at price.
///
/// Filtered client-side because `/catalog/products` has no "on sale" flag to
/// query. That makes this an approximation, and an honest one only because of
/// the over-fetch below: asking for ten and filtering would routinely return
/// two or three. Asking for forty and taking ten from those is stable enough
/// for a rail, but it is still a scan of one page — a catalog whose discounts
/// all sit past the fortieth newest product would show an empty rail.
///
/// The real fix is a server-side filter. Until then this rail hides itself
/// rather than rendering empty, which is handled where it is built.
final FutureProvider<List<ProductSummary>> dealsProvider =
    FutureProvider<List<ProductSummary>>((Ref ref) async {
  final ProductPage page = await ref.watch(catalogApiProvider).listProducts(
        filters: const CatalogFilters(sort: CatalogSort.newest),
        limit: 40,
      );
  return page.items
      .where((ProductSummary p) => p.isDiscounted)
      .take(_railLength)
      .toList();
});

/// The budget rail. Cheapest first — the rail's promise is the price, so
/// leading with the newest instead would bury the cheapest pieces off-screen.
final FutureProvider<List<ProductSummary>> budgetPicksProvider =
    FutureProvider<List<ProductSummary>>((Ref ref) async {
  final ProductPage page = await ref.watch(catalogApiProvider).listProducts(
        filters: const CatalogFilters(
          maxPricePaise: budgetRailCeilingPaise,
          sort: CatalogSort.priceAsc,
        ),
        limit: _railLength,
      );
  return page.items;
});

/// The paginating grid at the foot of the home page.
///
/// Deliberately **not** [productListProvider]. That one watches
/// [catalogFiltersProvider], which the category rail and every hero slide
/// write to on their way to the catalog tab — so sharing it would leave the
/// home grid showing "Cotton, size 44" after the shopper came back from a
/// filtered catalog, with no filter chips on this screen to explain why or
/// any way to clear them. Home always shows the whole catalog.
final AsyncNotifierProvider<HomeFeedController, List<ProductSummary>>
    homeFeedProvider =
    AsyncNotifierProvider<HomeFeedController, List<ProductSummary>>(
  HomeFeedController.new,
);

class HomeFeedController extends AsyncNotifier<List<ProductSummary>> {
  String? _nextCursor;
  bool _isLoadingMore = false;

  @override
  Future<List<ProductSummary>> build() async {
    final ProductPage page = await ref.watch(catalogApiProvider).listProducts(
          filters: const CatalogFilters(sort: CatalogSort.newest),
        );
    _nextCursor = page.nextCursor;
    return page.items;
  }

  bool get hasMore => _nextCursor != null;

  /// Appends the next page. No-op at the end of the list or while a fetch is
  /// already in flight — scroll notifications arrive far faster than the
  /// network answers.
  Future<void> loadMore() async {
    if (_isLoadingMore || _nextCursor == null) return;
    final List<ProductSummary>? current = state.value;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final ProductPage page =
          await ref.read(catalogApiProvider).listProducts(
                filters: const CatalogFilters(sort: CatalogSort.newest),
                cursor: _nextCursor,
              );
      _nextCursor = page.nextCursor;
      state = AsyncData<List<ProductSummary>>(
        <ProductSummary>[...current, ...page.items],
      );
    } finally {
      _isLoadingMore = false;
    }
  }
}
