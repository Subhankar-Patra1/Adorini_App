import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../../cart/domain/cart_controller.dart';
import '../../data/pdp_api.dart';
import '../../domain/pdp_providers.dart';
import '../widgets/size_enquiry_sheet.dart';

/// Keyed by product **slug** — the backend route is `/pdp/:slug`.
class PdpScreen extends ConsumerStatefulWidget {
  const PdpScreen({required this.slug, super.key});

  final String slug;

  @override
  ConsumerState<PdpScreen> createState() => _PdpScreenState();
}

class _PdpScreenState extends ConsumerState<PdpScreen> {
  int? _selectedSize;
  String? _selectedColour;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<ProductDetail> product = ref.watch(productDetailProvider(widget.slug));

    return Scaffold(
      body: product.when(
        data: (ProductDetail detail) => _Body(
          detail: detail,
          selectedSize: _selectedSize,
          selectedColour: _selectedColour,
          onSizeChanged: (int? size) => setState(() => _selectedSize = size),
          onColourChanged: (String? colour) => setState(() => _selectedColour = colour),
        ),
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text('Failed to load product: $error')),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({
    required this.detail,
    required this.selectedSize,
    required this.selectedColour,
    required this.onSizeChanged,
    required this.onColourChanged,
  });

  final ProductDetail detail;
  final int? selectedSize;
  final String? selectedColour;
  final ValueChanged<int?> onSizeChanged;
  final ValueChanged<String?> onColourChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The cart takes a variantId, never a productId.
    final ProductVariant? variant = selectedSize == null
        ? null
        : detail.variantFor(size: selectedSize!, colour: selectedColour);
    final bool canAdd = variant != null && variant.inStock;

    return CustomScrollView(
      slivers: <Widget>[
        SliverAppBar(
          expandedHeight: 440,
          pinned: true,
          flexibleSpace: FlexibleSpaceBar(
            background: detail.officialMedia.isEmpty
                ? const ColoredBox(color: AppColors.surfaceContainer)
                : PageView(
                    children: detail.officialMedia
                        .map((MediaItem m) => CachedNetworkImage(
                              imageUrl: m.url,
                              fit: BoxFit.cover,
                              errorWidget: (BuildContext c, String u, Object e) =>
                                  const ColoredBox(color: AppColors.surfaceContainer),
                            ))
                        .toList(),
                  ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.all(AppSpacing.containerMargin),
          sliver: SliverList(
            delegate: SliverChildListDelegate(<Widget>[
              Text(detail.brandName.toUpperCase(), style: AppTypography.labelBold),
              const SizedBox(height: AppSpacing.xs),
              Text(detail.name, style: AppTypography.headlineLgMobile),
              const SizedBox(height: AppSpacing.xs),
              Row(
                children: <Widget>[
                  Text(detail.pricePaise.asRupees, style: AppTypography.priceDisplay),
                  if (detail.isDiscounted) ...<Widget>[
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      detail.compareAtPricePaise!.asRupees,
                      style: AppTypography.bodyMd.copyWith(
                        color: AppColors.onSurfaceVariant,
                        decoration: TextDecoration.lineThrough,
                      ),
                    ),
                  ],
                ],
              ),

              if (detail.reviewSummary.totalCount > 0) ...<Widget>[
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: <Widget>[
                    const Icon(Icons.star, size: 18),
                    const SizedBox(width: AppSpacing.xs),
                    Text(
                      '${detail.reviewSummary.averageRating?.toStringAsFixed(1) ?? '–'} '
                      '(${detail.reviewSummary.totalCount})',
                      style: AppTypography.bodyMd,
                    ),
                  ],
                ),
              ],

              // The fit signal that justifies the whole size-chart feature.
              if (detail.reviewSummary.dominantFitTag != null &&
                  detail.reviewSummary.dominantFitTag != FitTag.trueToSize) ...<Widget>[
                const SizedBox(height: AppSpacing.sm),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.tertiaryContainer,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Text(
                    'Most buyers say this ${detail.reviewSummary.dominantFitTag!.label.toLowerCase()}.',
                    style: AppTypography.bodyMd,
                  ),
                ),
              ],

              const SizedBox(height: AppSpacing.lg),
              Text('Size', style: AppTypography.labelBold),
              const SizedBox(height: AppSpacing.xs),
              Wrap(
                spacing: AppSpacing.xs,
                children: detail.availableSizes.map((int size) {
                  return ChoiceChip(
                    label: Text('$size'),
                    selected: selectedSize == size,
                    onSelected: (bool selected) => onSizeChanged(selected ? size : null),
                  );
                }).toList(),
              ),
              const SizedBox(height: AppSpacing.xs),
              TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (BuildContext context) => SizeEnquirySheet(slug: detail.slug),
                ),
                child: const Text('Need a size outside 40–48?'),
              ),

              if (detail.availableColours.length > 1) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                Text('Colour', style: AppTypography.labelBold),
                const SizedBox(height: AppSpacing.xs),
                Wrap(
                  spacing: AppSpacing.xs,
                  children: detail.availableColours.map((String colour) {
                    return ChoiceChip(
                      label: Text(colour),
                      selected: selectedColour == colour,
                      onSelected: (bool selected) => onColourChanged(selected ? colour : null),
                    );
                  }).toList(),
                ),
              ],

              if (detail.description != null) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                Text(detail.description!, style: AppTypography.bodyMd),
              ],

              const SizedBox(height: AppSpacing.xl),
              ElevatedButton(
                onPressed: !canAdd
                    ? null
                    : () async {
                        await ref
                            .read(cartControllerProvider.notifier)
                            .addItem(variantId: variant.id);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: const Text('Added to cart'),
                              action: SnackBarAction(
                                label: 'VIEW CART',
                                onPressed: () => context.push('/cart'),
                              ),
                            ),
                          );
                        }
                      },
                child: Text(
                  selectedSize == null
                      ? 'SELECT A SIZE'
                      : (canAdd ? 'ADD TO CART' : 'OUT OF STOCK'),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
            ]),
          ),
        ),
      ],
    );
  }
}
