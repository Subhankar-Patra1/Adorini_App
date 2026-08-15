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

/// Seconds the server says to wait before retrying, or null when the failure
/// was not a rate limit.
///
/// The backend sends this alongside the sentence for `OTP_COOLDOWN` and the
/// COD resend, so a countdown can be driven from the real remaining window
/// instead of scraping the digits back out of the message — which would break
/// the moment anyone rewords it.
int? apiRetryAfterSeconds(DioException e) {
  final Object? data = e.response?.data;
  if (data is Map<String, dynamic>) {
    final Object? seconds = data['retryAfterSeconds'];
    if (seconds is int) return seconds;
    if (seconds is num) return seconds.round();
  }
  return null;
}

/// [apiErrorMessage] for the untyped `Object error` that `AsyncValue.when`
/// and `FutureBuilder` hand back.
///
/// Exists because screens were interpolating that object straight into a
/// `Text`, which put strings like *"DioException [bad response]: … because the
/// response has a status code of 401 and RequestOptions.validateStatus was
/// configured to throw for this status code"* in front of shoppers. Anything
/// that is not a [DioException] is a bug rather than a condition the shopper
/// can act on, so it collapses to the generic sentence rather than leaking a
/// type name.
String friendlyErrorMessage(Object error) {
  if (error is DioException) return apiErrorMessage(error);
  return 'Something went wrong. Please try again.';
}
