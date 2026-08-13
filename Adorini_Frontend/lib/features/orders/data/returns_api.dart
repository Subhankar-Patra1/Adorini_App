import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';

/// One line of an order, with whether it can still be returned.
/// Ineligible items are included *with a reason* so the app can explain rather
/// than silently hide the option.
class EligibleItem {
  const EligibleItem({
    required this.orderItemId,
    required this.productName,
    required this.nominalSize,
    required this.colour,
    required this.quantity,
    required this.isEligible,
    this.reasonIneligible,
  });

  factory EligibleItem.fromJson(Map<String, dynamic> json) {
    return EligibleItem(
      orderItemId: json['orderItemId'] as String,
      productName: json['productName'] as String,
      nominalSize: json['nominalSize'] as int,
      colour: json['colour'] as String,
      quantity: json['quantity'] as int,
      isEligible: json['isEligible'] as bool,
      reasonIneligible: json['reasonIneligible'] as String?,
    );
  }

  final String orderItemId;
  final String productName;
  final int nominalSize;
  final String colour;
  final int quantity;
  final bool isEligible;
  final String? reasonIneligible;
}

class ReturnRequest {
  const ReturnRequest({
    required this.id,
    required this.orderId,
    required this.orderNumber,
    required this.orderItemId,
    required this.productName,
    required this.nominalSize,
    required this.colour,
    required this.quantity,
    required this.reason,
    required this.status,
    required this.createdAt,
    this.comment,
    this.fitTag,
    this.adminNote,
    this.resolvedAt,
  });

  factory ReturnRequest.fromJson(Map<String, dynamic> json) {
    return ReturnRequest(
      id: json['id'] as String,
      orderId: json['orderId'] as String,
      orderNumber: json['orderNumber'] as String,
      orderItemId: json['orderItemId'] as String,
      productName: json['productName'] as String,
      nominalSize: json['nominalSize'] as int,
      colour: json['colour'] as String,
      quantity: json['quantity'] as int,
      reason: json['reason'] as String,
      comment: json['comment'] as String?,
      fitTag: FitTag.fromWire(json['fitTag'] as String?),
      status: ReturnStatus.fromWire(json['status'] as String),
      adminNote: json['adminNote'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      resolvedAt:
          json['resolvedAt'] == null ? null : DateTime.parse(json['resolvedAt'] as String),
    );
  }

  final String id;
  final String orderId;
  final String orderNumber;
  final String orderItemId;
  final String productName;
  final int nominalSize;
  final String colour;
  final int quantity;
  final String reason;
  final String? comment;
  final FitTag? fitTag;
  final ReturnStatus status;
  final String? adminNote;
  final DateTime createdAt;
  final DateTime? resolvedAt;
}

class ReturnsApi {
  ReturnsApi(this._dio);

  final Dio _dio;

  Future<List<ReturnRequest>> listMine() async {
    final Response<List<dynamic>> response = await _dio.get<List<dynamic>>(ApiConstants.returns);
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => ReturnRequest.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// 409 if the order has not been delivered yet.
  Future<List<EligibleItem>> listEligibleItems(String orderId) async {
    final Response<List<dynamic>> response =
        await _dio.get<List<dynamic>>(ApiConstants.eligibleReturnItems(orderId));
    return (response.data ?? <dynamic>[])
        .map((dynamic e) => EligibleItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// One item per request, within 3 days of **delivery**.
  ///
  /// [fitTag] is only worth sending for non-sizing reasons — a sizing reason
  /// derives its own tag server-side so the two can never contradict.
  /// There is no photo upload on this endpoint.
  Future<ReturnRequest> requestReturn({
    required String orderId,
    required String orderItemId,
    required int quantity,
    required ReturnReason reason,
    String? comment,
    FitTag? fitTag,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.requestReturn(orderId),
      data: <String, dynamic>{
        'orderItemId': orderItemId,
        'quantity': quantity,
        'reason': reason.wire,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
        if (fitTag != null) 'fitTag': fitTag.wire,
      },
    );
    return ReturnRequest.fromJson(response.data!);
  }
}
