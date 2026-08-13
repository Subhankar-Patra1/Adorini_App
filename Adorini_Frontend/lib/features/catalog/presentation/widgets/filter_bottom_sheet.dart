import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../data/catalog_api.dart';
import '../../data/product_model.dart';
import '../../domain/catalog_providers.dart';

/// Adorini stocks nominal sizes 40–48 — anything outside that band goes through
/// the PDP's size-enquiry form instead.
const List<int> _nominalSizes = <int>[40, 42, 44, 46, 48];

class FilterBottomSheet extends ConsumerStatefulWidget {
  const FilterBottomSheet({super.key});

  @override
  ConsumerState<FilterBottomSheet> createState() => _FilterBottomSheetState();
}

class _FilterBottomSheetState extends ConsumerState<FilterBottomSheet> {
  late String? _category;
  late String? _brand;
  late int? _size;
  late FabricType? _fabricType;
  late CatalogSort _sort;

  @override
  void initState() {
    super.initState();
    final CatalogFilters current = ref.read(catalogFiltersProvider);
    _category = current.category;
    _brand = current.brand;
    _size = current.size;
    _fabricType = current.fabricType;
    _sort = current.sort;
  }

  void _apply() {
    ref.read(catalogFiltersProvider.notifier).state = CatalogFilters(
      category: _category,
      brand: _brand,
      size: _size,
      fabricType: _fabricType,
      sort: _sort,
    );
    Navigator.of(context).pop();
  }

  void _clear() {
    ref.read(catalogFiltersProvider.notifier).state = const CatalogFilters();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Category>> categories = ref.watch(categoriesProvider);
    final AsyncValue<List<Brand>> brands = ref.watch(brandsProvider);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      builder: (BuildContext context, ScrollController scrollController) {
        return ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(AppSpacing.containerMargin),
          children: <Widget>[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Text('Filters', style: AppTypography.titleMd),
                TextButton(onPressed: _clear, child: const Text('CLEAR ALL')),
              ],
            ),
            const SizedBox(height: AppSpacing.md),

            Text('Category', style: AppTypography.labelBold),
            const SizedBox(height: AppSpacing.xs),
            categories.when(
              data: (List<Category> items) => Wrap(
                spacing: AppSpacing.xs,
                children: items.map((Category c) {
                  return ChoiceChip(
                    label: Text(c.name),
                    selected: _category == c.slug,
                    onSelected: (bool selected) =>
                        setState(() => _category = selected ? c.slug : null),
                  );
                }).toList(),
              ),
              error: (Object e, StackTrace s) => const Text('Could not load categories'),
              loading: () => const LinearProgressIndicator(),
            ),
            const SizedBox(height: AppSpacing.md),

            Text('Brand', style: AppTypography.labelBold),
            const SizedBox(height: AppSpacing.xs),
            brands.when(
              data: (List<Brand> items) => Wrap(
                spacing: AppSpacing.xs,
                children: items.map((Brand b) {
                  return ChoiceChip(
                    label: Text(b.name),
                    selected: _brand == b.slug,
                    onSelected: (bool selected) => setState(() => _brand = selected ? b.slug : null),
                  );
                }).toList(),
              ),
              error: (Object e, StackTrace s) => const Text('Could not load brands'),
              loading: () => const LinearProgressIndicator(),
            ),
            const SizedBox(height: AppSpacing.md),

            Text('Size', style: AppTypography.labelBold),
            const SizedBox(height: AppSpacing.xs),
            Wrap(
              spacing: AppSpacing.xs,
              children: _nominalSizes.map((int size) {
                return ChoiceChip(
                  label: Text('$size'),
                  selected: _size == size,
                  onSelected: (bool selected) => setState(() => _size = selected ? size : null),
                );
              }).toList(),
            ),
            const SizedBox(height: AppSpacing.md),

            Text('Fabric', style: AppTypography.labelBold),
            const SizedBox(height: AppSpacing.xs),
            Wrap(
              spacing: AppSpacing.xs,
              children: FabricType.values.map((FabricType f) {
                return ChoiceChip(
                  label: Text(f == FabricType.stretch ? 'Stretch' : 'Rigid'),
                  selected: _fabricType == f,
                  onSelected: (bool selected) =>
                      setState(() => _fabricType = selected ? f : null),
                );
              }).toList(),
            ),
            const SizedBox(height: AppSpacing.md),

            Text('Sort by', style: AppTypography.labelBold),
            const SizedBox(height: AppSpacing.xs),
            Wrap(
              spacing: AppSpacing.xs,
              children: CatalogSort.values.map((CatalogSort s) {
                return ChoiceChip(
                  label: Text(s.label),
                  selected: _sort == s,
                  onSelected: (bool selected) {
                    if (selected) setState(() => _sort = s);
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: AppSpacing.xl),

            ElevatedButton(onPressed: _apply, child: const Text('APPLY FILTERS')),
          ],
        );
      },
    );
  }
}
