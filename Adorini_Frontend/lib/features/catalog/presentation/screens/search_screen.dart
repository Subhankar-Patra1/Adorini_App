import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../data/catalog_api.dart';
import '../../data/recent_searches_store.dart';
import '../../data/search_suggestion.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';
import '../widgets/product_card.dart';

/// Full-screen catalog search, deliberately routed above the tab shell.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  String _submittedQuery = '';

  /// The debounced text driving the suggestion list. Distinct from
  /// [_submittedQuery], which is the search whose products are on screen.
  String _typedQuery = '';
  Timer? _debounce;

  /// Wait after the last keystroke before querying.
  ///
  /// 280ms is about the gap between characters for an average typist, so a
  /// continuous burst of typing issues one request at the end rather than one
  /// per letter — the difference between 1 and 12 requests for "kalamkari".
  static const Duration _debounceDelay = Duration(milliseconds: 280);

  /// Below this, results are noise.
  ///
  /// A single letter prefix-matches most of the catalogue, so the shopper would
  /// watch the whole shop flash past on the way to what they wanted.
  static const int _minQueryLength = 2;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.removeListener(_onTextChanged);
    _scrollController.removeListener(_onScroll);
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Search as the shopper types.
  ///
  /// Viable only because the backend prefix-matches the final term
  /// (`WidenProductSearchVector` / `toPrefixTsQuery`); against whole-word
  /// matching this would return nothing until the last keystroke of every word
  /// and read as a broken search.
  void _onTextChanged() {
    setState(() {});
    _debounce?.cancel();

    final String query = _controller.text.trim();
    if (query.length < _minQueryLength) {
      // Clearing the box returns to the prompt rather than leaving the last
      // results stranded under an empty field.
      if (_submittedQuery.isNotEmpty || _typedQuery.isNotEmpty) {
        setState(() {
          _submittedQuery = '';
          _typedQuery = '';
        });
        ref.read(catalogFiltersProvider.notifier).state = const CatalogFilters();
      }
      return;
    }

    // Typing no longer runs the product search. It updates `_typedQuery`,
    // which drives the suggestion list; products appear once the shopper picks
    // a suggestion or presses enter. Showing a grid mid-word answered a
    // question they had not finished asking, and the answer churned on every
    // keystroke.
    _debounce = Timer(_debounceDelay, () {
      if (!mounted || _controller.text.trim() != query) return;
      setState(() => _typedQuery = query);
    });
  }

  void _onScroll() {
    if (!_scrollController.hasClients || _submittedQuery.isEmpty) return;
    final double remaining = _scrollController.position.maxScrollExtent -
        _scrollController.position.pixels;
    if (remaining < 600) {
      ref.read(productListProvider.notifier).loadMore();
    }
  }

  /// Enter on the keyboard: run immediately and dismiss the IME, so the
  /// shopper who finishes typing and hits search does not wait out the debounce
  /// and gets the results screen unobstructed.
  void _search(String value) {
    final String query = value.trim();
    if (query.isEmpty) return;
    _debounce?.cancel();
    FocusScope.of(context).unfocus();
    unawaited(ref.read(recentSearchesProvider.notifier).add(query));
    _applyQuery(query);
  }

  /// Tapping a recent term or a category chip.
  void _searchSuggestion(String term) {
    _debounce?.cancel();
    FocusScope.of(context).unfocus();
    _commitQuery(term);
  }

  /// Tapping a type-ahead row.
  ///
  /// A product suggestion opens that product rather than searching for its
  /// name. The shopper named the thing they wanted; making them read a
  /// one-result grid first would be a step for nothing.
  void _openSuggestion(SearchSuggestion suggestion) {
    _debounce?.cancel();
    FocusScope.of(context).unfocus();
    unawaited(ref.read(recentSearchesProvider.notifier).add(suggestion.label));

    switch (suggestion.kind) {
      case SuggestionKind.product:
        context.push('/catalog/product/${suggestion.slug}');
      case SuggestionKind.category:
        setState(() {
          _submittedQuery = suggestion.label;
          _typedQuery = '';
        });
        ref.read(catalogFiltersProvider.notifier).state =
            CatalogFilters(category: suggestion.slug);
      case SuggestionKind.brand:
        setState(() {
          _submittedQuery = suggestion.label;
          _typedQuery = '';
        });
        ref.read(catalogFiltersProvider.notifier).state =
            CatalogFilters(brand: suggestion.slug);
    }
  }

  /// Runs a query *and* remembers it.
  ///
  /// Only deliberate searches are recorded - submitting, or tapping a
  /// suggestion. Recording every debounce tick would fill the history with
  /// "ku", "kur", "kurt" on the way to one real search.
  void _commitQuery(String query) {
    _controller.value = TextEditingValue(
      text: query,
      selection: TextSelection.collapsed(offset: query.length),
    );
    unawaited(ref.read(recentSearchesProvider.notifier).add(query));
    _applyQuery(query);
  }

  void _applyQuery(String query) {
    setState(() {
      _submittedQuery = query;
      _typedQuery = '';
    });
    ref.read(catalogFiltersProvider.notifier).state = CatalogFilters(
      query: query,
    );
    // Back to the top: results have changed underneath, and leaving the offset
    // alone drops the shopper into the middle of a list they have not seen.
    if (_scrollController.hasClients) _scrollController.jumpTo(0);
  }

  void _clear() {
    _debounce?.cancel();
    _controller.clear();
    setState(() {
      _submittedQuery = '';
      _typedQuery = '';
    });
    ref.read(catalogFiltersProvider.notifier).state = const CatalogFilters();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceContainerLow,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        toolbarHeight: 68,
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => context.pop(),
          icon: const Icon(Icons.arrow_back),
        ),
        titleSpacing: 0,
        title: SizedBox(
          height: 44,
          child: TextField(
            controller: _controller,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onSubmitted: _search,
            style: AppTypography.bodyMd.copyWith(fontSize: 14),
            decoration: InputDecoration(
              hintText: 'Search styles, brands and more',
              hintStyle: AppTypography.bodyMd.copyWith(
                fontSize: 13,
                color: AppColors.onSurfaceVariant,
              ),
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: _controller.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      onPressed: _clear,
                      icon: const Icon(Icons.close, size: 19),
                    ),
              filled: true,
              fillColor: AppColors.surfaceContainerLowest,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.full),
                borderSide: const BorderSide(color: AppColors.outlineVariant),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.full),
                borderSide: const BorderSide(color: AppColors.outlineVariant),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.full),
                borderSide: const BorderSide(color: AppColors.primary),
              ),
            ),
          ),
        ),
        actions: const <Widget>[SizedBox(width: 12)],
      ),
      // Three states, in the order a search actually happens: nothing typed,
      // typing (suggestions), chosen (products).
      body: _typedQuery.isNotEmpty
          ? _SuggestionList(query: _typedQuery, onSelected: _openSuggestion)
          : _submittedQuery.isEmpty
              ? _SearchPrompt(onSuggestion: _searchSuggestion)
              : _SearchResults(
                  query: _submittedQuery,
                  scrollController: _scrollController,
                  onSuggestion: _searchSuggestion,
                ),
    );
  }
}

/// What the page shows before anything has been searched.
///
/// Not an illustration and a slogan: an empty search page is the one moment the
/// shopper has told you they want something but not yet what, so it earns
/// tappable starting points. Recent terms first (they are the shopper's own
/// intent), category chips beneath as a floor for a first-time user with no
/// history at all.
/// Type-ahead rows: what the shopper can pick, not what they will get.
class _SuggestionList extends ConsumerWidget {
  const _SuggestionList({required this.query, required this.onSelected});

  final String query;
  final ValueChanged<SearchSuggestion> onSelected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<SearchSuggestion>> suggestions =
        ref.watch(searchSuggestionsProvider(query));

    return suggestions.when(
      // No spinner. Suggestions are replaced every couple of keystrokes, so a
      // loading indicator would flicker more than it would inform; the previous
      // list simply stays until the next arrives.
      loading: () => const SizedBox.shrink(),
      error: (Object e, StackTrace s) => const SizedBox.shrink(),
      data: (List<SearchSuggestion> items) {
        if (items.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Text(
              'No suggestions for “$query”. Press search to look anyway.',
              textAlign: TextAlign.center,
              style: AppTypography.bodyMd.copyWith(
                color: AppColors.onSurfaceVariant,
              ),
            ),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.base),
          itemCount: items.length,
          separatorBuilder: (BuildContext c, int i) =>
              const Divider(height: 1, thickness: 0.5, indent: 52),
          itemBuilder: (BuildContext context, int index) {
            final SearchSuggestion item = items[index];
            return ListTile(
              onTap: () => onSelected(item),
              leading: Icon(
                switch (item.kind) {
                  SuggestionKind.category => Icons.grid_view_outlined,
                  SuggestionKind.brand => Icons.storefront_outlined,
                  SuggestionKind.product => Icons.search,
                },
                size: 20,
                color: AppColors.onSurfaceVariant,
              ),
              title: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.bodyMd.copyWith(fontSize: 14),
              ),
              // Says what tapping will do. Without it a category and a product
              // of the same name are two identical rows with different outcomes.
              subtitle: switch (item.kind) {
                SuggestionKind.category => const Text('in Categories'),
                SuggestionKind.brand => const Text('Brand'),
                SuggestionKind.product => null,
              },
              subtitleTextStyle: AppTypography.bodyMd.copyWith(
                fontSize: 11,
                color: AppColors.onSurfaceVariant,
              ),
              trailing: const Icon(Icons.north_west, size: 16),
              dense: true,
            );
          },
        );
      },
    );
  }
}

class _SearchPrompt extends ConsumerWidget {
  const _SearchPrompt({required this.onSuggestion});

  final ValueChanged<String> onSuggestion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<String> recents =
        ref.watch(recentSearchesProvider).valueOrNull ?? const <String>[];
    final List<Category> categories =
        ref.watch(categoriesProvider).valueOrNull ?? const <Category>[];

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.containerMargin,
        AppSpacing.lg,
        AppSpacing.containerMargin,
        AppSpacing.xl,
      ),
      children: <Widget>[
        if (recents.isNotEmpty) ...<Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text('Recent searches', style: AppTypography.titleMd),
              TextButton(
                onPressed: () =>
                    ref.read(recentSearchesProvider.notifier).clear(),
                child: const Text('Clear all'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.base),
          for (final String term in recents)
            _RecentSearchRow(
              term: term,
              onTap: () => onSuggestion(term),
              onRemove: () =>
                  ref.read(recentSearchesProvider.notifier).remove(term),
            ),
          const SizedBox(height: AppSpacing.lg),
        ],
        Text('Browse by category', style: AppTypography.titleMd),
        const SizedBox(height: AppSpacing.md),
        // Real categories, not a hand-written list of "popular" terms - a
        // suggestion that returns nothing is worse than no suggestion, and
        // every chip here is guaranteed to be a category the shop stocks.
        Wrap(
          spacing: AppSpacing.base,
          runSpacing: AppSpacing.base,
          children: <Widget>[
            for (final Category category in categories)
              ActionChip(
                label: Text(category.name),
                onPressed: () => onSuggestion(category.name),
                backgroundColor: AppColors.surfaceContainerLowest,
                side: const BorderSide(color: Color(0xFFEDE3E0)),
                labelStyle: AppTypography.bodyMd.copyWith(fontSize: 13),
              ),
          ],
        ),
      ],
    );
  }
}

class _RecentSearchRow extends StatelessWidget {
  const _RecentSearchRow({
    required this.term,
    required this.onTap,
    required this.onRemove,
  });

  final String term;
  final VoidCallback onTap;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: <Widget>[
            const Icon(
              Icons.history,
              size: 19,
              color: AppColors.onSurfaceVariant,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                term,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.bodyMd.copyWith(fontSize: 14),
              ),
            ),
            IconButton(
              tooltip: 'Remove “$term” from recent searches',
              onPressed: onRemove,
              visualDensity: VisualDensity.compact,
              icon: const Icon(
                Icons.close,
                size: 17,
                color: AppColors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchResults extends ConsumerWidget {
  const _SearchResults({
    required this.query,
    required this.scrollController,
    required this.onSuggestion,
  });

  final String query;
  final ScrollController scrollController;
  final ValueChanged<String> onSuggestion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ProductSummary>> products =
        ref.watch(productListProvider);

    return products.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (Object error, StackTrace stackTrace) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                friendlyErrorMessage(error),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.md),
              TextButton(
                onPressed: () => ref.invalidate(productListProvider),
                child: const Text('TRY AGAIN'),
              ),
            ],
          ),
        ),
      ),
      data: (List<ProductSummary> items) {
        if (items.isEmpty) {
          // A dead end is where a shopper leaves. Offer the categories as a way
          // back rather than only reporting the failure.
          final List<Category> categories =
              ref.watch(categoriesProvider).valueOrNull ?? const <Category>[];
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            children: <Widget>[
              const SizedBox(height: AppSpacing.lg),
              Icon(
                Icons.search_off,
                size: 40,
                color: AppColors.onSurfaceVariant.withValues(alpha: 0.7),
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'No matches for “$query”',
                textAlign: TextAlign.center,
                style: AppTypography.titleMd,
              ),
              const SizedBox(height: AppSpacing.base),
              Text(
                'Check the spelling, or try one of these.',
                textAlign: TextAlign.center,
                style: AppTypography.bodyMd.copyWith(
                  color: AppColors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: AppSpacing.base,
                runSpacing: AppSpacing.base,
                children: <Widget>[
                  for (final Category category in categories)
                    ActionChip(
                      label: Text(category.name),
                      onPressed: () => onSuggestion(category.name),
                      backgroundColor: AppColors.surfaceContainerLowest,
                      side: const BorderSide(color: Color(0xFFEDE3E0)),
                      labelStyle: AppTypography.bodyMd.copyWith(fontSize: 13),
                    ),
                ],
              ),
            ],
          );
        }
        return CustomScrollView(
          controller: scrollController,
          slivers: <Widget>[
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.containerMargin,
                AppSpacing.md,
                AppSpacing.containerMargin,
                AppSpacing.sm,
              ),
              sliver: SliverToBoxAdapter(
                child: Text(
                  '${items.length} ${items.length == 1 ? 'result' : 'results'} for “$query”',
                  style: AppTypography.bodyMd.copyWith(
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.containerMargin,
                0,
                AppSpacing.containerMargin,
                AppSpacing.xl,
              ),
              sliver: SliverGrid(
                gridDelegate: ProductCard.gridDelegate(
                  context,
                  viewportWidth: MediaQuery.sizeOf(context).width,
                ),
                delegate: SliverChildBuilderDelegate(
                  (BuildContext context, int index) {
                    final ProductSummary product = items[index];
                    return ProductCard(
                      product: product,
                      onTap: () => context.push(
                        '/catalog/product/${product.slug}',
                      ),
                    );
                  },
                  childCount: items.length,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
