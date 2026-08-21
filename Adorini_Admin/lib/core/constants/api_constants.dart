class ApiConstants {
  const ApiConstants._();

  /// Same `--dart-define-from-file=env/local.json` pattern as the buyer app.
  /// A physical Android device can't reach this PC's `localhost` directly —
  /// `adb reverse tcp:3000 tcp:3000` over USB is what makes `localhost:3000`
  /// on the phone actually hit this machine. Switch to the PC's LAN IP if
  /// running over Wi-Fi instead of USB.
  static String get baseUrl {
    const String envUrl = String.fromEnvironment('API_BASE_URL');
    return envUrl.isNotEmpty ? envUrl : 'http://localhost:3000/api';
  }

  // ---- auth (same phone-OTP flow every buyer uses — there is no separate
  // admin login) ----
  static const String otpRequest = '/auth/otp/request';
  static const String otpVerify = '/auth/otp/verify';
  static const String refresh = '/auth/refresh';

  // ---- admin ----
  static const String adminCategories = '/admin/categories';
  static const String adminBrands = '/admin/brands';
  static const String adminProducts = '/admin/products';
  static String adminVariants = '/admin/variants';
  static String adminProductMedia(String productId) => '/admin/products/$productId/media';
}
