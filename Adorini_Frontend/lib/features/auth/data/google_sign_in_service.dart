import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../../core/constants/google_auth_constants.dart';

final Provider<GoogleSignInService> googleSignInServiceProvider =
    Provider<GoogleSignInService>((Ref ref) => GoogleSignInService());

/// Raised when Google is reachable but cannot be used here — a misconfigured
/// client, an unsupported platform, or a token with no `idToken`. Carries a
/// sentence fit to show a shopper; the plugin's own messages are not.
class GoogleSignInUnavailable implements Exception {
  const GoogleSignInUnavailable(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Obtains a Google ID token for the backend to verify.
///
/// This layer deliberately stops at the token. It does not touch
/// `TokenStorage` or `AuthState` — `/auth/google` is what decides whether the
/// account exists, and `AuthController.signInWithGoogle` owns everything after
/// that. Anything here that also wrote session state would create a second,
/// competing source of truth about who is signed in.
class GoogleSignInService {
  Future<void>? _initialization;

  bool get _isIOS => !kIsWeb && Platform.isIOS;

  /// `initialize()` must complete before `authenticate()`, and it is safe to
  /// await the same future repeatedly — so the first caller starts it and every
  /// later caller reuses it. Doing this lazily rather than in `main()` keeps a
  /// slow platform channel off the cold-start path: nobody waits for Google
  /// before seeing the first frame.
  Future<void> _ensureInitialized() {
    return _initialization ??= GoogleSignIn.instance.initialize(
      serverClientId: GoogleAuthConstants.serverClientId,
      // Android must not receive this — it derives its client from the package
      // name and SHA-1 registered with Google, and passing an iOS client here
      // is rejected as a configuration error.
      clientId: _isIOS ? GoogleAuthConstants.iosClientId : null,
    );
  }

  /// Runs the Google account picker and returns the resulting ID token.
  ///
  /// Returns `null` when the shopper dismissed the sheet. That is not a
  /// failure and must not surface as an error message — they closed a dialog.
  ///
  /// Throws [GoogleSignInUnavailable] for anything a shopper can act on.
  Future<String?> signIn() async {
    if (!GoogleAuthConstants.isConfiguredFor(isIOS: _isIOS)) {
      throw const GoogleSignInUnavailable(
        'Google sign-in is not configured for this platform yet.',
      );
    }

    await _ensureInitialized();

    // False on web, where Google requires a rendered button rather than a
    // programmatic call. Asked rather than assumed so the failure is a sentence
    // instead of a platform exception.
    if (!GoogleSignIn.instance.supportsAuthenticate()) {
      throw const GoogleSignInUnavailable(
        'Google sign-in is not supported on this platform.',
      );
    }

    final GoogleSignInAccount account;
    try {
      account = await GoogleSignIn.instance.authenticate();
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) return null;
      throw GoogleSignInUnavailable(_describe(e));
    }

    final String? idToken = account.authentication.idToken;
    if (idToken == null) {
      // Almost always a missing or wrong `serverClientId`: without a web client
      // to name as the audience, Google returns an access token and no ID
      // token at all. Worth saying plainly — the symptom otherwise reads as a
      // backend rejection.
      throw const GoogleSignInUnavailable(
        'Google did not return an ID token. Check that the server client ID '
        'matches the backend configuration.',
      );
    }
    return idToken;
  }

  /// Clears the cached Google account so the next sign-in shows the picker
  /// again. Called on logout; a shopper who signs out and back in expects to be
  /// able to choose a different account.
  Future<void> signOut() async {
    if (_initialization == null) return;
    await GoogleSignIn.instance.signOut();
  }

  String _describe(GoogleSignInException e) {
    return switch (e.code) {
      GoogleSignInExceptionCode.clientConfigurationError =>
        'Google sign-in is misconfigured for this build '
            '(${e.description ?? 'no details'}).',
      GoogleSignInExceptionCode.interrupted ||
      GoogleSignInExceptionCode.canceled =>
        'Google sign-in was interrupted. Please try again.',
      _ => 'Google sign-in failed. Please try again or use your phone number.',
    };
  }
}
