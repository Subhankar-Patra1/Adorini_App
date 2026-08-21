import 'package:shared_preferences/shared_preferences.dart';

/// Persistence for the JWT access/refresh token pair.
///
/// Not `flutter_secure_storage`: its Android dependency chain kept
/// escalating its minimum SDK requirement, up to a preview SDK release that
/// doesn't resolve cleanly. This is a local, single-operator admin tool
/// rather than something holding third-party secrets, so plain local storage
/// is an acceptable trade for not fighting that ladder.
class TokenStorage {
  static const String _accessTokenKey = 'access_token';
  static const String _refreshTokenKey = 'refresh_token';

  Future<String?> readAccessToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    return prefs.getString(_accessTokenKey);
  }

  Future<String?> readRefreshToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    return prefs.getString(_refreshTokenKey);
  }

  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accessTokenKey, accessToken);
    await prefs.setString(_refreshTokenKey, refreshToken);
  }

  Future<void> clear() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessTokenKey);
    await prefs.remove(_refreshTokenKey);
  }
}
