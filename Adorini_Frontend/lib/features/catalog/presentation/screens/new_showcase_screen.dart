import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/product_model.dart';
import '../../domain/home_providers.dart';

/// Full-bleed showcase for the newest pieces.
///
/// A deliberate counterpoint to the grid: one garment at a time, large, with
/// the surrounding chrome stripped back. Grids are for comparing, this is for
/// looking — so it carries no filters, no sort and no infinite scroll.
///
/// Reached from the "New" tile in the home category rail, and pushed above the
/// tab shell rather than living inside it: the bottom bar would halve the
/// space the garment has and break the full-bleed composition.
class NewShowcaseScreen extends ConsumerWidget {
  const NewShowcaseScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ProductSummary>> products =
        ref.watch(newArrivalsProvider);

    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: products.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object error, StackTrace stack) => _ShowcaseMessage(
            message: friendlyErrorMessage(error),
            actionLabel: 'Retry',
            onAction: () => ref.invalidate(newArrivalsProvider),
          ),
          data: (List<ProductSummary> items) {
            if (items.isEmpty) {
              return const _ShowcaseMessage(
                message: 'Nothing new just yet. Check back soon.',
              );
            }
            return _Showcase(products: items);
          },
        ),
      ),
    );
  }
}

class _Showcase extends StatefulWidget {
  const _Showcase({required this.products});

  final List<ProductSummary> products;

  @override
  State<_Showcase> createState() => _ShowcaseState();
}

class _ShowcaseState extends State<_Showcase> {
  /// Under 1.0 so the neighbouring garments stay on screen at the edges.
  /// Without them the rotation has nothing to read against and the effect
  /// collapses into a plain fade.
  static const double _viewportFraction = 0.68;

  late final PageController _controller =
      PageController(viewportFraction: _viewportFraction);

  /// Tracked separately from [_controller] because the caption below the
  /// carousel changes on *settle*, while the transform reads the continuous
  /// scroll position on every frame. Driving the text off the raw offset would
  /// have the name flickering between two products mid-swipe.
  int _settled = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ProductSummary current = widget.products[_settled];

    return Column(
      children: <Widget>[
        _TopBar(onClose: () => context.pop()),
        const SizedBox(height: AppSpacing.base),
        Text(
          'NEW THIS WEEK',
          style: AppTypography.labelBold.copyWith(
            fontSize: 10,
            letterSpacing: 1.8,
            color: AppColors.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text('Adorini', style: AppTypography.titleMd.copyWith(fontSize: 20)),

        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: <Widget>[
              _IndexMarkers(
                current: _settled,
                total: widget.products.length,
              ),
              PageView.builder(
                controller: _controller,
                onPageChanged: (int i) => setState(() => _settled = i),
                itemCount: widget.products.length,
                itemBuilder: (BuildContext context, int index) =>
                    _RotatingCard(
                  controller: _controller,
                  index: index,
                  product: widget.products[index],
                ),
              ),
            ],
          ),
        ),

        _Dots(count: widget.products.length, active: _settled),
        const SizedBox(height: AppSpacing.md),

        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.containerMargin,
          ),
          child: Column(
            children: <Widget>[
              Text(
                current.name,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.headlineLgMobile.copyWith(height: 1.15),
              ),
              const SizedBox(height: 6),
              Text(
                // The print technique when the garment has one, the fabric
                // otherwise — never an invented tagline. Both come off the
                // summary the grid already loads, so this costs no request.
                current.printTechnique?.label ??
                    (current.fabricType.wire == 'STRETCH'
                        ? 'Stretch fit'
                        : 'Structured fit'),
                style: AppTypography.bodyMd.copyWith(
                  fontSize: 13,
                  color: AppColors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _ActionBar(
          product: current,
          onOpen: () => context.push('/catalog/product/${current.slug}'),
        ),
        const SizedBox(height: AppSpacing.md),
      ],
    );
  }
}

/// One garment, rotated in perspective according to how far it sits from the
/// centre of the viewport.
class _RotatingCard extends StatelessWidget {
  const _RotatingCard({
    required this.controller,
    required this.index,
    required this.product,
  });

  final PageController controller;
  final int index;
  final ProductSummary product;

  /// Radians the card turns at a full page away. Past roughly 0.6 the outgoing
  /// card turns far enough to read as a flat sliver rather than a garment
  /// swinging away, so the depth stops being legible.
  static const double _maxTurn = 0.52;

  /// The perspective divisor. Small numbers are strong perspective; this is
  /// the shallow end, because a wide field of view on a phone-sized card
  /// distorts the print on the fabric rather than reading as depth.
  static const double _perspective = 0.0011;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (BuildContext context, Widget? child) {
        // `page` is null until the viewport has been laid out, and reading
        // `controller.page` then throws. Falling back to the initial page
        // renders the first frame flat rather than crashing on it.
        final double page = controller.hasClients &&
                controller.position.haveDimensions
            ? controller.page ?? controller.initialPage.toDouble()
            : controller.initialPage.toDouble();

        final double delta = (index - page).clamp(-1.5, 1.5);
        final double distance = delta.abs();

        // Shrinks with distance so the centre garment reads as nearest.
        final double shrink = 1 - (distance * 0.16).clamp(0.0, 0.32);
        final Matrix4 transform = Matrix4.identity()
          ..setEntry(3, 2, _perspective)
          ..rotateY(delta * _maxTurn)
          // `scaleByDouble` rather than `scale`: the latter is deprecated in
          // vector_math, and its untyped signature silently accepts a Vector3
          // where a uniform factor was meant.
          ..scaleByDouble(shrink, shrink, shrink, 1);

        return Transform(
          alignment: Alignment.center,
          transform: transform,
          child: Opacity(
            // Never fully transparent: the neighbours are what give the
            // rotation something to be read against.
            opacity: (1 - distance * 0.45).clamp(0.35, 1.0),
            child: child,
          ),
        );
      },
      child: _GarmentPlate(product: product),
    );
  }
}

/// The garment image, its rounded plate and the soft shadow beneath it.
class _GarmentPlate extends StatelessWidget {
  const _GarmentPlate({required this.product});

  final ProductSummary product;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.base,
        vertical: AppSpacing.lg,
      ),
      child: Column(
        children: <Widget>[
          Expanded(
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: AppColors.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(28),
                // Outlined as well as shadowed. The plate is white on a
                // near-white ground, so with no imagery behind it the shadow
                // alone left the garment area invisible — on device it read as
                // an empty screen with a smudge near the bottom.
                border: Border.all(color: AppColors.divider),
                boxShadow: <BoxShadow>[
                  BoxShadow(
                    color: AppColors.onSurface.withValues(alpha: 0.16),
                    blurRadius: 34,
                    offset: const Offset(0, 18),
                  ),
                ],
              ),
              child: product.thumbnailUrl == null
                  ? const _PlateFallback()
                  : CachedNetworkImage(
                      imageUrl: product.thumbnailUrl!,
                      fit: BoxFit.cover,
                      placeholder: (BuildContext c, String u) =>
                          const ColoredBox(color: AppColors.surfaceContainer),
                      errorWidget: (BuildContext c, String u, Object e) =>
                          const _PlateFallback(),
                    ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          // Contact shadow, separate from the plate's own drop shadow. It sits
          // in the same 3D transform as the card, so it turns with it and the
          // garment keeps looking planted rather than pasted on.
          Container(
            width: 120,
            height: 12,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              gradient: RadialGradient(
                colors: <Color>[
                  AppColors.onSurface.withValues(alpha: 0.18),
                  AppColors.onSurface.withValues(alpha: 0),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Fills the plate when a garment has no photograph.
class _PlateFallback extends StatelessWidget {
  const _PlateFallback();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: AppColors.surfaceContainer,
      child: Center(
        child: Icon(
          Icons.checkroom_outlined,
          size: 64,
          color: AppColors.outlineVariant,
        ),
      ),
    );
  }
}

/// The `01` / `02` numerals flanking the carousel.
class _IndexMarkers extends StatelessWidget {
  const _IndexMarkers({required this.current, required this.total});

  final int current;
  final int total;

  String _two(int n) => n.toString().padLeft(2, '0');

  @override
  Widget build(BuildContext context) {
    final TextStyle style = AppTypography.bodyMd.copyWith(
      fontSize: 12,
      letterSpacing: 1.2,
      color: AppColors.outline,
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Text(_two(current + 1), style: style),
          Text(_two(total), style: style),
        ],
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.sm,
        AppSpacing.base,
        AppSpacing.sm,
        0,
      ),
      child: Row(
        children: <Widget>[
          TextButton(onPressed: onClose, child: const Text('Back')),
          const Spacer(),
          IconButton(
            onPressed: () => context.push('/cart'),
            icon: const Icon(Icons.shopping_bag_outlined),
            tooltip: 'Bag',
          ),
        ],
      ),
    );
  }
}

/// Price, the primary action, and the discount if there is one.
///
/// The centre control opens the product rather than adding to the bag: the
/// cart API takes a `variantId`, and a summary has no variants on it — so an
/// add button here would have to guess a size. Choosing one for the shopper is
/// how a garment gets returned.
class _ActionBar extends StatelessWidget {
  const _ActionBar({required this.product, required this.onOpen});

  final ProductSummary product;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.containerMargin,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  product.pricePaise.asRupees,
                  style: AppTypography.priceDisplay.copyWith(fontSize: 20),
                ),
                if (product.isDiscounted)
                  Text(
                    product.compareAtPricePaise!.asRupees,
                    style: AppTypography.bodyMd.copyWith(
                      fontSize: 13,
                      color: AppColors.onSurfaceVariant,
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
              ],
            ),
          ),
          GestureDetector(
            onTap: onOpen,
            child: Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary,
                boxShadow: <BoxShadow>[
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.32),
                    blurRadius: 18,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: const Icon(Icons.arrow_forward,
                  color: AppColors.onPrimary, size: 26),
            ),
          ),
          Expanded(
            child: Align(
              alignment: Alignment.centerRight,
              child: Text(
                'View\ndetails',
                textAlign: TextAlign.right,
                style: AppTypography.bodyMd.copyWith(
                  fontSize: 12,
                  height: 1.3,
                  color: AppColors.onSurfaceVariant,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.active});

  final int count;
  final int active;

  @override
  Widget build(BuildContext context) {
    // Capped: ten products would otherwise draw a row of dots wider than it is
    // readable. Past the cap the row shows a window around the active index.
    const int maxDots = 7;
    final int start = count <= maxDots
        ? 0
        : math.min(
            math.max(0, active - maxDots ~/ 2),
            count - maxDots,
          );
    final int end = math.min(count, start + maxDots);

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        for (int i = start; i < end; i++) ...<Widget>[
          if (i > start) const SizedBox(width: 6),
          AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            width: i == active ? 16 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == active ? AppColors.primary : AppColors.outlineVariant,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
        ],
      ],
    );
  }
}

class _ShowcaseMessage extends StatelessWidget {
  const _ShowcaseMessage({
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppTypography.bodyMd.copyWith(
                color: AppColors.onSurfaceVariant,
              ),
            ),
            if (actionLabel != null) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}
