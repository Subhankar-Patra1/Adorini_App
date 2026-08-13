import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';

class WalletBalance {
  const WalletBalance({required this.balancePaise, required this.pendingReferralCreditPaise});

  factory WalletBalance.fromJson(Map<String, dynamic> json) {
    return WalletBalance(
      balancePaise: json['balancePaise'] as int,
      pendingReferralCreditPaise: json['pendingReferralCreditPaise'] as int,
    );
  }

  final int balancePaise;

  /// Referral rewards recorded but not yet released — shown separately so a
  /// referrer can see the reward coming without it looking spendable today.
  final int pendingReferralCreditPaise;
}

class WalletEntry {
  const WalletEntry({
    required this.id,
    required this.type,
    required this.amountPaise,
    required this.balanceAfterPaise,
    required this.createdAt,
    this.description,
  });

  factory WalletEntry.fromJson(Map<String, dynamic> json) {
    return WalletEntry(
      id: json['id'] as String,
      type: WalletTransactionType.fromWire(json['type'] as String),
      amountPaise: json['amountPaise'] as int,
      balanceAfterPaise: json['balanceAfterPaise'] as int,
      description: json['description'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final WalletTransactionType type;

  /// Already signed: credits positive, debits negative.
  final int amountPaise;
  final int balanceAfterPaise;
  final String? description;
  final DateTime createdAt;

  bool get isCredit => amountPaise >= 0;
}

class Referral {
  const Referral({
    required this.id,
    required this.status,
    required this.creditPaise,
    required this.createdAt,
    this.creditedAt,
  });

  factory Referral.fromJson(Map<String, dynamic> json) {
    return Referral(
      id: json['id'] as String,
      status: ReferralStatus.fromWire(json['status'] as String),
      creditPaise: json['creditPaise'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
      creditedAt:
          json['creditedAt'] == null ? null : DateTime.parse(json['creditedAt'] as String),
    );
  }

  final String id;
  final ReferralStatus status;
  final int creditPaise;
  final DateTime createdAt;
  final DateTime? creditedAt;
}

class WalletApi {
  WalletApi(this._dio);

  final Dio _dio;

  Future<WalletBalance> getBalance() async {
    final Response<Map<String, dynamic>> response =
        await _dio.get<Map<String, dynamic>>(ApiConstants.wallet);
    return WalletBalance.fromJson(response.data!);
  }

  /// Statement, newest first. Every entry carries the balance as it stood
  /// immediately after it, so a disputed balance walks back line by line.
  Future<List<WalletEntry>> listTransactions({int limit = 50, int offset = 0}) async {
    final Response<List<dynamic>> response = await _dio.get<List<dynamic>>(
      ApiConstants.walletTransactions,
      queryParameters: <String, dynamic>{'limit': limit, 'offset': offset},
    );
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => WalletEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Minted on first request, then stable for the life of the account.
  /// Lives on the users module, not wallet.
  Future<String> getReferralCode() async {
    final Response<Map<String, dynamic>> response =
        await _dio.get<Map<String, dynamic>>(ApiConstants.referralCode);
    return response.data!['referralCode'] as String;
  }

  /// Status and amounts only — referees are never identified.
  Future<List<Referral>> listReferrals() async {
    final Response<List<dynamic>> response =
        await _dio.get<List<dynamic>>(ApiConstants.referrals);
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => Referral.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
