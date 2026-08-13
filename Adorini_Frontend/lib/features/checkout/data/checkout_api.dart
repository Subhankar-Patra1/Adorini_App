import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';
import '../../cart/data/cart_api.dart';

class Address {
  const Address({
    required this.id,
    required this.recipientName,
    required this.recipientPhone,
    required this.line1,
    required this.city,
    required this.state,
    required this.pincode,
    required this.isDefault,
    this.line2,
  });

  factory Address.fromJson(Map<String, dynamic> json) {
    return Address(
      id: json['id'] as String,
      recipientName: json['recipientName'] as String,
      recipientPhone: json['recipientPhone'] as String,
      line1: json['line1'] as String,
      line2: json['line2'] as String?,
      city: json['city'] as String,
      state: json['state'] as String,
      pincode: json['pincode'] as String,
      isDefault: json['isDefault'] as bool,
    );
  }

  final String id;
  final String recipientName;
  final String recipientPhone;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String pincode;
  final bool isDefault;

  String get formatted => <String>[
        line1,
        if (line2 != null && line2!.isNotEmpty) line2!,
        city,
        '$state - $pincode',
      ].join(', ');
}

/// Result of `POST /checkout/place`.
///
/// Branch on [requiresCodVerification] (COD → confirm with an intent code) and
/// [paymentSessionId] (prepaid → hand to the Cashfree SDK).
class PlacedOrder {
  const PlacedOrder({
    required this.orderId,
    required this.orderNumber,
    required this.status,
    required this.paymentMethod,
    required this.totalPaise,
    required this.requiresCodVerification,
    this.paymentSessionId,
  });

  factory PlacedOrder.fromJson(Map<String, dynamic> json) {
    return PlacedOrder(
      orderId: json['orderId'] as String,
      orderNumber: json['orderNumber'] as String,
      status: OrderStatus.fromWire(json['status'] as String),
      paymentMethod: PaymentMethod.fromWire(json['paymentMethod'] as String),
      totalPaise: json['totalPaise'] as int,
      paymentSessionId: json['paymentSessionId'] as String?,
      requiresCodVerification: json['requiresCodVerification'] as bool,
    );
  }

  final String orderId;
  final String orderNumber;
  final OrderStatus status;
  final PaymentMethod paymentMethod;
  final int totalPaise;

  /// Prepaid only — the handle the Cashfree SDK opens. Null for COD.
  final String? paymentSessionId;
  final bool requiresCodVerification;
}

class CheckoutApi {
  CheckoutApi(this._dio);

  final Dio _dio;

  Future<List<Address>> listAddresses() async {
    final Response<List<dynamic>> response =
        await _dio.get<List<dynamic>>(ApiConstants.addresses);
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => Address.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Address> createAddress({
    required String recipientName,
    required String recipientPhone,
    required String line1,
    required String city,
    required String state,
    required String pincode,
    String? line2,
    bool? isDefault,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.addresses,
      data: <String, dynamic>{
        'recipientName': recipientName,
        'recipientPhone': recipientPhone,
        'line1': line1,
        if (line2 != null && line2.isNotEmpty) 'line2': line2,
        'city': city,
        'state': state,
        'pincode': pincode,
        if (isDefault != null) 'isDefault': isDefault,
      },
    );
    return Address.fromJson(response.data!);
  }

  /// Preview of the amount payable, computed by the same code that runs at
  /// placement — the figure shown is the figure charged.
  Future<CartView> quote({int walletCreditPaise = 0, String? couponCode}) async {
    final Response<Map<String, dynamic>> response = await _dio.get<Map<String, dynamic>>(
      ApiConstants.checkoutQuote,
      queryParameters: <String, dynamic>{
        'walletCreditPaise': walletCreditPaise,
        if (couponCode != null && couponCode.isNotEmpty) 'couponCode': couponCode,
      },
    );
    return CartView.fromJson(response.data!);
  }

  /// Note the body carries no amounts — the client chooses *what* to buy and
  /// *how* to pay; every figure is derived server-side.
  Future<PlacedOrder> place({
    required String addressId,
    required PaymentMethod paymentMethod,
    int walletCreditPaise = 0,
    String? couponCode,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.checkoutPlace,
      data: <String, dynamic>{
        'addressId': addressId,
        'paymentMethod': paymentMethod.wire,
        'walletCreditPaise': walletCreditPaise,
        if (couponCode != null && couponCode.isNotEmpty) 'couponCode': couponCode,
      },
    );
    return PlacedOrder.fromJson(response.data!);
  }

  /// Idempotent — verifying an already-confirmed order returns its status.
  Future<OrderStatus> verifyCod({required String orderId, required String otp}) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.verifyCod(orderId),
      data: <String, String>{'otp': otp},
    );
    return OrderStatus.fromWire(response.data!['status'] as String);
  }

  /// Returns the seconds until the new code expires.
  Future<int> resendCod(String orderId) async {
    final Response<Map<String, dynamic>> response =
        await _dio.post<Map<String, dynamic>>(ApiConstants.resendCod(orderId));
    return response.data!['expiresInSeconds'] as int;
  }
}
