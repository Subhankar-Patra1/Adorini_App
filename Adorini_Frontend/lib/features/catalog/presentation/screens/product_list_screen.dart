import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';
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

  /// Fetches the next cursor page once the grid is within ~2 rows of the end.
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final double remaining = _scrollController.position.maxScrollExtent -
        _scrollController.position.pixels;
    if (remaining < 600) {
      ref.read(productListProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<ProductSummary>> products =
        ref.watch(productListProvider);
    final bool hasFilters = !ref.watch(catalogFiltersProvider).isEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Catalog'),
        actions: <Widget>[
          IconButton(
            icon: Badge(
              isLabelVisible: hasFilters,
              child: const Icon(Icons.tune),
            ),
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              builder: (BuildContext context) => const FilterBottomSheet(),
            ),
          ),
        ],
      ),
      body: products.when(
        data: (List<ProductSummary> items) {
          if (items.isEmpty) {
            return const Center(child: Text('No products match your filters.'));
          }
          return GridView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.all(AppSpacing.containerMargin),
            // Measured, not guessed. `childAspectRatio` cannot work here: the
            // image scales with the cell width while the caption is a fixed
            // stack of text, so the ratio that fits one screen width overflows
            // another. At 393pt the old 0.58 left 65.8pt for a caption needing
            // 104pt — the 38px overflow.
            gridDelegate: ProductCard.gridDelegate(
              context,
              viewportWidth: MediaQuery.sizeOf(context).width,
            ),
            itemCount: items.length,
            itemBuilder: (BuildContext context, int index) {
              final ProductSummary product = items[index];
              return ProductCard(
                product: product,
                // The PDP is keyed by slug, not id.
                onTap: () => context.push('/catalog/product/${product.slug}'),
              );
            },
          );
        },
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text(friendlyErrorMessage(error))),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}
