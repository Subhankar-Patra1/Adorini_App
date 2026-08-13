import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/checkout_api.dart';

final Provider<CheckoutApi> checkoutApiProvider = Provider<CheckoutApi>(
  (Ref ref) => CheckoutApi(ref.watch(dioProvider)),
);

final FutureProvider<List<Address>> addressListProvider = FutureProvider<List<Address>>(
  (Ref ref) => ref.watch(checkoutApiProvider).listAddresses(),
);
