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
              aspectRatio: 3 / 4,
              child: product.thumbnailUrl == null
                  ? const ColoredBox(color: AppColors.surfaceContainer)
                  : CachedNetworkImage(
                      imageUrl: product.thumbnailUrl!,
                      fit: BoxFit.cover,
                      placeholder: (BuildContext context, String url) =>
                          const ColoredBox(color: AppColors.surfaceContainer),
                      errorWidget: (BuildContext context, String url, Object error) =>
                          const ColoredBox(color: AppColors.surfaceContainer),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodyMd,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Row(
                    children: <Widget>[
                      Text(product.pricePaise.asRupees, style: AppTypography.priceDisplay),
                      if (product.isDiscounted) ...<Widget>[
                        const SizedBox(width: AppSpacing.xs),
                        Flexible(
                          child: Text(
                            product.compareAtPricePaise!.asRupees,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.bodyMd.copyWith(
                              color: AppColors.onSurfaceVariant,
                              decoration: TextDecoration.lineThrough,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
