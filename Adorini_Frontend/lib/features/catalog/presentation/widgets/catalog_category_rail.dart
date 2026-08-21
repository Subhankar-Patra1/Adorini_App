import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';

/// Meesho-style master navigation, driven by the catalogue's own category list.
class CatalogCategoryRail extends ConsumerWidget {
  const CatalogCategoryRail({
    required this.selectedSlug,
    required this.previewProducts,
    required this.onSelected,
    super.key,
  });

  final String? selectedSlug;
  final List<ProductSummary> previewProducts;
  final ValueChanged<String?> onSelected;

  static const double width = 86;

  /// The "New arrivals" entry, which is a sort rather than a category and so
  /// has no slug. Everything below it comes from the API.
  static const ({String label, String fullName, String? slug}) _newEntry =
      (label: 'New', fullName: 'New arrivals', slug: null);

  /// Wraps a long category name so it fits the 86pt rail without ellipsis.
  /// "Three-Piece Set" is two lines here; forcing it to one would truncate it
  /// to "Three-Piec…", which reads as a rendering fault rather than a label.
  static String _wrapLabel(String name) => name.replaceFirst(' ', '\n');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Previously a hardcoded list of five slugs, which is why Palazzo,
    // Leggings, Straight Pant, Pencil Pant, One-Piece and Kaftaan were
    // unreachable from this tab no matter what the catalogue stocked — and why
    // the labels here still read "Kurtis" long after the category was renamed
    // to "Kurti". The names, the order and the membership are the server's.
    final List<({String label, String fullName, String? slug})> entries =
        <({String label, String fullName, String? slug})>[
      _newEntry,
      ...(ref.watch(categoriesProvider).valueOrNull ?? const <Category>[]).map(
        (Category c) => (
          label: _wrapLabel(c.name),
          fullName: c.name,
          slug: c.slug,
        ),
      ),
    ];

    return ColoredBox(
      color: AppColors.surfaceContainer,
      child: SizedBox(
        width: width,
        child: ListView.builder(
          padding: const EdgeInsets.only(bottom: 108),
          itemCount: entries.length,
          itemBuilder: (BuildContext context, int index) {
            final ({String label, String fullName, String? slug}) entry =
                entries[index];
            final bool selected = selectedSlug == entry.slug;
            return _CategoryRailItem(
              label: entry.label,
              semanticsLabel: entry.fullName,
              imageUrl: _previewFor(entry.slug),
              selected: selected,
              isNew: entry.slug == null,
              onTap: () => onSelected(entry.slug),
            );
          },
        ),
      ),
    );
  }

  String? _previewFor(String? slug) {
    for (final ProductSummary product in previewProducts) {
      if ((slug == null || product.categorySlug == slug) &&
          product.thumbnailUrl != null &&
          product.thumbnailUrl!.isNotEmpty) {
        return product.thumbnailUrl;
      }
    }
    return null;
  }
}

class _CategoryRailItem extends StatelessWidget {
  const _CategoryRailItem({
    required this.label,
    required this.semanticsLabel,
    required this.imageUrl,
    required this.selected,
    required this.isNew,
    required this.onTap,
  });

  final String label;
  final String semanticsLabel;
  final String? imageUrl;
  final bool selected;
  final bool isNew;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: semanticsLabel,
      child: Material(
        color: selected
            ? AppColors.surfaceContainerLowest
            : Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 88,
            child: Stack(
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 8,
                  ),
                  child: Column(
                    children: <Widget>[
                      Container(
                        width: 44,
                        height: 44,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.surfaceContainerHigh,
                          border: Border.all(
                            color: selected
                                ? AppColors.primaryContainer
                                : AppColors.outlineVariant,
                            width: selected ? 2 : 0.7,
                          ),
                        ),
                        child: imageUrl == null
                            ? _RailImageFallback(isNew: isNew)
                            : CachedNetworkImage(
                                imageUrl: imageUrl!,
                                fit: BoxFit.cover,
                                placeholder: (
                                  BuildContext context,
                                  String url,
                                ) => _RailImageFallback(isNew: isNew),
                                errorWidget: (
                                  BuildContext context,
                                  String url,
                                  Object error,
                                ) => _RailImageFallback(isNew: isNew),
                              ),
                      ),
                      const SizedBox(height: 4),
                      Expanded(
                        child: Text(
                          label,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: AppTypography.bodyMd.copyWith(
                            fontSize: 10,
                            height: 1.05,
                            color: selected
                                ? AppColors.primary
                                : AppColors.onSurfaceVariant,
                            fontWeight:
                                selected ? FontWeight.w700 : FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (selected)
                  const Positioned(
                    top: 0,
                    right: 0,
                    bottom: 0,
                    child: ColoredBox(
                      color: AppColors.primary,
                      child: SizedBox(width: 3),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RailImageFallback extends StatelessWidget {
  const _RailImageFallback({required this.isNew});

  final bool isNew;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: <Color>[
            AppColors.primaryContainer,
            AppColors.surfaceContainerHigh,
          ],
        ),
      ),
      child: Center(
        child: Icon(
          isNew ? Icons.auto_awesome : Icons.checkroom,
          size: 20,
          color: AppColors.primary,
        ),
      ),
    );
  }
}
