import '../data/auth_api.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.isLoading = false,
    this.error,
    this.user,
    this.otpRequested,
    /// Set when Google sign-in returned PHONE_REQUIRED — carry it into the OTP
    /// verify call to finish creating the account.
    this.registrationToken,
  });

  final AuthStatus status;
  final bool isLoading;
  final String? error;
  final PublicUser? user;
  final OtpRequested? otpRequested;
  final String? registrationToken;

  bool get isAuthenticated => status == AuthStatus.authenticated;

  AuthState copyWith({
    AuthStatus? status,
    bool? isLoading,
    String? error,
    PublicUser? user,
    OtpRequested? otpRequested,
    String? registrationToken,
  }) {
    return AuthState(
      status: status ?? this.status,
      isLoading: isLoading ?? this.isLoading,
      // Deliberately not `??` — a new action clears the previous error.
      error: error,
      user: user ?? this.user,
      otpRequested: otpRequested ?? this.otpRequested,
      registrationToken: registrationToken ?? this.registrationToken,
    );
  }
}
