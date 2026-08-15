import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/orders_api.dart';
import '../../domain/orders_providers.dart';

/// Order detail *and* tracking — the backend returns both in one payload, so
/// the timeline is derived here rather than fetched separately.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({required this.orderId, super.key});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<OrderDetail> order =
        ref.watch(orderDetailProvider(orderId));

    return Scaffold(
      appBar: AppBar(title: const Text('Order')),
      body: order.when(
        data: (OrderDetail detail) => _Body(detail: detail),
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text(friendlyErrorMessage(error))),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.detail});

  final OrderDetail detail;

  Future<void> _requestRedelivery(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(ordersApiProvider).requestRedelivery(detail.id);
      ref.invalidate(orderDetailProvider(detail.id));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('We’ve asked the courier to try again.')),
        );
      }
    } on DioException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: const Text(
          'Any store credit spent is refunded and the items go back on sale.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('KEEP ORDER'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('CANCEL ORDER'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await ref.read(ordersApiProvider).cancel(orderId: detail.id);
      ref.invalidate(orderDetailProvider(detail.id));
      ref.invalidate(orderHistoryProvider);
    } on DioException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.containerMargin),
      children: <Widget>[
        Text(detail.orderNumber, style: AppTypography.headlineLgMobile),
        Text(
          'Placed ${DateFormat.yMMMd().format(detail.createdAt)}',
          style:
              AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
        ),
        if (detail.delhiveryWaybill != null) ...<Widget>[
          const SizedBox(height: AppSpacing.xs),
          Text('Waybill ${detail.delhiveryWaybill}',
              style: AppTypography.bodyMd),
        ],

        // "Still want this?" — only while the window is open and the courier
        // has attempts left.
        if (detail.canRequestReattempt) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          Card(
            color: AppColors.tertiaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Delivery didn’t go through',
                      style: AppTypography.titleMd),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    detail.respondBy == null
                        ? 'Still want it? We can ask the courier to try again.'
                        : 'Still want it? Let us know by '
                            '${DateFormat.yMMMd().add_jm().format(detail.respondBy!)}.',
                    style: AppTypography.bodyMd,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  ElevatedButton(
                    onPressed: () => _requestRedelivery(context, ref),
                    child: const Text('TRY DELIVERY AGAIN'),
                  ),
                ],
              ),
            ),
          ),
        ],

        const SizedBox(height: AppSpacing.lg),
        Text('Tracking', style: AppTypography.labelBold),
        const SizedBox(height: AppSpacing.xs),
        ...detail.timeline.map(
          (({DateTime? at, bool done, String label}) step) => ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              step.done ? Icons.check_circle : Icons.radio_button_unchecked,
              color: step.done
                  ? Theme.of(context).colorScheme.primary
                  : AppColors.outline,
            ),
            title: Text(step.label),
            subtitle: step.at == null
                ? null
                : Text(DateFormat.yMMMd().add_jm().format(step.at!)),
          ),
        ),

        if (detail.cancellationReason != null) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          Text('Reason: ${detail.cancellationReason}',
              style: AppTypography.bodyMd),
        ],

        const SizedBox(height: AppSpacing.lg),
        Text('Items', style: AppTypography.labelBold),
        const SizedBox(height: AppSpacing.xs),
        ...detail.items.map(
          (OrderLine line) => ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(line.productName, style: AppTypography.bodyMd),
            subtitle: Text(
                'Size ${line.nominalSize} • ${line.colour} • Qty ${line.quantity}'),
            trailing:
                Text(line.lineTotalPaise.asRupees, style: AppTypography.bodyMd),
          ),
        ),

        const Divider(),
        _Row(label: 'Subtotal', valuePaise: detail.subtotalPaise),
        if (detail.discountPaise > 0)
          _Row(label: 'Discount', valuePaise: -detail.discountPaise),
        _Row(
            label: 'Delivery',
            valuePaise: detail.deliveryFeePaise,
            freeWhenZero: true),
        if (detail.walletCreditPaise > 0)
          _Row(label: 'Wallet credit', valuePaise: -detail.walletCreditPaise),
        const Divider(),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Text('Total', style: AppTypography.titleMd),
            Text(detail.totalPaise.asRupees, style: AppTypography.priceDisplay),
          ],
        ),

        const SizedBox(height: AppSpacing.lg),
        Text('Delivery address', style: AppTypography.labelBold),
        const SizedBox(height: AppSpacing.xs),
        Text(detail.shippingAddress.recipientName, style: AppTypography.bodyMd),
        Text(detail.shippingAddress.formatted, style: AppTypography.bodyMd),

        const SizedBox(height: AppSpacing.xl),
        // Returns open only once the parcel has actually been delivered.
        if (detail.status == OrderStatus.delivered)
          OutlinedButton(
            onPressed: () =>
                context.push('/profile/orders/${detail.id}/return'),
            child: const Text('RETURN AN ITEM'),
          ),
        if (detail.canCancel) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          TextButton(
            onPressed: () => _cancel(context, ref),
            child: const Text('CANCEL ORDER'),
          ),
        ],
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(
      {required this.label,
      required this.valuePaise,
      this.freeWhenZero = false});

  final String label;
  final int valuePaise;
  final bool freeWhenZero;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs / 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Text(label, style: AppTypography.bodyMd),
          Text(
            freeWhenZero && valuePaise == 0
                ? 'FREE'
                : (valuePaise < 0
                    ? '- ${(-valuePaise).asRupees}'
                    : valuePaise.asRupees),
            style: AppTypography.bodyMd,
          ),
        ],
      ),
    );
  }
}
