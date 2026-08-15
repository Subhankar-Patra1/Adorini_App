import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/orders_api.dart';
import '../../domain/orders_providers.dart';

class OrderHistoryScreen extends ConsumerWidget {
  const OrderHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<OrderSummary>> orders =
        ref.watch(orderHistoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('My Orders')),
      body: orders.when(
        data: (List<OrderSummary> items) {
          if (items.isEmpty) {
            return const Center(child: Text('No orders yet.'));
          }
          return RefreshIndicator(
            onRefresh: () => ref.refresh(orderHistoryProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.containerMargin),
              itemCount: items.length,
              separatorBuilder: (BuildContext c, int i) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) {
                final OrderSummary order = items[index];
                return Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.all(AppSpacing.sm),
                    title: Text(order.orderNumber, style: AppTypography.bodyMd),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.xs),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            '${order.itemCount} item${order.itemCount == 1 ? '' : 's'} • '
                            '${DateFormat.yMMMd().format(order.createdAt)}',
                            style: AppTypography.bodyMd
                                .copyWith(color: AppColors.onSurfaceVariant),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Chip(
                            label: Text(order.status.label),
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                          ),
                        ],
                      ),
                    ),
                    trailing: Text(
                      order.totalPaise.asRupees,
                      style: AppTypography.priceDisplay,
                    ),
                    onTap: () => context.push('/profile/orders/${order.id}'),
                  ),
                );
              },
            ),
          );
        },
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text(friendlyErrorMessage(error))),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}
