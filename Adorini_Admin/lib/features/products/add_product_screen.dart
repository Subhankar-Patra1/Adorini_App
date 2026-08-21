import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_client.dart';
import 'admin_catalog_api.dart';

const List<String> _fabricTypes = <String>['STRETCH', 'RIGID'];
const List<String> _printTechniques = <String>['KALANKARI', 'AJRAK', 'BATIK', 'APLIK', 'FANCY'];

class _VariantRow {
  String sku = '';
  int nominalSize = 42;
  String colour = '';
  int stockQuantity = 0;
}

class AddProductScreen extends ConsumerStatefulWidget {
  const AddProductScreen({super.key});

  @override
  ConsumerState<AddProductScreen> createState() => _AddProductScreenState();
}

class _AddProductScreenState extends ConsumerState<AddProductScreen> {
  final _formKey = GlobalKey<FormState>();

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _slugController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _priceController = TextEditingController();
  final TextEditingController _compareAtPriceController = TextEditingController();

  bool _slugEdited = false;

  List<AdminCategory> _categories = <AdminCategory>[];
  List<AdminBrand> _brands = <AdminBrand>[];
  bool _loadingOptions = true;
  String? _loadOptionsError;

  String? _categoryId;
  String? _brandId;
  String _fabricType = _fabricTypes.first;
  String? _printTechnique;

  final List<_VariantRow> _variants = <_VariantRow>[_VariantRow()];
  final List<PickedImage> _images = <PickedImage>[];

  bool _submitting = false;
  String? _submitError;
  String? _successMessage;

  @override
  void initState() {
    super.initState();
    _loadOptions();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _slugController.dispose();
    _descriptionController.dispose();
    _priceController.dispose();
    _compareAtPriceController.dispose();
    super.dispose();
  }

  AdminCatalogApi get _api => AdminCatalogApi(ref.read(dioProvider));

  Future<void> _loadOptions() async {
    setState(() {
      _loadingOptions = true;
      _loadOptionsError = null;
    });

    try {
      final List<AdminCategory> categories = await _api.listCategories();
      final List<AdminBrand> brands = await _api.listBrands();
      setState(() {
        _categories = categories;
        _brands = brands;
        _categoryId ??= categories.where((AdminCategory c) => c.isActive).firstOrNull?.id;
        _brandId ??= brands.where((AdminBrand b) => b.isActive).firstOrNull?.id;
      });
    } on DioException catch (e) {
      setState(() => _loadOptionsError = e.message ?? 'Could not load categories/brands.');
    } finally {
      if (mounted) setState(() => _loadingOptions = false);
    }
  }

  void _deriveSlug(String name) {
    if (_slugEdited) return;
    final String slug = name
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r"[^a-z0-9]+"), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    _slugController.text = slug;
  }

  Future<void> _pickImages() async {
    // file_picker 12's `pickFiles` returns the file list directly (no more
    // FilePickerResult wrapper); PlatformFile only guarantees `name` and
    // `readAsBytes()` now — the old `.bytes`/`.extension` fields are gone.
    // allowMultiple defaults to true in file_picker 12.
    final List<PlatformFile> result = await FilePicker.pickFiles(type: FileType.image);
    if (result.isEmpty) return;

    final List<PickedImage> picked = <PickedImage>[];
    for (final PlatformFile file in result) {
      final Uint8List bytes = await file.readAsBytes();
      picked.add(
        PickedImage(
          bytes: bytes,
          filename: file.name,
          mimeType: _mimeTypeFor(_extensionOf(file.name)),
        ),
      );
    }

    setState(() {
      _images.addAll(picked);
      // Cap matches the backend's per-call limit and the PRD's gallery cap.
      if (_images.length > 5) _images.removeRange(5, _images.length);
    });
  }

  String? _extensionOf(String filename) {
    final int dot = filename.lastIndexOf('.');
    return dot == -1 ? null : filename.substring(dot + 1);
  }

  String _mimeTypeFor(String? extension) {
    switch (extension?.toLowerCase()) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'jpg':
      case 'jpeg':
      default:
        return 'image/jpeg';
    }
  }

  void _addVariantRow() => setState(() => _variants.add(_VariantRow()));

  void _removeVariantRow(int index) => setState(() => _variants.removeAt(index));

  Future<void> _submit() async {
    setState(() {
      _submitError = null;
      _successMessage = null;
    });

    if (!(_formKey.currentState?.validate() ?? false)) return;

    if (_categoryId == null || _brandId == null) {
      setState(() => _submitError = 'Pick a category and a brand.');
      return;
    }
    if (_variants.any((_VariantRow v) => v.sku.trim().isEmpty || v.colour.trim().isEmpty)) {
      setState(() => _submitError = 'Every variant needs a SKU and a colour.');
      return;
    }

    setState(() => _submitting = true);

    try {
      final int pricePaise = (double.parse(_priceController.text.trim()) * 100).round();
      final int? compareAtPricePaise = _compareAtPriceController.text.trim().isEmpty
          ? null
          : (double.parse(_compareAtPriceController.text.trim()) * 100).round();

      final AdminProduct product = await _api.createProduct(
        slug: _slugController.text.trim(),
        name: _nameController.text.trim(),
        description: _descriptionController.text.trim(),
        categoryId: _categoryId!,
        brandId: _brandId!,
        pricePaise: pricePaise,
        compareAtPricePaise: compareAtPricePaise,
        fabricType: _fabricType,
        printTechnique: _printTechnique,
      );

      for (final _VariantRow variant in _variants) {
        await _api.createVariant(
          product.id,
          VariantInput(
            sku: variant.sku.trim(),
            nominalSize: variant.nominalSize,
            colour: variant.colour.trim(),
            stockQuantity: variant.stockQuantity,
          ),
        );
      }

      await _api.uploadProductMedia(product.id, _images);

      setState(() {
        _successMessage = '"${product.name}" is live in the catalog.';
      });
      _resetForm();
    } on DioException catch (e) {
      setState(() => _submitError = _messageFrom(e));
    } catch (e) {
      setState(() => _submitError = 'Check the price fields — they must be plain numbers.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _messageFrom(DioException e) {
    final dynamic data = e.response?.data;
    if (data is Map<String, dynamic> && data['message'] is String) {
      return data['message'] as String;
    }
    return e.message ?? 'Something went wrong.';
  }

  void _resetForm() {
    _nameController.clear();
    _slugController.clear();
    _descriptionController.clear();
    _priceController.clear();
    _compareAtPriceController.clear();
    _slugEdited = false;
    _variants
      ..clear()
      ..add(_VariantRow());
    _images.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add product')),
      body: _loadingOptions
          ? const Center(child: CircularProgressIndicator())
          : _loadOptionsError != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(_loadOptionsError!),
                      const SizedBox(height: 12),
                      ElevatedButton(onPressed: _loadOptions, child: const Text('Retry')),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        if (_successMessage != null)
                          Container(
                            padding: const EdgeInsets.all(12),
                            margin: const EdgeInsets.only(bottom: 16),
                            decoration: BoxDecoration(
                              color: Colors.green.shade50,
                              border: Border.all(color: Colors.green),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(_successMessage!),
                          ),
                        TextFormField(
                          controller: _nameController,
                          decoration: const InputDecoration(labelText: 'Product name'),
                          onChanged: _deriveSlug,
                          validator: (String? v) =>
                              (v == null || v.trim().isEmpty) ? 'Required' : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _slugController,
                          decoration: const InputDecoration(labelText: 'Slug'),
                          onChanged: (_) => _slugEdited = true,
                          validator: (String? v) =>
                              (v == null || v.trim().isEmpty) ? 'Required' : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _descriptionController,
                          decoration: const InputDecoration(labelText: 'Description (optional)'),
                          maxLines: 3,
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: _categoryId,
                          decoration: const InputDecoration(labelText: 'Section (category)'),
                          items: _categories
                              .map(
                                (AdminCategory c) => DropdownMenuItem<String>(
                                  value: c.id,
                                  child: Text(c.isActive ? c.name : '${c.name} (inactive)'),
                                ),
                              )
                              .toList(),
                          onChanged: (String? v) => setState(() => _categoryId = v),
                          validator: (String? v) => v == null ? 'Required' : null,
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: _brandId,
                          decoration: const InputDecoration(labelText: 'Brand'),
                          items: _brands
                              .map(
                                (AdminBrand b) => DropdownMenuItem<String>(
                                  value: b.id,
                                  child: Text(b.isActive ? b.name : '${b.name} (inactive)'),
                                ),
                              )
                              .toList(),
                          onChanged: (String? v) => setState(() => _brandId = v),
                          validator: (String? v) => v == null ? 'Required' : null,
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: <Widget>[
                            Expanded(
                              child: TextFormField(
                                controller: _priceController,
                                decoration: const InputDecoration(labelText: 'Price (₹)'),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                validator: (String? v) =>
                                    (v == null || double.tryParse(v.trim()) == null)
                                        ? 'Enter a number'
                                        : null,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextFormField(
                                controller: _compareAtPriceController,
                                decoration: const InputDecoration(
                                  labelText: 'Compare-at (optional)',
                                ),
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: _fabricType,
                          decoration: const InputDecoration(labelText: 'Fabric type'),
                          items: _fabricTypes
                              .map((String f) => DropdownMenuItem<String>(value: f, child: Text(f)))
                              .toList(),
                          onChanged: (String? v) => setState(() => _fabricType = v!),
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: _printTechnique,
                          decoration: const InputDecoration(labelText: 'Print technique (optional)'),
                          items: _printTechniques
                              .map((String p) => DropdownMenuItem<String>(value: p, child: Text(p)))
                              .toList(),
                          onChanged: (String? v) => setState(() => _printTechnique = v),
                        ),
                        const SizedBox(height: 24),
                        Text('Variants', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        ..._variants.asMap().entries.map(
                              (MapEntry<int, _VariantRow> entry) =>
                                  _variantCard(entry.key, entry.value),
                            ),
                        TextButton.icon(
                          onPressed: _addVariantRow,
                          icon: const Icon(Icons.add),
                          label: const Text('Add another size/colour'),
                        ),
                        const SizedBox(height: 24),
                        Text('Images', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: <Widget>[
                            for (int i = 0; i < _images.length; i++)
                              Stack(
                                children: <Widget>[
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(6),
                                    child: Image.memory(
                                      _images[i].bytes,
                                      width: 88,
                                      height: 88,
                                      fit: BoxFit.cover,
                                    ),
                                  ),
                                  if (i == 0)
                                    Positioned(
                                      left: 2,
                                      top: 2,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 4,
                                          vertical: 1,
                                        ),
                                        color: Colors.black54,
                                        child: const Text(
                                          'cover',
                                          style: TextStyle(color: Colors.white, fontSize: 10),
                                        ),
                                      ),
                                    ),
                                  Positioned(
                                    right: 0,
                                    top: 0,
                                    child: GestureDetector(
                                      onTap: () => setState(() => _images.removeAt(i)),
                                      child: const CircleAvatar(
                                        radius: 10,
                                        backgroundColor: Colors.black54,
                                        child: Icon(Icons.close, size: 14, color: Colors.white),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            OutlinedButton.icon(
                              onPressed: _images.length >= 5 ? null : _pickImages,
                              icon: const Icon(Icons.add_photo_alternate_outlined),
                              label: const Text('Add images'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        if (_submitError != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Text(
                              _submitError!,
                              style: TextStyle(color: Theme.of(context).colorScheme.error),
                            ),
                          ),
                        ElevatedButton(
                          onPressed: _submitting ? null : _submit,
                          child: _submitting
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Text('Create product'),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
    );
  }

  Widget _variantCard(int index, _VariantRow variant) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: TextFormField(
                    key: ValueKey('sku-$index'),
                    initialValue: variant.sku,
                    decoration: const InputDecoration(labelText: 'SKU'),
                    onChanged: (String v) => variant.sku = v,
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 90,
                  child: DropdownButtonFormField<int>(
                    initialValue: variant.nominalSize,
                    decoration: const InputDecoration(labelText: 'Size'),
                    items: <int>[40, 42, 44, 46, 48]
                        .map((int s) => DropdownMenuItem<int>(value: s, child: Text('$s')))
                        .toList(),
                    onChanged: (int? v) => variant.nominalSize = v ?? variant.nominalSize,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: TextFormField(
                    key: ValueKey('colour-$index'),
                    initialValue: variant.colour,
                    decoration: const InputDecoration(labelText: 'Colour'),
                    onChanged: (String v) => variant.colour = v,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    key: ValueKey('stock-$index'),
                    initialValue: variant.stockQuantity.toString(),
                    decoration: const InputDecoration(labelText: 'Stock'),
                    keyboardType: TextInputType.number,
                    onChanged: (String v) => variant.stockQuantity = int.tryParse(v) ?? 0,
                  ),
                ),
                if (_variants.length > 1)
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline),
                    onPressed: () => _removeVariantRow(index),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
