import 'dart:io';
import 'package:flutter/foundation.dart';

class ApiConstants {
  const ApiConstants._();

  static String get baseUrl {
    const String envUrl = String.fromEnvironment('API_BASE_URL');
    if (envUrl.isNotEmpty) return envUrl;
    
    // Auto-detect based on platform
    if (!kIsWeb && Platform.isAndroid) {
      return 'http://10.0.2.2:3000/api';
    }
    return 'http://localhost:3000/api';
  }

  // ---- auth ----
  static const String otpRequest = '/auth/otp/request';
  static const String otpVerify = '/auth/otp/verify';
  static const String google = '/auth/google';
  static const String googleLink = '/auth/google/link';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';
  static const String logoutAll = '/auth/logout-all';

  // ---- catalog (public) ----
  static const String categories = '/catalog/categories';
  static const String brands = '/catalog/brands';
  static const String products = '/catalog/products';

  // ---- pdp (public reads; keyed by slug, not id) ----
  static String productDetail(String slug) => '/pdp/$slug';
  static String productReviews(String slug) => '/pdp/$slug/reviews';
  static String sizeEnquiry(String slug) => '/pdp/$slug/size-enquiry';

  // ---- cart ----
  static const String cart = '/cart';
  static const String cartItems = '/cart/items';
  static String cartItem(String lineId) => '/cart/items/$lineId';

  // ---- checkout ----
  static const String checkoutQuote = '/checkout/quote';
  static const String checkoutPlace = '/checkout/place';
  static String verifyCod(String orderId) => '/checkout/orders/$orderId/verify-cod';
  static String resendCod(String orderId) => '/checkout/orders/$orderId/resend-cod';

  // ---- orders ----
  static const String orders = '/orders';
  static String order(String orderId) => '/orders/$orderId';
  static String orderAddress(String orderId) => '/orders/$orderId/address';
  static String cancelOrder(String orderId) => '/orders/$orderId/cancel';
  static String requestRedelivery(String orderId) => '/orders/$orderId/request-redelivery';

  // ---- returns ----
  static const String returns = '/returns';
  static String eligibleReturnItems(String orderId) => '/returns/orders/$orderId/eligible-items';
  static String requestReturn(String orderId) => '/returns/orders/$orderId';

  // ---- users ----
  static const String me = '/users/me';
  static const String avatar = '/users/me/avatar';
  static const String referralCode = '/users/me/referral-code';
  static const String referrals = '/users/me/referrals';
  static const String addresses = '/users/me/addresses';
  static String address(String id) => '/users/me/addresses/$id';
  static String defaultAddress(String id) => '/users/me/addresses/$id/default';

  // ---- videos (public) ----
  static const String videos = '/videos';

  // ---- wallet ----
  static const String wallet = '/wallet';
  static const String walletTransactions = '/wallet/transactions';
}
