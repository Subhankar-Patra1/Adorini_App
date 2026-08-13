import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';

class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.totalPaise,
    required this.itemCount,
    required this.createdAt,
  });

  factory OrderSummary.fromJson(Map<String, dynamic> json) {
    return OrderSummary(
      id: json['id'] as String,
      orderNumber: json['orderNumber'] as String,
      status: OrderStatus.fromWire(json['status'] as String),
      paymentMethod: PaymentMethod.fromWire(json['paymentMethod'] as String),
      paymentStatus: PaymentStatus.fromWire(json['paymentStatus'] as String),
      totalPaise: json['totalPaise'] as int,
      itemCount: json['itemCount'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String orderNumber;
  final OrderStatus status;
  final PaymentMethod paymentMethod;
  final PaymentStatus paymentStatus;
  final int totalPaise;
  final int itemCount;
  final DateTime createdAt;
}

class OrderLine {
  const OrderLine({
    required this.id,
    required this.productName,
    required this.sku,
    required this.nominalSize,
    required this.colour,
    required this.unitPricePaise,
    required this.quantity,
    required this.lineTotalPaise,
    this.productId,
  });

  factory OrderLine.fromJson(Map<String, dynamic> json) {
    return OrderLine(
      id: json['id'] as String,
      productId: json['productId'] as String?,
      productName: json['productName'] as String,
      sku: json['sku'] as String,
      nominalSize: json['nominalSize'] as int,
      colour: json['colour'] as String,
      unitPricePaise: json['unitPricePaise'] as int,
      quantity: json['quantity'] as int,
      lineTotalPaise: json['lineTotalPaise'] as int,
    );
  }

  final String id;
  final String? productId;
  final String productName;
  final String sku;
  final int nominalSize;
  final String colour;
  final int unitPricePaise;
  final int quantity;
  final int lineTotalPaise;
}

/// An order snapshots its address, so this is a value, not a saved-address ref.
class ShippingAddress {
  const ShippingAddress({
    required this.recipientName,
    required this.recipientPhone,
    required this.line1,
    required this.city,
    required this.state,
    required this.pincode,
    this.line2,
  });

  factory ShippingAddress.fromJson(Map<String, dynamic> json) {
    return ShippingAddress(
      recipientName: json['recipientName'] as String,
      recipientPhone: json['recipientPhone'] as String,
      line1: json['line1'] as String,
      line2: json['line2'] as String?,
      city: json['city'] as String,
      state: json['state'] as String,
      pincode: json['pincode'] as String,
    );
  }

  final String recipientName;
  final String recipientPhone;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String pincode;

  String get formatted => <String>[
        line1,
        if (line2 != null && line2!.isNotEmpty) line2!,
        city,
        '$state - $pincode',
      ].join(', ');
}

/// Full order detail. Tracking is part of this payload — there is **no**
/// separate `/orders/:id/tracking` endpoint; the timeline is derived from the
/// status timestamps below.
class OrderDetail {
  const OrderDetail({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.totalPaise,
    required this.itemCount,
    required this.createdAt,
    required this.subtotalPaise,
    required this.discountPaise,
    required this.deliveryFeePaise,
    required this.walletCreditPaise,
    required this.shippingAddress,
    required this.items,
    required this.canEditAddress,
    required this.canCancel,
    required this.deliveryAttempts,
    required this.canRequestReattempt,
    required this.attemptsRemaining,
    this.delhiveryWaybill,
    this.codVerifiedAt,
    this.shippedAt,
    this.deliveredAt,
    this.cancelledAt,
    this.cancellationReason,
    this.lastDeliveryFailedAt,
    this.respondBy,
  });

  factory OrderDetail.fromJson(Map<String, dynamic> json) {
    DateTime? date(String key) =>
        json[key] == null ? null : DateTime.parse(json[key] as String);

    return OrderDetail(
      id: json['id'] as String,
      orderNumber: json['orderNumber'] as String,
      status: OrderStatus.fromWire(json['status'] as String),
      paymentMethod: PaymentMethod.fromWire(json['paymentMethod'] as String),
      paymentStatus: PaymentStatus.fromWire(json['paymentStatus'] as String),
      totalPaise: json['totalPaise'] as int,
      itemCount: json['itemCount'] as int,
      createdAt: DateTime.parse(json['createdAt'] as String),
      subtotalPaise: json['subtotalPaise'] as int,
      discountPaise: json['discountPaise'] as int,
      deliveryFeePaise: json['deliveryFeePaise'] as int,
      walletCreditPaise: json['walletCreditPaise'] as int,
      shippingAddress:
          ShippingAddress.fromJson(json['shippingAddress'] as Map<String, dynamic>),
      delhiveryWaybill: json['delhiveryWaybill'] as String?,
      codVerifiedAt: date('codVerifiedAt'),
      shippedAt: date('shippedAt'),
      deliveredAt: date('deliveredAt'),
      cancelledAt: date('cancelledAt'),
      cancellationReason: json['cancellationReason'] as String?,
      items: (json['items'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => OrderLine.fromJson(e as Map<String, dynamic>))
          .toList(),
      canEditAddress: json['canEditAddress'] as bool,
      canCancel: json['canCancel'] as bool,
      deliveryAttempts: json['deliveryAttempts'] as int,
      lastDeliveryFailedAt: date('lastDeliveryFailedAt'),
      canRequestReattempt: json['canRequestReattempt'] as bool,
      respondBy: date('respondByIso'),
      attemptsRemaining: json['attemptsRemaining'] as int,
    );
  }

  final String id;
  final String orderNumber;
  final OrderStatus status;
  final PaymentMethod paymentMethod;
  final PaymentStatus paymentStatus;
  final int totalPaise;
  final int itemCount;
  final DateTime createdAt;
  final int subtotalPaise;
  final int discountPaise;
  final int deliveryFeePaise;
  final int walletCreditPaise;
  final ShippingAddress shippingAddress;
  final String? delhiveryWaybill;
  final DateTime? codVerifiedAt;
  final DateTime? shippedAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final List<OrderLine> items;
  final bool canEditAddress;
  final bool canCancel;

  // ---- failed-delivery retry offer ----
  final int deliveryAttempts;
  final DateTime? lastDeliveryFailedAt;

  /// Whether to show "still want this? tap to reschedule". False once the
  /// window closes or the courier's reattempts are used up.
  final bool canRequestReattempt;
  final DateTime? respondBy;
  final int attemptsRemaining;

  /// Timeline steps for the tracking screen, derived from the timestamps.
  List<({String label, DateTime? at, bool done})> get timeline {
    if (status == OrderStatus.cancelled) {
      return <({String label, DateTime? at, bool done})>[
        (label: 'Ordered', at: createdAt, done: true),
        (label: 'Cancelled', at: cancelledAt, done: true),
      ];
    }

    return <({String label, DateTime? at, bool done})>[
      (label: 'Ordered', at: createdAt, done: true),
      (
        label: 'Confirmed',
        at: codVerifiedAt,
        done: status.index >= OrderStatus.confirmed.index,
      ),
      (label: 'Shipped', at: shippedAt, done: shippedAt != null),
      if (status == OrderStatus.deliveryFailed)
        (label: 'Delivery attempted', at: lastDeliveryFailedAt, done: true),
      (label: 'Delivered', at: deliveredAt, done: deliveredAt != null),
    ];
  }
}

class OrdersApi {
  OrdersApi(this._dio);

  final Dio _dio;

  /// Returns a bare JSON array, not a `{ items }` envelope. Offset-paginated.
  Future<List<OrderSummary>> list({int limit = 20, int offset = 0}) async {
    final Response<List<dynamic>> response = await _dio.get<List<dynamic>>(
      ApiConstants.orders,
      queryParameters: <String, dynamic>{'limit': limit, 'offset': offset},
    );
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => OrderSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<OrderDetail> getDetail(String orderId) async {
    final Response<Map<String, dynamic>> response =
        await _dio.get<Map<String, dynamic>>(ApiConstants.order(orderId));
    return OrderDetail.fromJson(response.data!);
  }

  Future<OrderDetail> cancel({required String orderId, String? reason}) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.cancelOrder(orderId),
      data: <String, String>{if (reason != null && reason.isNotEmpty) 'reason': reason},
    );
    return OrderDetail.fromJson(response.data!);
  }

  /// Asks the courier for another delivery attempt on the same waybill.
  Future<OrderDetail> requestRedelivery(String orderId) async {
    final Response<Map<String, dynamic>> response =
        await _dio.post<Map<String, dynamic>>(ApiConstants.requestRedelivery(orderId));
    return OrderDetail.fromJson(response.data!);
  }
}
