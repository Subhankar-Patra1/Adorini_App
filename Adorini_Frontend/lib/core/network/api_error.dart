import 'package:dio/dio.dart';

/// Turns a [DioException] into something worth showing a shopper.
///
/// The backend returns Nest's standard error envelope — `{ message, code? }`,
/// where `message` may be a string or an array of Zod validation strings.
/// Falling back to `e.toString()` would surface a stack-trace-shaped string in
/// the UI, so every branch here ends at a human sentence.
String apiErrorMessage(DioException e) {
  final Object? data = e.response?.data;

  if (data is Map<String, dynamic>) {
    final Object? message = data['message'];
    if (message is String && message.isNotEmpty) return message;
    if (message is List && message.isNotEmpty) return message.first.toString();
  }

  return switch (e.type) {
    DioExceptionType.connectionTimeout ||
    DioExceptionType.sendTimeout ||
    DioExceptionType.receiveTimeout =>
      'The connection timed out. Please try again.',
    DioExceptionType.connectionError => 'No internet connection.',
    _ => 'Something went wrong. Please try again.',
  };
}
