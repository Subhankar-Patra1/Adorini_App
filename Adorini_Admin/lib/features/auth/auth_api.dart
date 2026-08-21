import 'package:dio/dio.dart';

import '../../core/constants/api_constants.dart';

/// 202 response from `/auth/otp/request`. Drives the resend countdown.
class OtpRequested {
  const OtpRequested({required this.expiresInSeconds, required this.resendAfterSeconds});

  factory OtpRequested.fromJson(Map<String, dynamic> json) {
    return OtpRequested(
      expiresInSeconds: json['expiresInSeconds'] as int,
      resendAfterSeconds: json['resendAfterSeconds'] as int,
    );
  }

  final int expiresInSeconds;
  final int resendAfterSeconds;
}

/// The subset of `loginResultSchema` this app actually uses. `isAdmin` is
/// deliberately absent — the backend never exposes it to any client
/// (`AdminGuard` re-checks the database on every admin request instead), so
/// whether this account is staff is discovered by calling an admin route and
/// seeing whether it comes back 403, not by reading a field here.
class LoginResult {
  const LoginResult({required this.accessToken, required this.refreshToken});

  factory LoginResult.fromJson(Map<String, dynamic> json) {
    return LoginResult(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );
  }

  final String accessToken;
  final String refreshToken;
}

/// Talks to the `auth` module — the same phone-OTP flow every buyer uses.
/// There is no separate admin login; `AdminGuard` on the backend is what
/// actually decides whether this account may proceed past sign-in.
class AuthApi {
  AuthApi(this._dio);

  final Dio _dio;

  Future<OtpRequested> requestOtp(String phone) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.otpRequest,
      data: <String, String>{'phone': phone},
    );
    return OtpRequested.fromJson(response.data!);
  }

  Future<LoginResult> verifyOtp({required String phone, required String otp}) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.otpVerify,
      data: <String, String>{'phone': phone, 'otp': otp},
    );
    return LoginResult.fromJson(response.data!);
  }
}
