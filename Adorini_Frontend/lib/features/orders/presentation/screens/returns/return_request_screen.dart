import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/constants/domain_enums.dart';
import '../../../../../core/network/api_error.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';
import '../../../../../core/theme/app_typography.dart';
import '../../../data/returns_api.dart';
import '../../../domain/orders_providers.dart';

/// Returns are per **order item**, within 3 days of delivery.
///
/// Steps: pick the item → pick a reason → confirm. There is no photo upload on
/// this endpoint — the backend's return contract takes reason/comment/fitTag
/// only, and a sizing reason derives its own fit tag server-side.
class ReturnRequestScreen extends ConsumerStatefulWidget {
  const ReturnRequestScreen({required this.orderId, super.key});

  final String orderId;

  @override
  ConsumerState<ReturnRequestScreen> createState() => _ReturnRequestScreenState();
}

class _ReturnRequestScreenState extends ConsumerState<ReturnRequestScreen> {
  int _step = 0;
  EligibleItem? _item;
  ReturnReason? _reason;
  int _quantity = 1;
  final TextEditingController _commentController = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_item == null || _reason == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(returnsApiProvider).requestReturn(
            orderId: widget.orderId,
            orderItemId: _item!.orderItemId,
            quantity: _quantity,
            reason: _reason!,
            comment: _commentController.text.trim(),
          );
      ref.invalidate(myReturnsProvider);
      ref.invalidate(eligibleReturnItemsProvider(widget.orderId));
      if (mounted) setState(() => _step = 3);
    } on DioException catch (e) {
      if (mounted) setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<EligibleItem>> eligible =
        ref.watch(eligibleReturnItemsProvider(widget.orderId));

    return Scaffold(
      appBar: AppBar(title: const Text('Return an item')),
      body: _step == 3 ? _buildDone() : eligible.when(
        data: (List<EligibleItem> items) => _buildStepper(items),
        error: (Object error, StackTrace stackTrace) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.containerMargin),
            // Typically a 409: the order has not been delivered yet.
            child: Text(
              error is DioException
                  ? apiErrorMessage(error)
                  : 'Returns are not available for this order.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }

  Widget _buildDone() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.containerMargin),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.check_circle_outline, size: 48),
            const SizedBox(height: AppSpacing.md),
            Text('Return requested', style: AppTypography.titleMd),
            const SizedBox(height: AppSpacing.xs),
            const Text(
              'We’ll review your request and get back to you shortly.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.lg),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('DONE'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStepper(List<EligibleItem> items) {
    return Stepper(
      currentStep: _step,
      onStepContinue: () {
        if (_step == 0 && _item == null) return;
        if (_step == 1 && _reason == null) return;
        if (_step == 2) {
          _submit();
        } else {
          setState(() => _step += 1);
        }
      },
      onStepCancel: _step > 0 ? () => setState(() => _step -= 1) : null,
      controlsBuilder: (BuildContext context, ControlsDetails details) {
        return Padding(
          padding: const EdgeInsets.only(top: AppSpacing.md),
          child: Row(
            children: <Widget>[
              ElevatedButton(
                onPressed: _submitting ? null : details.onStepContinue,
                child: Text(
                  _step == 2 ? (_submitting ? 'SUBMITTING…' : 'SUBMIT REQUEST') : 'CONTINUE',
                ),
              ),
              if (details.onStepCancel != null) ...<Widget>[
                const SizedBox(width: AppSpacing.sm),
                TextButton(onPressed: details.onStepCancel, child: const Text('BACK')),
              ],
            ],
          ),
        );
      },
      steps: <Step>[
        Step(
          title: const Text('Which item?'),
          isActive: _step >= 0,
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: items.map((EligibleItem item) {
              // Ineligible lines are shown *with the reason* rather than hidden,
              // so the shopper understands why the option is unavailable.
              return RadioListTile<String>(
                value: item.orderItemId,
                groupValue: _item?.orderItemId,
                onChanged: item.isEligible
                    ? (String? _) => setState(() {
                          _item = item;
                          _quantity = 1;
                        })
                    : null,
                title: Text(item.productName),
                subtitle: Text(
                  item.isEligible
                      ? 'Size ${item.nominalSize} • ${item.colour} • Qty ${item.quantity}'
                      : (item.reasonIneligible ?? 'Not eligible for return'),
                  style: item.isEligible
                      ? null
                      : AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
                ),
              );
            }).toList(),
          ),
        ),
        Step(
          title: const Text('Why?'),
          isActive: _step >= 1,
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: ReturnReason.values
                .map((ReturnReason reason) => RadioListTile<ReturnReason>(
                      value: reason,
                      groupValue: _reason,
                      onChanged: (ReturnReason? value) => setState(() => _reason = value),
                      title: Text(reason.label),
                    ))
                .toList(),
          ),
        ),
        Step(
          title: const Text('Confirm'),
          isActive: _step >= 2,
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (_item != null && _item!.quantity > 1) ...<Widget>[
                Text('How many?', style: AppTypography.labelBold),
                Row(
                  children: <Widget>[
                    IconButton(
                      icon: const Icon(Icons.remove_circle_outline),
                      onPressed: _quantity > 1 ? () => setState(() => _quantity -= 1) : null,
                    ),
                    Text('$_quantity'),
                    IconButton(
                      icon: const Icon(Icons.add_circle_outline),
                      onPressed: _quantity < _item!.quantity
                          ? () => setState(() => _quantity += 1)
                          : null,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
              ],
              TextField(
                controller: _commentController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Anything else? (optional)',
                ),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: AppSpacing.sm),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
