import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';
import '../../../../../core/theme/app_typography.dart';
import '../../../data/product_model.dart';
import '../product_card.dart';

/// Title over a section, with an optional "See all" on the right.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    required this.title,
    this.subtitle,
    this.onSeeAll,
    super.key,
  });

  final String title;
  final String? subtitle;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.containerMargin,
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.sm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(title, style: AppTypography.headlineLgMobile),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: AppTypography.bodyMd.copyWith(
                      fontSize: 13,
                      color: AppColors.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (onSeeAll != null)
            TextButton(
              onPressed: onSeeAll,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    'See all',
                    style: AppTypography.bodyMdBold.copyWith(
                      fontSize: 13,
                      color: AppColors.primary,
                    ),
                  ),
                  const Icon(Icons.chevron_right,
                      size: 18, color: AppColors.primary),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A horizontally scrolling strip of products.
///
/// Renders the same [ProductCard] the grids use rather than a bespoke
/// "compact" card. Two cards would mean two places to fix a price that
/// overflows or a discount that stops striking through — and the card already
/// derives its own height from the live text styles, which is what makes it
/// safe to drop into a fixed-height rail at all.
class ProductRail extends StatelessWidget {
  const ProductRail({
    required this.title,
    required this.products,
    this.subtitle,
    this.onSeeAll,
    super.key,
  });

  final String title;
  final String? subtitle;
  final List<ProductSummary> products;
  final VoidCallback? onSeeAll;

  /// Narrower than a grid cell on purpose: at this width the third card is
  /// half-visible at the right edge, which is what tells the shopper the row
  /// scrolls. A rail whose last card ends flush reads as a finished list.
  static const double cardWidth = 152;

  static double heightFor(BuildContext context) =>
      ProductCard.extentFor(context, cellWidth: cardWidth);

  @override
  Widget build(BuildContext context) {
    if (products.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SectionHeader(title: title, subtitle: subtitle, onSeeAll: onSeeAll),
        SizedBox(
          height: heightFor(context),
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.containerMargin,
            ),
            itemCount: products.length,
            separatorBuilder: (BuildContext c, int i) =>
                const SizedBox(width: AppSpacing.sm),
            itemBuilder: (BuildContext context, int index) => SizedBox(
              width: cardWidth,
              child: ProductCard(
                product: products[index],
                onTap: () => _openProduct(context, products[index]),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// `push`, not `go`: the PDP stacks over the home tab so Back returns to
  /// this scroll position, matching how the catalog grid opens a product.
  ///
  /// Handled here rather than taking an `onTap` per rail — every rail on the
  /// page opens a PDP identically, and threading the same closure through four
  /// call sites only invites one of them to drift.
  void _openProduct(BuildContext context, ProductSummary product) {
    context.push('/catalog/product/${product.slug}');
  }
}
