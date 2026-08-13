import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../auth/data/auth_api.dart';
import '../../../auth/domain/auth_controller.dart';
import '../../domain/pdp_providers.dart';

/// For sizes outside the stocked 40–48 band. Works signed-out, so a contact
/// phone is always collected — prefilled when we already know it.
class SizeEnquirySheet extends ConsumerStatefulWidget {
  const SizeEnquirySheet({required this.slug, super.key});

  final String slug;

  @override
  ConsumerState<SizeEnquirySheet> createState() => _SizeEnquirySheetState();
}

class _SizeEnquirySheetState extends ConsumerState<SizeEnquirySheet> {
  final TextEditingController _sizeController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();
  bool _submitting = false;
  String? _error;
  bool _submitted = false;

  @override
  void initState() {
    super.initState();
    final PublicUser? user = ref.read(authControllerProvider).user;
    if (user != null) _phoneController.text = user.phone;
  }

  @override
  void dispose() {
    _sizeController.dispose();
    _phoneController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String size = _sizeController.text.trim();
    final String phone = _phoneController.text.trim();
    if (size.isEmpty || phone.isEmpty) {
      setState(() => _error = 'Please enter the size you need and a contact number.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(pdpApiProvider).createSizeEnquiry(
            slug: widget.slug,
            requestedSize: size,
            contactPhone: phone,
            message: _messageController.text.trim(),
          );
      if (mounted) setState(() => _submitted = true);
    } on DioException catch (e) {
      if (mounted) setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.containerMargin,
        right: AppSpacing.containerMargin,
        top: AppSpacing.containerMargin,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.containerMargin,
      ),
      child: _submitted
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text('Thanks — we’ll be in touch', style: AppTypography.titleMd),
                const SizedBox(height: AppSpacing.sm),
                const Text('Our team will contact you about this size shortly.'),
                const SizedBox(height: AppSpacing.lg),
                ElevatedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('DONE'),
                ),
              ],
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Need a different size?', style: AppTypography.titleMd),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'We stock 40–48. Tell us what you need and we’ll see what we can do.',
                  style: AppTypography.bodyMd,
                ),
                const SizedBox(height: AppSpacing.md),
                TextField(
                  controller: _sizeController,
                  decoration: const InputDecoration(
                    labelText: 'Size you need',
                    hintText: 'e.g. 50, or 46 with longer sleeves',
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Contact number'),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: _messageController,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Anything else? (optional)'),
                ),
                if (_error != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.sm),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: AppSpacing.lg),
                ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: Text(_submitting ? 'SENDING…' : 'SEND ENQUIRY'),
                ),
              ],
            ),
    );
  }
}
