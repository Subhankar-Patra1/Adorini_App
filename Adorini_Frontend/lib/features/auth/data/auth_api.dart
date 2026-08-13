import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/domain_enums.dart';

/// `publicUserSchema` in `auth.dto.ts`. Shared by auth and `/users/me`.
class PublicUser {
  const PublicUser({
    required this.id,
    required this.phone,
    required this.isPhoneVerified,
    required this.hasGoogleLinked,
    this.email,
    this.fullName,
    this.gender,
    this.profilePhotoKey,
  });

  factory PublicUser.fromJson(Map<String, dynamic> json) {
    return PublicUser(
      id: json['id'] as String,
      phone: json['phone'] as String,
      email: json['email'] as String?,
      fullName: json['fullName'] as String?,
      gender: json['gender'] as String?,
      profilePhotoKey: json['profilePhotoKey'] as String?,
      isPhoneVerified: json['isPhoneVerified'] as bool,
      hasGoogleLinked: json['hasGoogleLinked'] as bool,
    );
  }

  final String id;
  final String phone;
  final String? email;
  final String? fullName;
  final String? gender;
  final String? profilePhotoKey;
  final bool isPhoneVerified;
  final bool hasGoogleLinked;

  /// Falls back to the phone number — `fullName` is nullable and a blank
  /// profile header reads as a loading bug.
  String get displayName => fullName?.trim().isNotEmpty == true ? fullName! : phone;
}

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

/// `loginResultSchema` — the full sign-in payload.
class LoginResult {
  const LoginResult({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.isNewUser,
    required this.referralApplied,
    required this.referralStatus,
    required this.user,
  });

  factory LoginResult.fromJson(Map<String, dynamic> json) {
    return LoginResult(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresIn: json['expiresIn'] as int,
      isNewUser: json['isNewUser'] as bool,
      referralApplied: json['referralApplied'] as bool,
      referralStatus: ReferralOutcome.fromWire(json['referralStatus'] as String),
      user: PublicUser.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
  final bool isNewUser;
  final bool referralApplied;
  final ReferralOutcome referralStatus;
  final PublicUser user;
}

class RefreshedTokens {
  const RefreshedTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory RefreshedTokens.fromJson(Map<String, dynamic> json) {
    return RefreshedTokens(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresIn: json['expiresIn'] as int,
    );
  }

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
}

/// Google sign-in answers with one of two shapes, discriminated by `status`.
/// `PHONE_REQUIRED` is a 200, not an error: the identity is verified but the
/// account cannot exist until a phone is confirmed by OTP.
sealed class GoogleSignInResult {
  const GoogleSignInResult();

  factory GoogleSignInResult.fromJson(Map<String, dynamic> json) {
    return json['status'] == 'PHONE_REQUIRED'
        ? GooglePhoneRequired.fromJson(json)
        : GoogleAuthenticated(LoginResult.fromJson(json));
  }
}

class GoogleAuthenticated extends GoogleSignInResult {
  const GoogleAuthenticated(this.login);

  final LoginResult login;
}

class GooglePhoneRequired extends GoogleSignInResult {
  const GooglePhoneRequired({required this.registrationToken, required this.expiresInSeconds});

  factory GooglePhoneRequired.fromJson(Map<String, dynamic> json) {
    return GooglePhoneRequired(
      registrationToken: json['registrationToken'] as String,
      expiresInSeconds: json['expiresInSeconds'] as int,
    );
  }

  final String registrationToken;
  final int expiresInSeconds;
}

/// Talks to the `auth` module. Note the field is `phone`, not `phoneNumber`,
/// and the server normalises it — send it as typed.
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

  /// [registrationToken] finishes a signup that began with Google.
  /// [referralCode] must ride along with this request — referrals attach only
  /// at account creation and cannot be applied afterwards.
  Future<LoginResult> verifyOtp({
    required String phone,
    required String otp,
    String? registrationToken,
    String? referralCode,
  }) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.otpVerify,
      data: <String, String>{
        'phone': phone,
        'otp': otp,
        if (registrationToken != null) 'registrationToken': registrationToken,
        if (referralCode != null) 'referralCode': referralCode,
      },
    );
    return LoginResult.fromJson(response.data!);
  }

  Future<GoogleSignInResult> signInWithGoogle(String idToken) async {
    final Response<Map<String, dynamic>> response = await _dio.post<Map<String, dynamic>>(
      ApiConstants.google,
      data: <String, String>{'idToken': idToken},
    );
    return GoogleSignInResult.fromJson(response.data!);
  }

  /// Revokes one refresh token. Idempotent — an unknown token still returns 204.
  Future<void> logout(String refreshToken) async {
    await _dio.post<void>(
      ApiConstants.logout,
      data: <String, String>{'refreshToken': refreshToken},
    );
  }
}
