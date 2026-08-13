import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../cart/data/cart_api.dart';
import '../../../cart/domain/cart_controller.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';
import '../widgets/product_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ProductSummary>> products = ref.watch(productListProvider);
    final AsyncValue<List<Category>> categories = ref.watch(categoriesProvider);
    final AsyncValue<CartView> cart = ref.watch(cartControllerProvider);
    final int cartCount = cart.valueOrNull?.itemCount ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Adorini'),
        actions: <Widget>[
          IconButton(
            icon: Badge(
              isLabelVisible: cartCount > 0,
              label: Text('$cartCount'),
              child: const Icon(Icons.shopping_bag_outlined),
            ),
            onPressed: () => context.push('/cart'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(productListProvider.future),
        child: CustomScrollView(
          slivers: <Widget>[
            // Category rail — taps drop a filter and jump to the catalog tab.
            SliverToBoxAdapter(
              child: categories.when(
                data: (List<Category> items) => SizedBox(
                  height: 48,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.containerMargin),
                    itemCount: items.length,
                    separatorBuilder: (BuildContext c, int i) => const SizedBox(width: AppSpacing.xs),
                    itemBuilder: (BuildContext context, int index) {
                      final Category category = items[index];
                      return ActionChip(
                        label: Text(category.name),
                        onPressed: () {
                          ref.read(catalogFiltersProvider.notifier).state =
                              CatalogFilters(category: category.slug);
                          context.go('/catalog');
                        },
                      );
                    },
                  ),
                ),
                error: (Object e, StackTrace s) => const SizedBox.shrink(),
                loading: () => const SizedBox(height: 48),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.all(AppSpacing.containerMargin),
              sliver: SliverToBoxAdapter(
                child: Text('New Arrivals', style: AppTypography.headlineLgMobile),
              ),
            ),
            products.when(
              data: (List<ProductSummary> items) => SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.containerMargin),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: AppSpacing.md,
                    crossAxisSpacing: AppSpacing.md,
                    childAspectRatio: 0.58,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (BuildContext context, int index) {
                      final ProductSummary product = items[index];
                      return ProductCard(
                        product: product,
                        onTap: () => context.push('/catalog/product/${product.slug}'),
                      );
                    },
                    childCount: items.length,
                  ),
                ),
              ),
              error: (Object error, StackTrace stackTrace) => SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.containerMargin),
                  child: Text('Failed to load: $error'),
                ),
              ),
              loading: () => const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(AppSpacing.xl),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
          ],
        ),
      ),
    );
  }
}
