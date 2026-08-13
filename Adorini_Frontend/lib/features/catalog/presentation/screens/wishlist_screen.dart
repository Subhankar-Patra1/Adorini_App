import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_theme.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';
import '../widgets/product_card.dart';

class WishlistScreen extends ConsumerWidget {
  const WishlistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ProductSummary>> wishlist = ref.watch(wishlistProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Wishlist')),
      body: wishlist.when(
        data: (List<ProductSummary> items) {
          if (items.isEmpty) {
            return const Center(child: Text('Your wishlist is empty.'));
          }
          return GridView.builder(
            padding: const EdgeInsets.all(AppSpacing.containerMargin),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: AppSpacing.md,
              crossAxisSpacing: AppSpacing.md,
              childAspectRatio: 0.62,
            ),
            itemCount: items.length,
            itemBuilder: (BuildContext context, int index) {
              final ProductSummary product = items[index];
              return ProductCard(
                product: product,
                onTap: () => context.go('/catalog/product/${product.slug}'),
              );
            },
          );
        },
        error: (Object error, StackTrace stackTrace) => Center(child: Text('Failed to load: $error')),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}
