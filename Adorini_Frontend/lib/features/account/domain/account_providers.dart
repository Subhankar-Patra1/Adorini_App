import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../../auth/data/auth_api.dart';
import '../data/account_api.dart';

final Provider<AccountApi> accountApiProvider = Provider<AccountApi>(
  (Ref ref) => AccountApi(ref.watch(dioProvider)),
);

final FutureProvider<PublicUser> userProfileProvider = FutureProvider<PublicUser>(
  (Ref ref) => ref.watch(accountApiProvider).getProfile(),
);
