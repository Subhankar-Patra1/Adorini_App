import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/auth_controller.dart';
import '../../domain/auth_state.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _otpController = TextEditingController();
  final TextEditingController _referralController = TextEditingController();
  bool _otpSent = false;
  bool _showReferralField = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    _referralController.dispose();
    super.dispose();
  }

  Future<void> _sendOtp() async {
    final String phone = _phoneController.text.trim();
    if (phone.isEmpty) return;
    await ref.read(authControllerProvider.notifier).requestOtp(phone);
    if (mounted && ref.read(authControllerProvider).error == null) {
      setState(() => _otpSent = true);
    }
  }

  Future<void> _verifyOtp() async {
    final String otp = _otpController.text.trim();
    if (otp.length != 6) return;

    final bool success = await ref.read(authControllerProvider.notifier).verifyOtp(
          phone: _phoneController.text.trim(),
          otp: otp,
          // Referrals attach only at account creation — the code must ride
          // along with this request or it is lost for good.
          referralCode: _referralController.text.trim().isEmpty
              ? null
              : _referralController.text.trim(),
        );
    if (success && mounted) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    final AuthState auth = ref.watch(authControllerProvider);

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.containerMargin),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const SizedBox(height: AppSpacing.xl),
              Text('Adorini', style: AppTypography.displayLg),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Sign in to shop ethnic wear crafted for you.',
                style: AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.xl),

              TextField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                enabled: !_otpSent,
                decoration: const InputDecoration(
                  labelText: 'Phone number',
                  hintText: '+91 98765 43210',
                ),
              ),

              if (_otpSent) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                TextField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: 'Enter the 6-digit code'),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () => setState(() {
                      _otpSent = false;
                      _otpController.clear();
                    }),
                    child: const Text('Change number'),
                  ),
                ),

                if (!_showReferralField)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () => setState(() => _showReferralField = true),
                      child: const Text('Have a referral code?'),
                    ),
                  )
                else
                  TextField(
                    controller: _referralController,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'Referral code'),
                  ),
              ],

              if (auth.error != null) ...<Widget>[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  auth.error!,
                  style: AppTypography.bodyMd
                      .copyWith(color: Theme.of(context).colorScheme.error),
                ),
              ],

              const SizedBox(height: AppSpacing.lg),
              ElevatedButton(
                onPressed: auth.isLoading ? null : (_otpSent ? _verifyOtp : _sendOtp),
                child: Text(
                  auth.isLoading
                      ? 'PLEASE WAIT…'
                      : (_otpSent ? 'VERIFY & CONTINUE' : 'SEND CODE'),
                ),
              ),

              const SizedBox(height: AppSpacing.md),
              OutlinedButton(
                // Google Sign-In needs a platform SDK to mint the idToken that
                // `AuthController.signInWithGoogle` expects; the plugin and
                // OAuth client are not configured in this build yet.
                onPressed: null,
                child: const Text('CONTINUE WITH GOOGLE'),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Google sign-in coming soon.',
                textAlign: TextAlign.center,
                style: AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
              ),

              const SizedBox(height: AppSpacing.lg),
              const Divider(),
              const SizedBox(height: AppSpacing.sm),
              FilledButton.tonalIcon(
                onPressed: () async {
                  await ref.read(authControllerProvider.notifier).bypassAuthForTesting();
                  if (mounted) context.go('/home');
                },
                icon: const Icon(Icons.flash_on),
                label: const Text('⚡ SKIP / TEST MODE (BYPASS AUTH)'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
