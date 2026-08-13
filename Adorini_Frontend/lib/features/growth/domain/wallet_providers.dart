import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/wallet_api.dart';

final Provider<WalletApi> walletApiProvider = Provider<WalletApi>(
  (Ref ref) => WalletApi(ref.watch(dioProvider)),
);

final FutureProvider<WalletBalance> walletBalanceProvider = FutureProvider<WalletBalance>(
  (Ref ref) => ref.watch(walletApiProvider).getBalance(),
);

final FutureProvider<List<WalletEntry>> walletTransactionsProvider =
    FutureProvider<List<WalletEntry>>(
  (Ref ref) => ref.watch(walletApiProvider).listTransactions(),
);

final FutureProvider<String> referralCodeProvider = FutureProvider<String>(
  (Ref ref) => ref.watch(walletApiProvider).getReferralCode(),
);

final FutureProvider<List<Referral>> referralsProvider = FutureProvider<List<Referral>>(
  (Ref ref) => ref.watch(walletApiProvider).listReferrals(),
);
