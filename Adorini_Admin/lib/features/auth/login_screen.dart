import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_client.dart';
import '../../core/theme/app_typography.dart';
import '../products/add_product_screen.dart';
import '../products/admin_catalog_api.dart';
import 'auth_api.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Stage { enterPhone, enterOtp }

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _otpController = TextEditingController();

  _Stage _stage = _Stage.enterPhone;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    final String phone = _phoneController.text.trim();
    if (phone.isEmpty) {
      setState(() => _error = 'Enter a phone number.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final AuthApi authApi = AuthApi(ref.read(dioProvider));
      await authApi.requestOtp(phone);
      setState(() => _stage = _Stage.enterOtp);
    } on DioException catch (e) {
      setState(() => _error = _messageFrom(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyOtpAndCheckAdmin() async {
    final String phone = _phoneController.text.trim();
    final String otp = _otpController.text.trim();
    if (otp.isEmpty) {
      setState(() => _error = 'Enter the code.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final Dio dio = ref.read(dioProvider);
      final AuthApi authApi = AuthApi(dio);
      final LoginResult result = await authApi.verifyOtp(phone: phone, otp: otp);
      await ref
          .read(tokenStorageProvider)
          .saveTokens(accessToken: result.accessToken, refreshToken: result.refreshToken);

      // The API never tells a client whether an account is staff — the only
      // way to find out is to try an admin route and see whether it answers
      // 403. `AdminGuard` re-checks `is_admin` in Postgres on every request,
      // so this is also always up to date, unlike a cached flag would be.
      try {
        await AdminCatalogApi(dio).assertAdmin();
      } on DioException catch (e) {
        if (e.response?.statusCode == 403) {
          await ref.read(tokenStorageProvider).clear();
          setState(() {
            _error = 'This account is not an administrator.';
            _stage = _Stage.enterPhone;
            _otpController.clear();
          });
          return;
        }
        rethrow;
      }

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => const AddProductScreen()),
      );
    } on DioException catch (e) {
      setState(() => _error = _messageFrom(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _messageFrom(DioException e) {
    final dynamic data = e.response?.data;
    if (data is Map<String, dynamic> && data['message'] is String) {
      return data['message'] as String;
    }
    return e.message ?? 'Something went wrong.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text('Adorini Admin', style: AppTypography.headlineLgMobile),
                  const SizedBox(height: 24),
                  if (_stage == _Stage.enterPhone) ...<Widget>[
                    TextField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Phone number'),
                      onSubmitted: (_) => _requestOtp(),
                    ),
                  ] else ...<Widget>[
                    TextField(
                      controller: _otpController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'OTP code'),
                      onSubmitted: (_) => _verifyOtpAndCheckAdmin(),
                    ),
                  ],
                  if (_error != null) ...<Widget>[
                    const SizedBox(height: 12),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _busy
                        ? null
                        : (_stage == _Stage.enterPhone ? _requestOtp : _verifyOtpAndCheckAdmin),
                    child: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(_stage == _Stage.enterPhone ? 'Send code' : 'Verify'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
