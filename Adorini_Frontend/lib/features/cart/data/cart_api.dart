import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';

/// One line in the cart. [id] is the *line* id used for update/remove;
/// [variantId] is what identifies the size/colour being bought.
class CartLine {
  const CartLine({
    required this.id,
    required this.variantId,
    required this.productId,
    required this.productSlug,
    required this.productName,
    required this.sku,
    required this.nominalSize,
    required this.colour,
    required this.unitPricePaise,
    required this.quantity,
    required this.lineTotalPaise,
    required this.stockQuantity,
    required this.inStock,
  });

  factory CartLine.fromJson(Map<String, dynamic> json) {
    return CartLine(
      id: json['id'] as String,
      variantId: json['variantId'] as String,
      productId: json['productId'] as String,
      productSlug: json['productSlug'] as String,
      productName: json['productName'] as String,
      sku: json['sku'] as String,
      nominalSize: json['nominalSize'] as int,
      colour: json['colour'] as String,
      unitPricePaise: json['unitPricePaise'] as int,
      quantity: json['quantity'] as int,
      lineTotalPaise: json['lineTotalPaise'] as int,
      stockQuantity: json['stockQuantity'] as int,
      inStock: json['inStock'] as bool,
    );
  }

  final String id;
  final String variantId;
  final String productId;
  final String productSlug;
  final String productName;
  final String sku;
  final int nominalSize;
  final String colour;
  final int unitPricePaise;
  final int quantity;
  final int lineTotalPaise;
  final int stockQuantity;
  final bool inStock;
}

/// Server-computed totals. Every figure is derived from the catalogue — the
/// client never sends an amount, so there is nothing here to tamper with.
class OrderTotals {
  const OrderTotals({
    required this.subtotalPaise,
    required this.discountPaise,
    required this.discountSource,
    required this.deliveryFeePaise,
    required this.walletCreditPaise,
    required this.totalPaise,
    required this.freeDeliveryShortfallPaise,
    required this.qualifiesForFreeDelivery,
  });

  factory OrderTotals.fromJson(Map<String, dynamic> json) {
    return OrderTotals(
      subtotalPaise: json['subtotalPaise'] as int,
      discountPaise: json['discountPaise'] as int,
      discountSource: json['discountSource'] as String,
      deliveryFeePaise: json['deliveryFeePaise'] as int,
      walletCreditPaise: json['walletCreditPaise'] as int,
      totalPaise: json['totalPaise'] as int,
      freeDeliveryShortfallPaise: json['freeDeliveryShortfallPaise'] as int,
      qualifiesForFreeDelivery: json['qualifiesForFreeDelivery'] as bool,
    );
  }

  final int subtotalPaise;
  final int discountPaise;

  /// `FIRST_ORDER`, `COUPON`, or `NONE` — promotions never stack.
  final String discountSource;
  final int deliveryFeePaise;
  final int walletCreditPaise;
  final int totalPaise;

  /// Drives the "₹X away from free delivery" progress bar.
  final int freeDeliveryShortfallPaise;
  final bool qualifiesForFreeDelivery;

  bool get couponApplied => discountSource == 'COUPON';
}

/// Every cart mutation returns the **whole cart**, not just the changed line —
/// prices, stock and the delivery-progress bar all move together.
class CartView {
  const CartView({
    required this.items,
    required this.totals,
    required this.isPurchasable,
    this.couponMessage,
  });

  factory CartView.fromJson(Map<String, dynamic> json) {
    return CartView(
      items: (json['items'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => CartLine.fromJson(e as Map<String, dynamic>))
          .toList(),
      totals: OrderTotals.fromJson(json['totals'] as Map<String, dynamic>),
      isPurchasable: json['isPurchasable'] as bool,
      couponMessage: json['couponMessage'] as String?,
    );
  }

  final List<CartLine> items;
  final OrderTotals totals;
  final bool isPurchasable;

  /// Set only when a coupon code was supplied and rejected — explains why.
  /// Silent when no code was given and when the code worked.
  final String? couponMessage;

  bool get isEmpty => items.isEmpty;
  int get itemCount => items.fold(0, (int sum, CartLine l) => sum + l.quantity);
}

class CartApi {
  CartApi(this._dio);

  final Dio _dio;

  /// Coupons and wallet credit are **query parameters on the read**, not
  /// separate mutations — both are previews the server re-checks at placement.
  Future<CartView> getCart({int walletCreditPaise = 0, String? couponCode}) async {
    final Response<Map<String, dynamic>> response = await _dio.get<Map<String, dynamic>>(
      ApiConstants.cart,
      queryParameters: <String, dynamic>{
        'walletCreditPaise': walletCreditPaise,
        if (couponCode != null && couponCode.isNotEmpty) 'couponCode': couponCode,
      },
    );
    return CartView.fromJson(response.data!);
  }

  /// Adding a variant already in the cart increases its quantity rather than
  /// duplicating the line.
  Future<CartView> addItem({required String variantId, int quantity = 1}) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.cartItems,
      data: <String, dynamic>{'variantId': variantId, 'quantity': quantity},
    );
    return CartView.fromJson(response.data!);
  }

  /// Pass [variantId] to switch size/colour inline; switching onto a variant
  /// already in the cart merges the two lines.
  Future<CartView> updateItem({
    required String lineId,
    int? quantity,
    String? variantId,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.patch<Map<String, dynamic>>(
      ApiConstants.cartItem(lineId),
      data: <String, dynamic>{
        if (quantity != null) 'quantity': quantity,
        if (variantId != null) 'variantId': variantId,
      },
    );
    return CartView.fromJson(response.data!);
  }

  Future<CartView> removeItem(String lineId) async {
    final Response<Map<String, dynamic>> response =
        await _dio.delete<Map<String, dynamic>>(ApiConstants.cartItem(lineId));
    return CartView.fromJson(response.data!);
  }

  Future<CartView> clear() async {
    final Response<Map<String, dynamic>> response =
        await _dio.delete<Map<String, dynamic>>(ApiConstants.cart);
    return CartView.fromJson(response.data!);
  }
}
