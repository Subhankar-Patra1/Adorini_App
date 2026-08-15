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

    /// Set when a request was refused for being too soon — the server's own
    /// remaining cooldown, so the UI can count it down truthfully.
    this.retryAfterSeconds,
  });

  final AuthStatus status;
  final bool isLoading;
  final String? error;
  final PublicUser? user;
  final OtpRequested? otpRequested;
  final String? registrationToken;
  final int? retryAfterSeconds;

  bool get isAuthenticated => status == AuthStatus.authenticated;

  AuthState copyWith({
    AuthStatus? status,
    bool? isLoading,
    String? error,
    PublicUser? user,
    OtpRequested? otpRequested,
    String? registrationToken,
    int? retryAfterSeconds,
  }) {
    return AuthState(
      status: status ?? this.status,
      isLoading: isLoading ?? this.isLoading,
      // Deliberately not `??` — a new action clears the previous error.
      error: error,
      user: user ?? this.user,
      otpRequested: otpRequested ?? this.otpRequested,
      registrationToken: registrationToken ?? this.registrationToken,
      // Cleared alongside `error`, and for the same reason: it belongs to the
      // failure that produced it, so carrying it into the next action would
      // resurrect a cooldown the server has already let go of.
      retryAfterSeconds: retryAfterSeconds,
    );
  }
}
