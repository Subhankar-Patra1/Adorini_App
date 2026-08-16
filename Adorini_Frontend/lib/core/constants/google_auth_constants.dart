/// Google OAuth client IDs for the Cloud project "adorini".
///
/// These are **not secrets**. A native OAuth client cannot hold one — anyone
/// can unpack the APK — which is why Google issues Android clients without a
/// secret and identifies them by package name + SHA-1 fingerprint instead. They
/// are hard-coded here rather than passed through `env/local.json` because,
/// unlike `API_BASE_URL`, they are the same on every developer's machine.
class GoogleAuthConstants {
  const GoogleAuthConstants._();

  /// The **web** client ID, passed as `serverClientId`.
  ///
  /// Counter-intuitive but load-bearing: it is not a login mechanism and no
  /// browser flow uses it. Setting it makes Google mint the ID token with this
  /// value as its `aud` claim, which is exactly what the backend's `OAuthService`
  /// asserts before trusting the token. Omit it and two things break — the
  /// token arrives with `idToken == null` on Android, and even if it did not,
  /// the backend would reject the audience.
  ///
  /// Must stay identical to `GOOGLE_OAUTH_CLIENT_ID` in the backend's `.env`.
  ///
  /// Overridable at build time for a staging project:
  /// `--dart-define=GOOGLE_SERVER_CLIENT_ID=...`
  static const String serverClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue:
        '225983796499-faittsafsu894dd423jgs0uq0pi7vv37.apps.googleusercontent.com',
  );

  /// The **iOS** client ID.
  ///
  /// TODO: create the iOS OAuth client (bundle id `com.adorini.app`) and paste
  /// it here, along with its reversed form as a `CFBundleURLTypes` entry in
  /// `ios/Runner/Info.plist`. Android does not use this value at all, so an
  /// empty string here is harmless on Android and only blocks iOS sign-in.
  static const String iosClientId = String.fromEnvironment(
    'GOOGLE_IOS_CLIENT_ID',
    defaultValue: '',
  );

  /// Whether sign-in can be attempted on the current platform.
  ///
  /// Android needs only [serverClientId]; iOS additionally needs its own
  /// client. Checked so the button can explain itself instead of throwing an
  /// opaque platform exception.
  static bool isConfiguredFor({required bool isIOS}) =>
      serverClientId.isNotEmpty && (!isIOS || iosClientId.isNotEmpty);
}
