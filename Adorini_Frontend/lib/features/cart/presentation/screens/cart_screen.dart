import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/cart_api.dart';
import '../../domain/cart_controller.dart';

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<CartView> cart = ref.watch(cartControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Cart')),
      body: cart.when(
        skipLoadingOnRefresh: true,
        data: (CartView data) {
          if (data.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Text('Your cart is empty.'),
                  const SizedBox(height: AppSpacing.md),
                  ElevatedButton(
                    onPressed: () => context.go('/catalog'),
                    child: const Text('START SHOPPING'),
                  ),
                ],
              ),
            );
          }
          return Column(
            children: <Widget>[
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.containerMargin),
                  itemCount: data.items.length,
                  separatorBuilder: (BuildContext context, int index) =>
                      const SizedBox(height: AppSpacing.md),
                  itemBuilder: (BuildContext context, int index) =>
                      _CartLineTile(line: data.items[index]),
                ),
              ),
              _CartSummary(cart: data),
            ],
          );
        },
        error: (Object error, StackTrace stackTrace) =>
            Center(child: Text(friendlyErrorMessage(error))),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}

class _CartLineTile extends ConsumerWidget {
  const _CartLineTile({required this.line});

  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CartController controller = ref.read(cartControllerProvider.notifier);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(line.productName, style: AppTypography.bodyMd),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Size ${line.nominalSize} • ${line.colour}',
                    style: AppTypography.bodyMd
                        .copyWith(color: AppColors.onSurfaceVariant),
                  ),
                  if (!line.inStock)
                    Text(
                      'Out of stock',
                      style: AppTypography.labelBold
                          .copyWith(color: Theme.of(context).colorScheme.error),
                    )
                  else if (line.stockQuantity <= 3)
                    Text('Only ${line.stockQuantity} left',
                        style: AppTypography.labelBold),
                  const SizedBox(height: AppSpacing.xs),
                  Text(line.lineTotalPaise.asRupees,
                      style: AppTypography.priceDisplay),
                ],
              ),
            ),
            Column(
              children: <Widget>[
                IconButton(
                  icon: Icon(line.quantity > 1
                      ? Icons.remove_circle_outline
                      : Icons.delete_outline),
                  onPressed: () => line.quantity > 1
                      ? controller.updateQuantity(
                          lineId: line.id, quantity: line.quantity - 1)
                      : controller.removeItem(line.id),
                ),
                Text('${line.quantity}', style: AppTypography.bodyMd),
                IconButton(
                  icon: const Icon(Icons.add_circle_outline),
                  onPressed: line.quantity >= line.stockQuantity
                      ? null
                      : () => controller.updateQuantity(
                            lineId: line.id,
                            quantity: line.quantity + 1,
                          ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CartSummary extends ConsumerStatefulWidget {
  const _CartSummary({required this.cart});

  final CartView cart;

  @override
  ConsumerState<_CartSummary> createState() => _CartSummaryState();
}

class _CartSummaryState extends ConsumerState<_CartSummary> {
  late final TextEditingController _couponController =
      TextEditingController(text: ref.read(couponCodeProvider) ?? '');

  @override
  void dispose() {
    _couponController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final OrderTotals totals = widget.cart.totals;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.containerMargin),
      decoration: const BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (!totals.qualifiesForFreeDelivery)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                '${totals.freeDeliveryShortfallPaise.asRupees} away from free delivery',
                style: AppTypography.labelBold,
              ),
            ),
          Row(
            children: <Widget>[
              Expanded(
                child: TextField(
                  controller: _couponController,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(labelText: 'Coupon code'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              TextButton(
                onPressed: () => ref
                    .read(cartControllerProvider.notifier)
                    .applyCoupon(_couponController.text),
                child: Text(totals.couponApplied ? 'APPLIED' : 'APPLY'),
              ),
            ],
          ),
          // Set only when a code was supplied and rejected.
          if (widget.cart.couponMessage != null)
            Text(
              widget.cart.couponMessage!,
              style: AppTypography.bodyMd
                  .copyWith(color: Theme.of(context).colorScheme.error),
            ),
          const SizedBox(height: AppSpacing.sm),
          _SummaryRow(label: 'Subtotal', valuePaise: totals.subtotalPaise),
          if (totals.discountPaise > 0)
            _SummaryRow(
              label: totals.discountSource == 'FIRST_ORDER'
                  ? 'First order discount'
                  : 'Coupon',
              valuePaise: -totals.discountPaise,
            ),
          _SummaryRow(
            label: 'Delivery',
            valuePaise: totals.deliveryFeePaise,
            freeWhenZero: true,
          ),
          if (totals.walletCreditPaise > 0)
            _SummaryRow(
                label: 'Wallet credit', valuePaise: -totals.walletCreditPaise),
          const Divider(),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text('Total', style: AppTypography.titleMd),
              Text(totals.totalPaise.asRupees,
                  style: AppTypography.priceDisplay),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          ElevatedButton(
            onPressed: widget.cart.isPurchasable
                ? () => context.push('/checkout')
                : null,
            child: Text(
              widget.cart.isPurchasable
                  ? 'PROCEED TO CHECKOUT'
                  : 'REMOVE UNAVAILABLE ITEMS',
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.label,
    required this.valuePaise,
    this.freeWhenZero = false,
  });

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
