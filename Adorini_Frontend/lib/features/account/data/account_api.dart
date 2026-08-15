import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:http_parser/http_parser.dart';

import '../../../core/constants/api_constants.dart';
import '../../auth/data/auth_api.dart';

/// `/users/me` returns the same `publicUserSchema` shape as sign-in, so
/// [PublicUser] is reused rather than duplicated.
class AccountApi {
  AccountApi(this._dio);

  final Dio _dio;

  Future<PublicUser> getProfile() async {
    final Response<Map<String, dynamic>> response =
        await _dio.get<Map<String, dynamic>>(ApiConstants.me);
    return PublicUser.fromJson(response.data!);
  }

  /// Phone is deliberately not editable here — changing it is an OTP-verified
  /// flow. Nullable fields accept `null` to clear a previously set value, so
  /// keys are only omitted when the caller does not intend a change.
  Future<PublicUser> updateProfile({
    String? fullName,
    String? email,
    String? gender,
    bool clearEmail = false,
  }) async {
    final Response<Map<String, dynamic>> response =
        await _dio.patch<Map<String, dynamic>>(
      ApiConstants.me,
      data: <String, dynamic>{
        if (fullName != null) 'fullName': fullName,
        if (clearEmail) 'email': null else if (email != null) 'email': email,
        if (gender != null) 'gender': gender,
      },
    );
    return PublicUser.fromJson(response.data!);
  }

  Future<PublicUser> uploadAvatar({
    required Uint8List bytes,
    required String filename,
    required String mimeType,
  }) async {
    final Response<Map<String, dynamic>> response =
        await _dio.post<Map<String, dynamic>>(
      ApiConstants.avatar,
      data: FormData.fromMap(<String, dynamic>{
        'avatar': MultipartFile.fromBytes(
          bytes,
          filename: filename,
          contentType: MediaType.parse(mimeType),
        ),
      }),
    );
    return PublicUser.fromJson(response.data!);
  }
}
