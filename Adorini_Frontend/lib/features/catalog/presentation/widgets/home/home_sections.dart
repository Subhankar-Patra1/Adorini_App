import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';
import '../../../../../core/theme/app_typography.dart';
import '../../../../content_videos/data/videos_api.dart';
import '../../../../content_videos/domain/videos_providers.dart';
import '../../../data/catalog_api.dart';
import '../../../data/product_model.dart';
import '../../../domain/catalog_providers.dart';
import '../../../domain/home_providers.dart';
import '../product_card.dart';
import 'home_skeletons.dart';
import 'product_rail.dart';

/// Compact, image-led category shortcuts.
///
/// `Category` itself has no image, so the first available Home-feed product in
/// each category supplies its thumbnail. Categories stay in a compact,
/// horizontally scrollable two-row grid so the Home page does not grow taller
/// as the catalog expands.
class CategoryRail extends ConsumerWidget {
  const CategoryRail({super.key});

  static const double _diameter = 60;
  static const double _itemWidth = 76;
  static const double _tileHeight = 88;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<Category>> categories = ref.watch(categoriesProvider);
    final List<ProductSummary> homeProducts =
        ref.watch(homeFeedProvider).valueOrNull ?? <ProductSummary>[];

    return categories.when(
      loading: () => const SizedBox(
        height: _tileHeight * 2 + 8,
        child: RailSkeleton(cardWidth: _itemWidth, height: _diameter),
      ),
      // Silent on failure. The rail is a shortcut to a tab that is one tap
      // away in the bottom bar regardless, so an error card here would spend
      // the shopper's attention on something they lose nothing by missing.
      error: (Object e, StackTrace s) => const SizedBox.shrink(),
      data: (List<Category> resolved) {
        return SizedBox(
          height: _tileHeight * 2 + 2,
          child: GridView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(6, 0, 6, 1),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisExtent: 83,
              mainAxisSpacing: 1,
              crossAxisSpacing: 0,
            ),
            itemCount: resolved.length + 1,
            itemBuilder: (BuildContext context, int index) {
              if (index == 0) {
                return _NewTile(
                  imageUrl: _firstPreview(homeProducts),
                  onTap: () => context.push('/new'),
                );
              }
              final Category category = resolved[index - 1];
              return _CategoryTile(
                category: category,
                imageUrl: _previewFor(category.slug, homeProducts),
                onTap: () {
                  ref.read(catalogFiltersProvider.notifier).state =
                      CatalogFilters(category: category.slug);
                  context.go('/catalog');
                },
              );
            },
          ),
        );
      },
    );
  }

  static String? _previewFor(
    String categorySlug,
    List<ProductSummary> products,
  ) {
    for (final ProductSummary product in products) {
      if (product.categorySlug == categorySlug &&
          product.thumbnailUrl != null &&
          product.thumbnailUrl!.isNotEmpty) {
        return product.thumbnailUrl;
      }
    }
    return null;
  }

  static String? _firstPreview(List<ProductSummary> products) {
    for (final ProductSummary product in products) {
      if (product.thumbnailUrl != null && product.thumbnailUrl!.isNotEmpty) {
        return product.thumbnailUrl;
      }
    }
    return null;
  }
}

/// Editorial entry point for the newest collection. It is deliberately not a
/// synthetic backend category: tapping it opens the dedicated showcase.
class _NewTile extends StatelessWidget {
  const _NewTile({required this.imageUrl, required this.onTap});

  final String? imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'New arrivals',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: CategoryRail._itemWidth,
          child: Column(
            children: <Widget>[
              Container(
                width: CategoryRail._diameter,
                height: CategoryRail._diameter,
                padding: const EdgeInsets.all(2.5),
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primaryContainer,
                ),
                child: ClipOval(
                  child: imageUrl == null
                      ? const _CategoryPlaceholder(icon: Icons.auto_awesome)
                      : CachedNetworkImage(
                          imageUrl: imageUrl!,
                          fit: BoxFit.cover,
                          placeholder: (BuildContext context, String url) =>
                              const _CategoryPlaceholder(
                            icon: Icons.auto_awesome,
                          ),
                          errorWidget: (
                            BuildContext context,
                            String url,
                            Object error,
                          ) =>
                              const _CategoryPlaceholder(
                            icon: Icons.auto_awesome,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'New',
                maxLines: 1,
                textAlign: TextAlign.center,
                style: AppTypography.bodyMdBold.copyWith(
                  fontSize: 10.5,
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

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.category,
    required this.imageUrl,
    required this.onTap,
  });

  final Category category;
  final String? imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '${category.name}, sizes 40 to 48',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: CategoryRail._itemWidth,
          child: Column(
            children: <Widget>[
              Container(
                width: CategoryRail._diameter,
                height: CategoryRail._diameter,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.surfaceContainer,
                  border: Border.all(
                    color: AppColors.outlineVariant,
                    width: 0.8,
                  ),
                ),
                child: imageUrl == null
                    ? const _CategoryPlaceholder()
                    : CachedNetworkImage(
                        imageUrl: imageUrl!,
                        fit: BoxFit.cover,
                        placeholder: (BuildContext context, String url) =>
                            const _CategoryPlaceholder(),
                        errorWidget: (
                          BuildContext context,
                          String url,
                          Object error,
                        ) =>
                            const _CategoryPlaceholder(),
                      ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                category.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: AppTypography.bodyMd.copyWith(
                  fontSize: 10.5,
                  height: 1.05,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CategoryPlaceholder extends StatelessWidget {
  const _CategoryPlaceholder({this.icon = Icons.checkroom});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            AppColors.primaryContainer,
            AppColors.surfaceContainer,
          ],
        ),
      ),
      child: Center(
        child: Icon(icon, size: 24, color: AppColors.primary),
      ),
    );
  }
}

/// The reassurance block — the promises a first-time shopper checks for before
/// they will put anything in a bag.
///
/// Led by custom sizing, which is the differentiator rather than a hygiene
/// factor: returns, COD and secure payment are what every store offers and
/// their job is only to remove doubt, whereas "we will make it in your size"
/// is a reason to choose Adorini over the next tab. Levelling it into the
/// four-up row would have buried the one claim worth reading.
///
/// Every claim here is one the app actually implements: returns has a whole
/// feature module, COD is a checkout path with its own verification screen,
/// and the size request is a real endpoint writing a real `size_enquiries`
/// row. Nothing in this block is aspirational.
class TrustStrip extends StatelessWidget {
  const TrustStrip({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: <Widget>[
        _CustomSizingCard(),
        _PromiseRow(),
      ],
    );
  }
}

/// The custom-size order path, given its own card.
///
/// Copy deliberately carries no size numbers. The stocked band is per-category
/// now — blouses run 32–36 where kurtis run 40–48 — so a headline quoting one
/// range would be wrong on half the catalog the moment it shipped.
///
/// It also does not promise a price or a turnaround. The flow it points at
/// records a request and has the team make contact; saying anything firmer
/// here would be the app committing on the team's behalf.
class _CustomSizingCard extends StatelessWidget {
  const _CustomSizingCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.containerMargin,
        AppSpacing.md,
        AppSpacing.containerMargin,
        AppSpacing.sm,
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            AppColors.primaryContainer,
            AppColors.tertiaryContainer,
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.surfaceContainerLowest,
                ),
                child: const Icon(
                  Icons.straighten,
                  size: 22,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'CUSTOM SIZE ORDERS',
                      style: AppTypography.labelBold.copyWith(
                        fontSize: 10,
                        letterSpacing: 1.4,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      'Not your size? We’ll make it.',
                      style: AppTypography.titleMd.copyWith(
                        fontSize: 18,
                        color: AppColors.onSurface,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          // Outside the icon's row on purpose, so the paragraph and the CTA
          // both start at the card's left edge rather than indenting to clear
          // the medallion. Only the eyebrow and the headline sit beside the
          // icon — they are what it labels; the body is not.
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Every product page takes a size request. Tell us the size '
            'you need and our team gets in touch to arrange it.',
            style: AppTypography.bodyMd.copyWith(
              fontSize: 12.5,
              height: 1.45,
              color: AppColors.onSurfaceVariant,
            ),
          ),
          const _CustomSizingCta(),
        ],
      ),
    );
  }
}

/// The card's call to action, on its own full-width row.
///
/// Deliberately *not* inside the row that carries the icon: sharing that row
/// left it about 307pt, and the label truncated to "make it your o…". Below the
/// text block it gets the card's whole width, which fits the line with room to
/// spare and reads as a footer to the message rather than a fragment of it.
class _CustomSizingCta extends StatelessWidget {
  const _CustomSizingCta();

  @override
  Widget build(BuildContext context) {
    // Routes to the catalog rather than opening the request sheet: an enquiry
    // is recorded against a product, so there is nothing to submit until one
    // has been chosen. Sending the shopper to pick a garment is the honest
    // first step, not a detour.
    return GestureDetector(
      onTap: () => context.go('/catalog'),
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.only(top: AppSpacing.sm),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(
                'Explore products and make it your own',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.bodyMdBold.copyWith(
                  fontSize: 13,
                  color: AppColors.primary,
                ),
              ),
            ),
            const SizedBox(width: 6),
            const Icon(Icons.arrow_forward, size: 16, color: AppColors.primary),
          ],
        ),
      ),
    );
  }
}

class _PromiseRow extends StatelessWidget {
  const _PromiseRow();

  @override
  Widget build(BuildContext context) {
    const List<(IconData, String)> promises = <(IconData, String)>[
      (Icons.assignment_return_outlined, 'Easy\nreturns'),
      (Icons.payments_outlined, 'Cash on\ndelivery'),
      (Icons.verified_user_outlined, 'Secure\npayments'),
      (Icons.local_shipping_outlined, 'Pan-India\ndelivery'),
    ];

    return Container(
      margin: const EdgeInsets.only(
        left: AppSpacing.containerMargin,
        right: AppSpacing.containerMargin,
        bottom: AppSpacing.md,
      ),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.divider),
      ),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < promises.length; i++) ...<Widget>[
            if (i > 0)
              Container(width: 1, height: 34, color: AppColors.divider),
            Expanded(
              child: Column(
                children: <Widget>[
                  Icon(promises[i].$1, size: 22, color: AppColors.primary),
                  const SizedBox(height: 6),
                  Text(
                    promises[i].$2,
                    textAlign: TextAlign.center,
                    style: AppTypography.bodyMd.copyWith(
                      fontSize: 11,
                      height: 1.25,
                      color: AppColors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Teaser for the reels tab: portrait thumbnails that open the feed.
///
/// Thumbnails only — no autoplaying video. A home page that starts decoding
/// clips the moment it appears costs battery and mobile data for content the
/// shopper has not asked for, and the reels tab is one tap away.
class ReelsStrip extends ConsumerWidget {
  const ReelsStrip({super.key});

  static const double _width = 116;
  static const double _height = 174;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<VideoFeedItem>> feed = ref.watch(videoFeedProvider);

    return feed.maybeWhen(
      orElse: () => const SizedBox.shrink(),
      data: (List<VideoFeedItem> items) {
        if (items.isEmpty) return const SizedBox.shrink();
        final List<VideoFeedItem> shown = items.take(8).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SectionHeader(
              title: 'Shop the look',
              subtitle: 'Styled on real people, tap to shop',
              onSeeAll: () => context.go('/videos'),
            ),
            SizedBox(
              height: _height,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.containerMargin,
                ),
                itemCount: shown.length,
                separatorBuilder: (BuildContext c, int i) =>
                    const SizedBox(width: AppSpacing.sm),
                itemBuilder: (BuildContext context, int index) =>
                    _ReelTile(item: shown[index]),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ReelTile extends StatelessWidget {
  const _ReelTile({required this.item});

  final VideoFeedItem item;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.go('/videos'),
      child: Container(
        width: ReelsStrip._width,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: AppColors.surfaceContainer,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (item.thumbnailUrl != null)
              CachedNetworkImage(
                imageUrl: item.thumbnailUrl!,
                fit: BoxFit.cover,
                placeholder: (BuildContext c, String u) =>
                    const ColoredBox(color: AppColors.surfaceContainer),
                errorWidget: (BuildContext c, String u, Object e) =>
                    const ColoredBox(color: AppColors.surfaceContainer),
              ),
            // Bottom scrim under the play glyph and the tagged-count pill, so
            // both stay readable over a bright frame.
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.center,
                  end: Alignment.bottomCenter,
                  colors: <Color>[Colors.transparent, Color(0x991E1B19)],
                ),
              ),
            ),
            const Center(
              child:
                  Icon(Icons.play_circle_fill, size: 34, color: Colors.white70),
            ),
            if (item.taggedProducts.isNotEmpty)
              Positioned(
                left: 8,
                bottom: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${item.taggedProducts.length} items',
                    style: AppTypography.labelBold.copyWith(
                      fontSize: 10,
                      color: AppColors.onSurface,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Closing editorial panel — the brand's voice, after the merchandising.
class EditorialPanel extends StatelessWidget {
  const EditorialPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.containerMargin,
        AppSpacing.lg,
        AppSpacing.containerMargin,
        AppSpacing.base,
      ),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.tertiaryContainer,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'CRAFTED IN INDIA',
            style: AppTypography.labelBold.copyWith(
              fontSize: 10,
              letterSpacing: 1.6,
              color: AppColors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.base),
          Text(
            'Adore the elegance\nyou owe yourself',
            style: AppTypography.headlineLgMobile.copyWith(
              height: 1.2,
              color: AppColors.onSurface,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Every piece is block-printed and finished by hand, so no two are '
            'ever identical.',
            style: AppTypography.bodyMd.copyWith(
              fontSize: 13,
              height: 1.5,
              color: AppColors.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown when a rail's request fails.
///
/// Inline and retryable rather than a snackbar: one rail failing is not a
/// failure of the page, and the shopper should not have to pull-to-refresh
/// everything to recover a single strip.
class SectionError extends StatelessWidget {
  const SectionError({required this.message, required this.onRetry, super.key});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: AppSpacing.containerMargin,
        vertical: AppSpacing.base,
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.cloud_off_outlined,
              size: 20, color: AppColors.onSurfaceVariant),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: AppTypography.bodyMd.copyWith(
                fontSize: 13,
                color: AppColors.onSurfaceVariant,
              ),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

/// Grid of products for the endless feed at the foot of the page.
///
/// A sliver rather than a boxed grid so it shares the page's single scroll
/// view — nesting a second scrollable would either fight the outer one or
/// force the whole catalog to lay out at once.
class HomeProductGrid extends StatelessWidget {
  const HomeProductGrid({required this.products, super.key});

  final List<ProductSummary> products;

  @override
  Widget build(BuildContext context) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.containerMargin,
      ),
      sliver: SliverGrid(
        gridDelegate: ProductCard.gridDelegate(
          context,
          viewportWidth: MediaQuery.sizeOf(context).width,
        ),
        delegate: SliverChildBuilderDelegate(
          (BuildContext context, int index) => ProductCard(
            product: products[index],
            onTap: () =>
                context.push('/catalog/product/${products[index].slug}'),
          ),
          childCount: products.length,
        ),
      ),
    );
  }
}
