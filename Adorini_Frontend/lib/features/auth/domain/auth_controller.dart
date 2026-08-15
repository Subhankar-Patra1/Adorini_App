import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_error.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/storage/token_storage.dart';
import '../data/auth_api.dart';
import 'auth_state.dart';

final Provider<AuthApi> authApiProvider = Provider<AuthApi>(
  (Ref ref) => AuthApi(ref.watch(dioProvider)),
);

final NotifierProvider<AuthController, AuthState> authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _restoreSession();
    return const AuthState();
  }

  AuthApi get _api => ref.read(authApiProvider);
  TokenStorage get _tokenStorage => ref.read(tokenStorageProvider);

  Future<void> _restoreSession() async {
    final String? token = await _tokenStorage.readAccessToken();
    state = state.copyWith(
      status:
          token != null ? AuthStatus.authenticated : AuthStatus.unauthenticated,
    );
  }

  Future<void> requestOtp(String phone) async {
    state = state.copyWith(isLoading: true);
    try {
      final OtpRequested requested = await _api.requestOtp(phone);
      state = state.copyWith(isLoading: false, otpRequested: requested);
    } on DioException catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<bool> verifyOtp(
      {required String phone,
      required String otp,
      String? referralCode}) async {
    state = state.copyWith(isLoading: true);
    try {
      final LoginResult result = await _api.verifyOtp(
        phone: phone,
        otp: otp,
        registrationToken: state.registrationToken,
        referralCode: referralCode,
      );
      await _tokenStorage.saveTokens(
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      );
      state = state.copyWith(
        status: AuthStatus.authenticated,
        isLoading: false,
        user: result.user,
      );
      return true;
    } on DioException catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
      return false;
    }
  }

  /// Returns true when the user is fully signed in. A `PHONE_REQUIRED` result
  /// is not a failure — it stores the registration token and expects the caller
  /// to collect a phone number and run the OTP flow.
  Future<bool> signInWithGoogle(String idToken) async {
    state = state.copyWith(isLoading: true);
    try {
      final GoogleSignInResult result = await _api.signInWithGoogle(idToken);
      switch (result) {
        case GoogleAuthenticated(:final LoginResult login):
          await _tokenStorage.saveTokens(
            accessToken: login.accessToken,
            refreshToken: login.refreshToken,
          );
          state = state.copyWith(
            status: AuthStatus.authenticated,
            isLoading: false,
            user: login.user,
          );
          return true;
        case GooglePhoneRequired(:final String registrationToken):
          state = state.copyWith(
              isLoading: false, registrationToken: registrationToken);
          return false;
      }
    } on DioException catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<void> logout() async {
    final String? refreshToken = await _tokenStorage.readRefreshToken();
    if (refreshToken != null) {
      try {
        await _api.logout(refreshToken);
      } on DioException {
        // Tokens are cleared locally regardless — a failed revoke must not
        // strand the user in a session they asked to end.
      }
    }
    await _tokenStorage.clear();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
