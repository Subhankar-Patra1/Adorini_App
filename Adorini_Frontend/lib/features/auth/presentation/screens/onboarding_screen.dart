import 'dart:async';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../domain/auth_controller.dart';
import '../../domain/auth_state.dart';

/// Sign-in.
///
/// **One flow, no Login/Sign Up tabs.** The backend cannot tell the client
/// whether a number belongs to an existing account: `/auth/otp/request`
/// answers with an identical 202 either way, on purpose, so nobody can probe
/// which phone numbers are customers. Whether this turns out to be a sign-in
/// or a sign-up is only known from `isNewUser` in the *verify* response — so
/// tabs asking the shopper to pick up front would be asking a question the
/// app cannot honour, on top of being extra friction.
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
  void initState() {
    super.initState();
    _phoneController.addListener(_onPhoneChanged);
  }

  @override
  void dispose() {
    _phoneController.removeListener(_onPhoneChanged);
    _phoneController.dispose();
    _otpController.dispose();
    _referralController.dispose();
    super.dispose();
  }

  void _onPhoneChanged() {
    if (mounted) setState(() {});
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
    final double keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    // Lift scaled off the inset and capped, rather than flipped by a
    // threshold. The cap keeps the Adorini tagline visible above the card.
    //
    // A `keyboardInset > 48` threshold is not symmetric. Opening, the inset
    // climbs past 48 almost immediately, so the card leaves on time. Closing,
    // it only falls back through 48 at the very *end* of the IME's slide — so
    // the card hung in place and then dropped once the keyboard had already
    // gone, which is the trailing delay. Scaling off the inset makes both
    // directions finish together: the lift reaches 0 exactly when the
    // keyboard does.
    //
    // The lift saturates before the keyboard finishes opening, so the card
    // leads rather than looking dragged along behind it.
    //
    // Eased rather than a bare clamp: a linear ramp travels at a constant
    // speed and then stops dead the moment it hits the cap, and that sudden
    // halt is what stops the rise feeling smooth. easeOutCubic decelerates
    // into the raised position, so there is no hard edge at the top.
    //
    // No Timer, no setState — `build` already re-runs as the inset changes.
    const double liftSaturatesAtInset = 170;
    const double maxLift = 100;
    final double liftProgress = (keyboardInset / liftSaturatesAtInset).clamp(0.0, 1.0);
    final double keyboardLift = maxLift * Curves.easeOutCubic.transform(liftProgress);

    return Scaffold(
      backgroundColor: AppColors.surface,
      // Keep the branded composition stable when the IME opens. The keyboard
      // should overlay the lower edge instead of causing the login card to
      // re-layout and shrink.
      resizeToAvoidBottomInset: false,
      body: Stack(
        children: <Widget>[
          const Positioned.fill(child: _FashionBackdrop()),
          SafeArea(
            child: Column(
              children: <Widget>[
                _TopBar(onSkip: () => context.go('/home')),
                Expanded(
                  child: LayoutBuilder(
                    builder: (BuildContext context, BoxConstraints constraints) {
                      final bool compact = constraints.maxHeight < 760;
                      final Widget authCard = _AuthCard(
                        auth: auth,
                        otpSent: _otpSent,
                        showReferralField: _showReferralField,
                        phoneController: _phoneController,
                        otpController: _otpController,
                        referralController: _referralController,
                        onSubmit: _otpSent ? _verifyOtp : _sendOtp,
                        onChangeNumber: () => setState(() {
                          _otpSent = false;
                          _otpController.clear();
                        }),
                        onRevealReferral: () => setState(() => _showReferralField = true),
                        onGoogle: () => _showGoogleUnavailable(context),
                        canContinue: _otpSent || _phoneController.text.trim().length == 10,
                      );

                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 18),
                        child: Column(
                          children: <Widget>[
                            SizedBox(height: compact ? 4 : 12),
                            const _Wordmark(),
                            Expanded(
                              // A plain Transform, NOT an AnimatedContainer.
                              //
                              // `keyboardLift` already changes every frame,
                              // tracking the IME inset, and is eased where it
                              // is computed. An implicit animation on top of a
                              // value that moves every frame restarts its tween
                              // on every single build: the card ends up forever
                              // chasing a target it never reaches, then drifts
                              // in late once the keyboard settles. That
                              // rubber-banding is the bounce — the animation
                              // was causing it, not smoothing it.
                              child: Transform.translate(
                                offset: Offset(0, -keyboardLift),
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.bottomCenter,
                                  child: SizedBox(
                                    width: constraints.maxWidth - 36,
                                    child: authCard,
                                  ),
                                ),
                              ),
                            ),
                            if (!compact) ...<Widget>[
                              const SizedBox(height: 12),
                              const _TrustBenefits(),
                            ],
                            if (kDebugMode && !compact) ...<Widget>[
                              const SizedBox(height: 4),
                              _DebugBypassButton(onDone: () => context.go('/home')),
                            ],
                            const SizedBox(height: 8),
                          ],
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showGoogleUnavailable(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Google sign-in will be available soon.')),
    );
  }
}

class _FashionBackdrop extends StatelessWidget {
  const _FashionBackdrop();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/onboarding_fashion_collage.png',
      fit: BoxFit.cover,
      alignment: Alignment.topCenter,
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onSkip});

  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: 14,
        vertical: 8,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: <Widget>[
          TextButton(
            onPressed: onSkip,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  'Skip',
                  style: AppTypography.bodyMd.copyWith(
                    color: const Color(0xFF8C173A),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: AppSpacing.xs),
                const Icon(Icons.arrow_forward, size: 20, color: Color(0xFF8C173A)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        const Text(
          'A',
          style: TextStyle(
            fontFamily: 'serif',
            fontSize: 76,
            height: 0.78,
            color: Color(0xFF9D1646),
            fontWeight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'ADORINI',
          style: AppTypography.displayLg.copyWith(
            fontSize: 36,
            fontWeight: FontWeight.w400,
            letterSpacing: 6,
            color: const Color(0xFF2A1115),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'STYLE THAT SPEAKS YOU',
          style: AppTypography.labelBold.copyWith(
            fontSize: 11,
            letterSpacing: 2.5,
            color: const Color(0xFF8C173A),
          ),
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(width: 42, height: 1, color: const Color(0xFF8C173A)),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 10),
              child: Icon(Icons.local_florist, size: 15, color: Color(0xFF8C173A)),
            ),
            Container(width: 42, height: 1, color: const Color(0xFF8C173A)),
          ],
        ),
      ],
    );
  }
}

class _AuthCard extends StatelessWidget {
  const _AuthCard({
    required this.auth,
    required this.otpSent,
    required this.showReferralField,
    required this.phoneController,
    required this.otpController,
    required this.referralController,
    required this.onSubmit,
    required this.onChangeNumber,
    required this.onRevealReferral,
    required this.onGoogle,
    required this.canContinue,
  });

  final AuthState auth;
  final bool otpSent;
  final bool showReferralField;
  final TextEditingController phoneController;
  final TextEditingController otpController;
  final TextEditingController referralController;
  final Future<void> Function() onSubmit;
  final VoidCallback onChangeNumber;
  final VoidCallback onRevealReferral;
  final VoidCallback onGoogle;
  final bool canContinue;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFCFB).withValues(alpha: 0.97),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.9)),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: const Color(0xFF5C1428).withValues(alpha: 0.14),
            blurRadius: 26,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Transform.translate(
            offset: const Offset(0, -4),
            child: Text(
              otpSent ? 'Enter the code' : 'Welcome to Adorini',
              textAlign: TextAlign.center,
              style: AppTypography.titleMd.copyWith(
                fontSize: 23,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF211517),
              ),
            ),
          ),
          const SizedBox(height: 2),
          if (otpSent) ...<Widget>[
            Text(
              'We sent a 6-digit code to +91 ${phoneController.text.trim()}',
              textAlign: TextAlign.center,
              style: AppTypography.bodyMd.copyWith(
                fontSize: 14,
                color: const Color(0xFF5D5352),
              ),
            ),
            const SizedBox(height: 10),
          ],

          if (!otpSent)
            _PhoneField(controller: phoneController)
          else ...<Widget>[
            _OtpField(controller: otpController),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: onChangeNumber,
                style: TextButton.styleFrom(padding: EdgeInsets.zero),
                child: const Text('Change number'),
              ),
            ),
            if (!showReferralField)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: onRevealReferral,
                  style: TextButton.styleFrom(padding: EdgeInsets.zero),
                  child: const Text('Have a referral code?'),
                ),
              )
            else ...<Widget>[
              const SizedBox(height: AppSpacing.base),
              TextField(
                controller: referralController,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Referral code'),
              ),
            ],
          ],

          if (auth.error != null) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Icon(Icons.error_outline, size: 16, color: AppColors.error),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    auth.error!,
                    style: AppTypography.bodyMd
                        .copyWith(fontSize: 13, color: AppColors.error),
                  ),
                ),
              ],
            ),
          ],

          const SizedBox(height: 10),
          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: auth.isLoading || !canContinue ? null : () => onSubmit(),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFA81746),
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFA81746).withValues(alpha: 0.38),
                disabledForegroundColor: Colors.white.withValues(alpha: 0.85),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                elevation: 0,
              ),
              child: auth.isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      // onSurface, not white: the app's ElevatedButton theme
                      // fills with the peach primaryContainer, so a white
                      // spinner is all but invisible on it.
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                      color: Colors.white,
                      ),
                    )
                  : Text(otpSent ? 'VERIFY & CONTINUE' : 'CONTINUE'),
            ),
          ),

          if (!otpSent)
            Column(
              children: <Widget>[
                  const SizedBox(height: 10),
                  Row(
                    children: <Widget>[
                      const Expanded(child: Divider(color: Color(0xFFE6D9D8))),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Text('or continue with', style: AppTypography.bodyMd.copyWith(fontSize: 13)),
                      ),
                      const Expanded(child: Divider(color: Color(0xFFE6D9D8))),
                    ],
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: onGoogle,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.onSurface,
                      side: const BorderSide(color: Color(0xFFE6D9D8)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      minimumSize: const Size.fromHeight(44),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        const Text('G', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: Color(0xFF4285F4))),
                        const SizedBox(width: 12),
                        Text('Continue with Google', style: AppTypography.bodyMd.copyWith(fontSize: 14, fontWeight: FontWeight.w500)),
                      ],
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Icon(Icons.verified_user_outlined, size: 20, color: Color(0xFFA81746)),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  'Your data is 100% secure with us',
                  textAlign: TextAlign.center,
                  style: AppTypography.bodyMd.copyWith(fontSize: 13, color: AppColors.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TrustBenefits extends StatelessWidget {
  const _TrustBenefits();

  @override
  Widget build(BuildContext context) {
    const Color accent = Color(0xFF8C173A);
    final List<(IconData, String)> benefits = <(IconData, String)>[
      (Icons.shopping_bag_outlined, 'Trendy Collection'),
      (Icons.verified_user_outlined, 'Secure Payments'),
      (Icons.inventory_2_outlined, 'Easy Returns'),
    ];

    return Row(
      children: <Widget>[
        for (int index = 0; index < benefits.length; index++) ...<Widget>[
          if (index > 0) const SizedBox(width: 8),
          Expanded(
            child: Column(
              children: <Widget>[
                Icon(benefits[index].$1, color: accent, size: 24),
                const SizedBox(height: 5),
                Text(
                  benefits[index].$2,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.bodyMd.copyWith(fontSize: 11, color: const Color(0xFF3B282B)),
                ),
              ],
            ),
          ),
          if (index < benefits.length - 1)
            Container(width: 1, height: 32, color: const Color(0xFFE2C9CF)),
        ],
      ],
    );
  }
}

/// Phone entry with a fixed +91 affix.
///
/// The country code is display-only rather than a picker: the backend
/// normalises to India and every DLT-registered SMS template is Indian, so a
/// picker offering countries that cannot receive the code would be a trap.
class _PhoneField extends StatelessWidget {
  const _PhoneField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(999),
      ),
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.outlineVariant),
      ),
      child: Row(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              '+91',
              style: AppTypography.bodyLg.copyWith(
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Container(width: 1, height: 26, color: AppColors.outlineVariant),
          Expanded(
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.phone,
              autofocus: false,
              maxLength: 10,
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
              ],
              style: AppTypography.bodyLg.copyWith(fontSize: 16, letterSpacing: 1.2),
              decoration: const InputDecoration(
                hintText: 'Enter your mobile number',
                hintStyle: TextStyle(
                  fontSize: 14,
                  letterSpacing: 0,
                  color: AppColors.onSurfaceVariant,
                ),
                counterText: '',
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 10,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OtpField extends StatelessWidget {
  const _OtpField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      maxLength: 6,
      autofocus: true,
      textAlign: TextAlign.center,
      inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
      style: AppTypography.displayLg.copyWith(
        fontSize: 26,
        letterSpacing: 12,
        fontWeight: FontWeight.w500,
      ),
      decoration: const InputDecoration(
        counterText: '',
        hintText: '······',
      ),
    );
  }
}

/// Debug-only. The token it stores is a placeholder string, so the backend's
/// JwtAuthGuard rejects it and every authenticated call 401s — it only
/// unlocks navigation for UI work. `kDebugMode` keeps it out of release
/// builds, where a visible "bypass auth" control has no business being.
class _DebugBypassButton extends ConsumerWidget {
  const _DebugBypassButton({required this.onDone});

  final VoidCallback onDone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return TextButton.icon(
      onPressed: () async {
        await ref.read(authControllerProvider.notifier).bypassAuthForTesting();
        onDone();
      },
      icon: const Icon(Icons.flash_on, size: 16),
      // Short on purpose: TextButton.icon lays its label out in an unbounded
      // Row, so a longer string overflows on narrow screens.
      label: const Text('SKIP — DEV MODE'),
    );
  }
}
