import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/domain_enums.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../../cart/data/cart_api.dart';
import '../../../cart/domain/cart_controller.dart';
import '../../../growth/domain/wallet_providers.dart';
import '../../../growth/data/wallet_api.dart';
import '../../data/checkout_api.dart';
import '../../domain/checkout_providers.dart';
import 'cod_verification_screen.dart';

class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  String? _addressId;
  PaymentMethod _paymentMethod = PaymentMethod.cod;
  bool _useWallet = false;
  bool _placing = false;
  String? _error;

  Future<void> _place() async {
    if (_addressId == null) return;
    setState(() {
      _placing = true;
      _error = null;
    });

    try {
      final PlacedOrder order = await ref.read(checkoutApiProvider).place(
            addressId: _addressId!,
            paymentMethod: _paymentMethod,
            walletCreditPaise: ref.read(walletCreditProvider),
            couponCode: ref.read(couponCodeProvider),
          );

      // The cart was emptied server-side in the same transaction.
      ref.invalidate(cartControllerProvider);
      ref.read(couponCodeProvider.notifier).state = null;
      ref.read(walletCreditProvider.notifier).state = 0;

      if (!mounted) return;

      if (order.requiresCodVerification) {
        // COD sits in PENDING_VERIFICATION until the intent code is confirmed.
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (BuildContext context) => CodVerificationScreen(order: order),
          ),
        );
        if (mounted) context.go('/profile/orders/${order.orderId}');
      } else if (order.paymentSessionId != null) {
        // Prepaid: the Cashfree SDK opens this session and the order confirms
        // when the payment webhook lands. SDK integration is not wired yet.
        setState(() => _error =
            'Online payment is not available in this build yet. Please choose Cash on delivery.');
      } else {
        context.go('/profile/orders/${order.orderId}');
      }
    } on DioException catch (e) {
      if (mounted) setState(() => _error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => _placing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Address>> addresses = ref.watch(addressListProvider);
    final AsyncValue<WalletBalance> wallet = ref.watch(walletBalanceProvider);
    final AsyncValue<CartView> cart = ref.watch(cartControllerProvider);

    // Default to the address already marked default.
    addresses.whenData((List<Address> items) {
      if (_addressId == null && items.isNotEmpty) {
        _addressId = items.firstWhere((Address a) => a.isDefault, orElse: () => items.first).id;
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.containerMargin),
        children: <Widget>[
          Text('Delivery address', style: AppTypography.labelBold),
          const SizedBox(height: AppSpacing.xs),
          addresses.when(
            data: (List<Address> items) {
              if (items.isEmpty) {
                return const Text('No saved addresses yet. Add one to continue.');
              }
              return RadioGroup<String>(
                groupValue: _addressId,
                onChanged: (String? value) => setState(() => _addressId = value),
                child: Column(
                  children: items
                      .map((Address address) => RadioListTile<String>(
                            value: address.id,
                            title: Text(address.recipientName),
                            subtitle: Text(address.formatted),
                          ))
                      .toList(),
                ),
              );
            },
            error: (Object e, StackTrace s) => Text('Failed to load addresses: $e'),
            loading: () => const Center(child: CircularProgressIndicator()),
          ),

          const SizedBox(height: AppSpacing.lg),
          Text('Payment', style: AppTypography.labelBold),
          const SizedBox(height: AppSpacing.xs),
          RadioGroup<PaymentMethod>(
            groupValue: _paymentMethod,
            onChanged: (PaymentMethod? value) =>
                setState(() => _paymentMethod = value ?? PaymentMethod.cod),
            child: Column(
              children: PaymentMethod.values
                  .map((PaymentMethod method) => RadioListTile<PaymentMethod>(
                        value: method,
                        title: Text(method.label),
                      ))
                  .toList(),
            ),
          ),

          const SizedBox(height: AppSpacing.md),
          wallet.when(
            data: (WalletBalance balance) => balance.balancePaise <= 0
                ? const SizedBox.shrink()
                : SwitchListTile(
                    value: _useWallet,
                    // The server clamps the request to the real balance and to
                    // what is still owed, so sending the full balance is safe.
                    onChanged: (bool value) {
                      setState(() => _useWallet = value);
                      ref.read(walletCreditProvider.notifier).state =
                          value ? balance.balancePaise : 0;
                    },
                    title: Text('Use wallet credit (${balance.balancePaise.asRupees})'),
                  ),
            error: (Object e, StackTrace s) => const SizedBox.shrink(),
            loading: () => const SizedBox.shrink(),
          ),

          const SizedBox(height: AppSpacing.lg),
          cart.when(
            data: (CartView data) => Column(
              children: <Widget>[
                const Divider(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Text('Amount payable', style: AppTypography.titleMd),
                    Text(data.totals.totalPaise.asRupees, style: AppTypography.priceDisplay),
                  ],
                ),
              ],
            ),
            error: (Object e, StackTrace s) => const SizedBox.shrink(),
            loading: () => const SizedBox.shrink(),
          ),

          if (_error != null) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],

          const SizedBox(height: AppSpacing.lg),
          ElevatedButton(
            onPressed: _addressId == null || _placing ? null : _place,
            child: Text(_placing ? 'PLACING ORDER…' : 'PLACE ORDER'),
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
      ),
    );
  }
}
