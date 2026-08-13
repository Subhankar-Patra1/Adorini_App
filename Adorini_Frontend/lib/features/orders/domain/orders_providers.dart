import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/orders_api.dart';
import '../data/returns_api.dart';

final Provider<OrdersApi> ordersApiProvider = Provider<OrdersApi>(
  (Ref ref) => OrdersApi(ref.watch(dioProvider)),
);

final Provider<ReturnsApi> returnsApiProvider = Provider<ReturnsApi>(
  (Ref ref) => ReturnsApi(ref.watch(dioProvider)),
);

final FutureProvider<List<OrderSummary>> orderHistoryProvider = FutureProvider<List<OrderSummary>>(
  (Ref ref) => ref.watch(ordersApiProvider).list(),
);

/// Order detail carries the tracking timeline — there is no separate tracking
/// endpoint to call.
final FutureProviderFamily<OrderDetail, String> orderDetailProvider =
    FutureProvider.family<OrderDetail, String>(
  (Ref ref, String orderId) => ref.watch(ordersApiProvider).getDetail(orderId),
);

final FutureProviderFamily<List<EligibleItem>, String> eligibleReturnItemsProvider =
    FutureProvider.family<List<EligibleItem>, String>(
  (Ref ref, String orderId) => ref.watch(returnsApiProvider).listEligibleItems(orderId),
);

final FutureProvider<List<ReturnRequest>> myReturnsProvider = FutureProvider<List<ReturnRequest>>(
  (Ref ref) => ref.watch(returnsApiProvider).listMine(),
);
