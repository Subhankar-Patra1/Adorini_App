import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/product_model.dart';

class ProductCard extends StatelessWidget {
  const ProductCard({required this.product, required this.onTap, super.key});

  final ProductSummary product;
  final VoidCallback onTap;

  /// Aspect of the image at the top of the card.
  static const double imageAspectRatio = 3 / 4;

  /// Lines the product name is allowed before it ellipsises.
  static const int nameMaxLines = 2;

  /// Columns every product grid uses.
  static const int gridColumns = 2;

  /// Width of one cell in a [gridDelegate] grid at [viewportWidth].
  static double cellWidthFor(double viewportWidth) {
    const double horizontalPadding = AppSpacing.containerMargin * 2;
    const double gaps = AppSpacing.md * (gridColumns - 1);
    return (viewportWidth - horizontalPadding - gaps) / gridColumns;
  }

  /// The grid delegate every screen showing [ProductCard]s must use.
  ///
  /// Shared deliberately. Home and Catalog each carried their own copy of a
  /// `childAspectRatio: 0.58` delegate, so fixing the overflow in one left the
  /// other clipping product names — the card's height requirement is a
  /// property of the card, and belongs with it rather than with each caller.
  static SliverGridDelegate gridDelegate(
    BuildContext context, {
    required double viewportWidth,
  }) {
    return SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: gridColumns,
      mainAxisSpacing: AppSpacing.md,
      crossAxisSpacing: AppSpacing.md,
      mainAxisExtent:
          extentFor(context, cellWidth: cellWidthFor(viewportWidth)),
    );
  }

  /// Height one cell needs for [cellWidth]: the image, plus the caption.
  ///
  /// Derived from the live text styles rather than hardcoded, because the type
  /// scale here has been reassigned across several typefaces — a caption sized
  /// against yesterday's font is how the grid came to overflow by 38px. Also
  /// folds in the platform text scale, so accessibility sizes grow the cell
  /// instead of bursting it.
  static double extentFor(BuildContext context, {required double cellWidth}) {
    final TextScaler scaler = MediaQuery.textScalerOf(context);
    double lineHeight(TextStyle style) {
      final double size = scaler.scale(style.fontSize ?? 14);
      return size * (style.height ?? 1.2);
    }

    final double caption = AppSpacing.sm * 2 +
        lineHeight(AppTypography.bodyMd) * nameMaxLines +
        AppSpacing.xs +
        lineHeight(AppTypography.priceDisplay);

    return cellWidth / imageAspectRatio + caption;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            AspectRatio(
              aspectRatio: imageAspectRatio,
              child: product.thumbnailUrl == null
                  ? const ColoredBox(color: AppColors.surfaceContainer)
                  : CachedNetworkImage(
                      imageUrl: product.thumbnailUrl!,
                      fit: BoxFit.cover,
                      placeholder: (BuildContext context, String url) =>
                          const ColoredBox(color: AppColors.surfaceContainer),
                      errorWidget: (BuildContext context, String url,
                              Object error) =>
                          const ColoredBox(color: AppColors.surfaceContainer),
                    ),
            ),
            // Expanded, so the caption takes exactly the height the cell has
            // left rather than demanding its own. `extentFor` above sizes the
            // cell to fit this content, but a rounding difference or an
            // unusual text scale must degrade into ellipsis, never into a
            // RenderFlex overflow.
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Flexible(
                      child: Text(
                        product.name,
                        maxLines: nameMaxLines,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.bodyMd,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    // Scaled down to fit rather than ellipsised. The selling
                    // price was not flexible, so a wide amount — or a large
                    // accessibility text scale — overflowed the row by up to
                    // 67px. Making it `Flexible` would have fixed the overflow
                    // but truncated digits, and a price reading '₹2,4…' is
                    // worse than a price set a point smaller.
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            product.pricePaise.asRupees,
                            maxLines: 1,
                            style: AppTypography.priceDisplay,
                          ),
                          if (product.isDiscounted) ...<Widget>[
                            const SizedBox(width: AppSpacing.xs),
                            Text(
                              product.compareAtPricePaise!.asRupees,
                              maxLines: 1,
                              style: AppTypography.bodyMd.copyWith(
                                color: AppColors.onSurfaceVariant,
                                decoration: TextDecoration.lineThrough,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
