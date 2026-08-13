import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/checkout_api.dart';
import '../../domain/checkout_providers.dart';

/// A COD order stays in PENDING_VERIFICATION until the buyer confirms the
/// intent code sent by SMS — this is what moves it to CONFIRMED.
class CodVerificationScreen extends ConsumerStatefulWidget {
  const CodVerificationScreen({required this.order, super.key});

  final PlacedOrder order;

  @override
  ConsumerState<CodVerificationScreen> createState() => _CodVerificationScreenState();
}

class _CodVerificationScreenState extends ConsumerState<CodVerificationScreen> {
  final TextEditingController _otpController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final String otp = _otpController.text.trim();
    if (otp.length != 6) {
      setState(() => _error = 'Enter the 6-digit code we sent you.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final OrderStatus status = await ref
          .read(checkoutApiProvider)
          .verifyCod(orderId: widget.order.orderId, otp: otp);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Order ${status.label.toLowerCase()}')));
      Navigator.of(context).pop();
    } on DioException catch (e) {
      if (mounted) setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    setState(() => _busy = true);
    try {
      await ref.read(checkoutApiProvider).resendCod(widget.order.orderId);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('A new code is on its way')));
      }
    } on DioException catch (e) {
      if (mounted) setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Confirm your order')),
      body: Padding(
        padding: const EdgeInsets.all(AppSpacing.containerMargin),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text('Order ${widget.order.orderNumber}', style: AppTypography.titleMd),
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${widget.order.totalPaise.asRupees} payable on delivery. '
              'Enter the code we sent by SMS to confirm this order.',
              style: AppTypography.bodyMd,
            ),
            const SizedBox(height: AppSpacing.lg),
            TextField(
              controller: _otpController,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(labelText: 'Confirmation code'),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: AppSpacing.xs),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: AppSpacing.md),
            ElevatedButton(
              onPressed: _busy ? null : _verify,
              child: Text(_busy ? 'CONFIRMING…' : 'CONFIRM ORDER'),
            ),
            TextButton(
              onPressed: _busy ? null : _resend,
              child: const Text('RESEND CODE'),
            ),
          ],
        ),
      ),
    );
  }
}
