import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';
import '../../../../../core/theme/app_typography.dart';
import '../../../../../core/utils/money.dart';
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
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.base,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  title,
                  style: AppTypography.titleMd.copyWith(fontSize: 20),
                ),
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
                  const Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: AppColors.primary,
                  ),
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
class ProductRail extends StatefulWidget {
  const ProductRail({
    required this.title,
    required this.products,
    this.subtitle,
    this.onSeeAll,
    this.compact = false,
    super.key,
  });

  final String title;
  final String? subtitle;
  final List<ProductSummary> products;
  final VoidCallback? onSeeAll;
  final bool compact;

  /// Narrower than a grid cell on purpose: at this width the third card is
  /// half-visible at the right edge, which is what tells the shopper the row
  /// scrolls. A rail whose last card ends flush reads as a finished list.
  static const double cardWidth = 152;
  static const double compactCardWidth = 104;
  static const double compactHeight = 166;

  static double heightFor(BuildContext context) =>
      ProductCard.extentFor(context, cellWidth: cardWidth);

  @override
  State<ProductRail> createState() => _ProductRailState();
}

class _ProductRailState extends State<ProductRail> {
  final ScrollController _compactController = ScrollController();
  bool _showLeftFade = false;
  bool _showRightFade = false;

  @override
  void initState() {
    super.initState();
    _compactController.addListener(_updateEdgeFades);
  }

  @override
  void dispose() {
    _compactController
      ..removeListener(_updateEdgeFades)
      ..dispose();
    super.dispose();
  }

  void _updateEdgeFades() {
    if (!_compactController.hasClients) return;
    final ScrollPosition position = _compactController.position;
    final bool showLeft = position.pixels > 1;
    final bool showRight = position.pixels < position.maxScrollExtent - 1;
    if (showLeft == _showLeftFade && showRight == _showRightFade) return;
    if (!mounted) return;
    setState(() {
      _showLeftFade = showLeft;
      _showRightFade = showRight;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.products.isEmpty) return const SizedBox.shrink();
    if (widget.compact) {
      WidgetsBinding.instance.addPostFrameCallback(
        (Duration _) => _updateEdgeFades(),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SectionHeader(
          title: widget.title,
          subtitle: widget.subtitle,
          onSeeAll: widget.onSeeAll,
        ),
        SizedBox(
          height: widget.compact
              ? ProductRail.compactHeight
              : ProductRail.heightFor(context),
          child: widget.compact
              ? LayoutBuilder(
                  builder: (BuildContext context, BoxConstraints constraints) {
                    final double cardWidth =
                        (constraints.maxWidth - AppSpacing.md * 2 - 16) / 3;
                    return Stack(
                      children: <Widget>[
                        ListView.separated(
                          controller: _compactController,
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                          ),
                          itemCount: widget.products.length,
                          separatorBuilder: (
                            BuildContext context,
                            int index,
                          ) =>
                              const SizedBox(width: 8),
                          itemBuilder: (BuildContext context, int index) =>
                              SizedBox(
                            width: cardWidth,
                            child: _CompactProductCard(
                              product: widget.products[index],
                              onTap: () => _openProduct(
                                context,
                                widget.products[index],
                              ),
                            ),
                          ),
                        ),
                        if (_showLeftFade)
                          const Positioned(
                            left: 0,
                            top: 0,
                            bottom: 0,
                            child: _RailEdgeFade(left: true),
                          ),
                        if (_showRightFade)
                          const Positioned(
                            right: 0,
                            top: 0,
                            bottom: 0,
                            child: _RailEdgeFade(left: false),
                          ),
                      ],
                    );
                  },
                )
              : ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.containerMargin,
                  ),
                  itemCount: widget.products.length,
                  separatorBuilder: (BuildContext c, int i) =>
                      const SizedBox(width: AppSpacing.sm),
                  itemBuilder: (BuildContext context, int index) => SizedBox(
                    width: ProductRail.cardWidth,
                    child: ProductCard(
                      product: widget.products[index],
                      onTap: () => _openProduct(
                        context,
                        widget.products[index],
                      ),
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

class _RailEdgeFade extends StatelessWidget {
  const _RailEdgeFade({required this.left});

  final bool left;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SizedBox(
        width: 12,
        child: CustomPaint(
          painter: _RailEdgeShadowPainter(left: left),
        ),
      ),
    );
  }
}

class _RailEdgeShadowPainter extends CustomPainter {
  const _RailEdgeShadowPainter({required this.left});

  final bool left;

  @override
  void paint(Canvas canvas, Size size) {
    final double x = left ? 0 : size.width;
    canvas.drawLine(
      Offset(x, 12),
      Offset(x, size.height - 12),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.22)
        ..strokeWidth = 1.5
        ..strokeCap = StrokeCap.round
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
  }

  @override
  bool shouldRepaint(covariant _RailEdgeShadowPainter oldDelegate) =>
      oldDelegate.left != left;
}

class _CompactProductCard extends StatelessWidget {
  const _CompactProductCard({required this.product, required this.onTap});

  final ProductSummary product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox(
              height: 110,
              width: double.infinity,
              child: product.thumbnailUrl == null
                  ? const ColoredBox(
                      color: AppColors.surfaceContainer,
                      child: Center(
                        child: Icon(
                          Icons.checkroom_outlined,
                          size: 28,
                          color: AppColors.outlineVariant,
                        ),
                      ),
                    )
                  : CachedNetworkImage(
                      imageUrl: product.thumbnailUrl!,
                      fit: BoxFit.cover,
                      placeholder: (BuildContext context, String url) =>
                          const ColoredBox(
                        color: AppColors.surfaceContainer,
                      ),
                      errorWidget: (
                        BuildContext context,
                        String url,
                        Object error,
                      ) =>
                          const ColoredBox(
                        color: AppColors.surfaceContainer,
                        child: Center(
                          child: Icon(
                            Icons.checkroom_outlined,
                            size: 28,
                            color: AppColors.outlineVariant,
                          ),
                        ),
                      ),
                    ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(7, 5, 7, 5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      product.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.bodyMd.copyWith(fontSize: 10.5),
                    ),
                    const Spacer(),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            product.pricePaise.asRupees,
                            style: AppTypography.bodyMdBold.copyWith(
                              fontSize: 12,
                            ),
                          ),
                          if (product.isDiscounted) ...<Widget>[
                            const SizedBox(width: 3),
                            Text(
                              product.compareAtPricePaise!.asRupees,
                              style: AppTypography.bodyMd.copyWith(
                                fontSize: 9,
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
