import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/pdp_api.dart';

final Provider<PdpApi> pdpApiProvider = Provider<PdpApi>((Ref ref) => PdpApi(ref.watch(dioProvider)));

/// Keyed by product **slug** — the PDP route is `/pdp/:slug`.
final FutureProviderFamily<ProductDetail, String> productDetailProvider =
    FutureProvider.family<ProductDetail, String>(
  (Ref ref, String slug) => ref.watch(pdpApiProvider).getProductDetail(slug),
);
