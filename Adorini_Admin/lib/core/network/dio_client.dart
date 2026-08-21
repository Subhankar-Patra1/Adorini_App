import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constants/api_constants.dart';
import '../storage/token_storage.dart';

final Provider<TokenStorage> tokenStorageProvider = Provider<TokenStorage>(
  (Ref ref) => TokenStorage(),
);

final Provider<Dio> dioProvider = Provider<Dio>((Ref ref) {
  final TokenStorage tokenStorage = ref.watch(tokenStorageProvider);
  return DioClient(tokenStorage).dio;
});

/// Wraps a [Dio] instance with auth-header injection and a single
/// retry-after-refresh on 401, matching Adorini_Backend's JwtAuthGuard —
/// same contract the buyer app's `DioClient` relies on.
class DioClient {
  DioClient(this._tokenStorage) {
    _dio = Dio(
      BaseOptions(
        baseUrl: ApiConstants.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (RequestOptions options, RequestInterceptorHandler handler) async {
          final String? token = await _tokenStorage.readAccessToken();
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (DioException error, ErrorInterceptorHandler handler) async {
          final bool isUnauthorized = error.response?.statusCode == 401;
          final bool alreadyRetried = error.requestOptions.extra['retried'] == true;

          if (isUnauthorized && !alreadyRetried) {
            final bool refreshed = await _refreshToken();
            if (refreshed) {
              final RequestOptions retryRequest = error.requestOptions
                ..extra['retried'] = true;
              try {
                final Response<dynamic> response = await _dio.fetch(retryRequest);
                return handler.resolve(response);
              } on DioException catch (retryError) {
                return handler.next(retryError);
              }
            }
            await _tokenStorage.clear();
          }
          handler.next(error);
        },
      ),
    );
  }

  final TokenStorage _tokenStorage;
  late final Dio _dio;

  Dio get dio => _dio;

  Future<bool> _refreshToken() async {
    final String? refreshToken = await _tokenStorage.readRefreshToken();
    if (refreshToken == null) return false;

    try {
      final Dio refreshDio = Dio(BaseOptions(baseUrl: ApiConstants.baseUrl));
      final Response<Map<String, dynamic>> response = await refreshDio.post<Map<String, dynamic>>(
        ApiConstants.refresh,
        data: <String, String>{'refreshToken': refreshToken},
      );

      final String? newAccessToken = response.data?['accessToken'] as String?;
      final String? newRefreshToken = response.data?['refreshToken'] as String?;
      if (newAccessToken == null || newRefreshToken == null) return false;

      await _tokenStorage.saveTokens(accessToken: newAccessToken, refreshToken: newRefreshToken);
      return true;
    } on DioException {
      return false;
    }
  }
}
