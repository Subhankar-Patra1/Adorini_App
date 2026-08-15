import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../../core/network/api_error.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';
import '../../../../../core/theme/app_typography.dart';
import '../../../data/returns_api.dart';
import '../../../domain/orders_providers.dart';

class ReturnsListScreen extends ConsumerWidget {
  const ReturnsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ReturnRequest>> returns =
        ref.watch(myReturnsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Returns')),
      body: returns.when(
        data: (List<ReturnRequest> items) {
          if (items.isEmpty) {
            return const Center(
                child: Text('You haven’t requested any returns.'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.containerMargin),
            itemCount: items.length,
            separatorBuilder: (BuildContext c, int i) =>
                const SizedBox(height: AppSpacing.sm),
            itemBuilder: (BuildContext context, int index) {
              final ReturnRequest request = items[index];
              return Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.all(AppSpacing.sm),
                  title: Text(request.productName, style: AppTypography.bodyMd),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        '${request.orderNumber} • Size ${request.nominalSize} • '
                        'Qty ${request.quantity}',
                        style: AppTypography.bodyMd
                            .copyWith(color: AppColors.onSurfaceVariant),
                      ),
                      Text(
                        DateFormat.yMMMd().format(request.createdAt),
                        style: AppTypography.bodyMd
                            .copyWith(color: AppColors.onSurfaceVariant),
                      ),
                      if (request.adminNote != null)
                        Text(request.adminNote!, style: AppTypography.bodyMd),
                    ],
                  ),
                  trailing: Chip(
                    label: Text(request.status.label),
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              );
            },
          );
        },
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text(friendlyErrorMessage(error))),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}
