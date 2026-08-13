import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/cart_api.dart';

final Provider<CartApi> cartApiProvider = Provider<CartApi>((Ref ref) => CartApi(ref.watch(dioProvider)));

/// The coupon code currently being previewed against the cart, and how much
/// wallet credit to apply. Both are *requests* — the server clamps the credit
/// to the real balance and re-checks the coupon at placement.
final StateProvider<String?> couponCodeProvider = StateProvider<String?>((Ref ref) => null);
final StateProvider<int> walletCreditProvider = StateProvider<int>((Ref ref) => 0);

final AsyncNotifierProvider<CartController, CartView> cartControllerProvider =
    AsyncNotifierProvider<CartController, CartView>(CartController.new);

class CartController extends AsyncNotifier<CartView> {
  CartApi get _api => ref.read(cartApiProvider);

  @override
  Future<CartView> build() {
    // Re-reads whenever the coupon or wallet preview changes, so the totals on
    // screen always match what the server would charge.
    final String? coupon = ref.watch(couponCodeProvider);
    final int walletCredit = ref.watch(walletCreditProvider);
    return _api.getCart(walletCreditPaise: walletCredit, couponCode: coupon);
  }

  /// Keeps the previous cart visible while the mutation is in flight, so the
  /// screen does not flash an empty state on every quantity tap.
  Future<void> _mutate(Future<CartView> Function() action) async {
    state = const AsyncLoading<CartView>().copyWithPrevious(state);
    state = await AsyncValue.guard(action);
  }

  Future<void> addItem({required String variantId, int quantity = 1}) =>
      _mutate(() => _api.addItem(variantId: variantId, quantity: quantity));

  Future<void> updateQuantity({required String lineId, required int quantity}) =>
      _mutate(() => _api.updateItem(lineId: lineId, quantity: quantity));

  Future<void> changeVariant({required String lineId, required String variantId}) =>
      _mutate(() => _api.updateItem(lineId: lineId, variantId: variantId));

  Future<void> removeItem(String lineId) => _mutate(() => _api.removeItem(lineId));

  Future<void> clear() => _mutate(() => _api.clear());

  /// Applying a coupon is a re-read with a query parameter, not a mutation.
  /// Rejection surfaces as `couponMessage` on the returned cart.
  void applyCoupon(String? code) {
    ref.read(couponCodeProvider.notifier).state =
        (code == null || code.trim().isEmpty) ? null : code.trim();
  }
}
