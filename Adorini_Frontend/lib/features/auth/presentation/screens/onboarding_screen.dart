import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
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

    final bool success =
        await ref.read(authControllerProvider.notifier).verifyOtp(
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
    final double liftProgress =
        (keyboardInset / liftSaturatesAtInset).clamp(0.0, 1.0);
    final double keyboardLift =
        maxLift * Curves.easeOutCubic.transform(liftProgress);
    // Constant nudge off the bottom edge, on top of the keyboard-driven lift
    // above. Deliberately small: this is reserved as padding, so every point
    // here is a point the card cannot use, and the card is the thing that
    // should be big.
    const double restingLift = 12;

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
                    builder:
                        (BuildContext context, BoxConstraints constraints) {
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
                        onRevealReferral: () =>
                            setState(() => _showReferralField = true),
                        onGoogle: () => _showGoogleUnavailable(context),
                        canContinue: _otpSent ||
                            _phoneController.text.trim().length == 10,
                      );

                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Column(
                          children: <Widget>[
                            SizedBox(height: compact ? 2 : 6),
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
                              // The resting lift is padding, not a transform.
                              // `Transform.translate` only moves paint, so a
                              // 28pt lift drew the card over the slogan, which
                              // has 14pt beneath it — the text was still laid
                              // out, just hidden under the card. Reserving the
                              // space instead shortens the box the group is
                              // centred in, raising it by half the padding
                              // without overlapping anything above.
                              child: Padding(
                                padding: const EdgeInsets.only(
                                    bottom: restingLift * 2),
                                child: Transform.translate(
                                  // Keyboard-driven lift only. This one must stay
                                  // a transform: it changes every frame with the
                                  // IME inset, and relayout at that rate is what
                                  // made the card judder.
                                  offset: Offset(0, -keyboardLift),
                                  // Centred, not bottom-aligned, and carrying the
                                  // trust row with it. Bottom-aligning pinned the
                                  // card to the floor while the wordmark held the
                                  // ceiling, so every spare pixel pooled into one
                                  // dead band across the middle of the screen.
                                  // Centring splits that slack above and below.
                                  child: FittedBox(
                                    fit: BoxFit.scaleDown,
                                    alignment: Alignment.center,
                                    child: SizedBox(
                                      width: constraints.maxWidth - 24,
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: <Widget>[
                                          authCard,
                                          const SizedBox(height: 14),
                                          // Previously gated behind `!compact`,
                                          // which silently dropped it on exactly
                                          // the short screens whose empty middle
                                          // it was best placed to fill. Inside
                                          // the FittedBox it scales down instead
                                          // of disappearing.
                                          const _TrustBenefits(),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 4),
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
    // WebP, not PNG: the same 941x1672 collage was a 2.04 MB PNG, which is
    // ~11x the WebP at a PSNR of 40 dB — no visible difference, on the first
    // screen of a cold start.
    return Image.asset(
      'assets/images/onboarding_fashion_collage.webp',
      fit: BoxFit.cover,
      // Shifted left. The collage is proportionally wider than the screen, so
      // `cover` scales it to the height and crops the sides — moving the
      // alignment toward the right edge pulls the visible content left,
      // because it is the right of the source that is being brought into view.
      // At this screen size the ~85pt of horizontal overflow makes x: 0.6
      // worth roughly 25pt of travel; x: 1 would be the crop's hard limit.
      alignment: const Alignment(0.6, -1),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onSkip});

  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Asymmetric on purpose: extra padding on the right pulls Skip inward,
      // off the florals that the shifted backdrop brought into the corner.
      padding: const EdgeInsets.only(
        left: 14,
        right: 32,
        top: 8,
        bottom: 8,
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
                const Icon(Icons.arrow_forward,
                    size: 20, color: Color(0xFF8C173A)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The brand lockup: the emblem above the script wordmark.
///
/// Both are the real brand vectors rather than type set to look like them —
/// the previous version drew a bare 'A' in the platform serif and letterspaced
/// the name, which matched neither the emblem nor the script logotype.
///
/// The emblem comes from `assets/images/logo.svg`.
///
/// That file shipped with its artwork padded into a 3090x2160 frame — the ink
/// filled only 39.6% of the height and sat high in it, so at any given height
/// it drew a small mark with a large dead gap beneath. Its viewBox is now
/// trimmed to the artwork's measured bounds (plus 3%), so the height set here
/// is the height you actually see. Path data is untouched.
///
/// The source fill is irrelevant: `srcIn` replaces it with the brand ink.
class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Transform.translate(
          offset: const Offset(4, 0),
          child: SvgPicture.asset(
            'assets/images/logo.svg',
            height: 118,
            // Tinted to the brand ink so the emblem and the wordmark below it
            // sit at the same weight.
            colorFilter:
                const ColorFilter.mode(Color(0xFF2A1115), BlendMode.srcIn),
            // The pair announces once, on the emblem. Labelling the wordmark
            // too would read the brand name twice; unlabelled, it stays
            // decorative.
            semanticsLabel: 'Adorini',
          ),
        ),
        const SizedBox(height: 2),
        // Optically centred, not just geometrically. Both marks sit dead centre
        // by bounding box, but their ink does not: the script's centre of mass
        // is 1.8% right of its box (the trailing flourish and the flower over
        // the 'ni'), while the emblem's is 0.9% left. Left unadjusted the two
        // disagree by ~4px and the pair reads as off-axis. The emblem's own
        // ~1px correction is below the perceptual threshold, so only the
        // wordmark is nudged.
        Transform.translate(
          offset: const Offset(-4, 0),
          child: SvgPicture.asset(
            'assets/images/wordmark.svg',
            // Trimmed from 104. Its ink fills only ~76% of the box, so it
            // gives back real height for less apparent size loss than the
            // emblem would — and the height freed here is what lets the card
            // grow instead of being scaled back down by the FittedBox.
            height: 92,
            colorFilter:
                const ColorFilter.mode(Color(0xFF2A1115), BlendMode.srcIn),
          ),
        ),
        // Deliberately generous space above and below. The slogan is the only
        // thing standing between the lockup and the card, so letting it sit in
        // that band — rather than tucked tight under the wordmark — is what
        // makes the gap read as composition instead of leftover emptiness.
        const SizedBox(height: 22),
        // Broken by hand rather than left to wrap. The split falls after
        // 'elegance' so both lines carry a complete phrase, and keeping it off
        // one long line also keeps the ends clear of the garments that close
        // in from both edges of the backdrop at this height.
        //
        // Curly quotes, not straight ones: a straight double quote is a typing
        // convention, and next to a script logotype it reads as a mistake.
        //
        // Nudged right to sit on the same optical axis as the emblem above it.
        Padding(
          padding: const EdgeInsets.only(left: 34, right: 22),
          child: Text(
            '“Adore the elegance\nyou owe yourself”',
            textAlign: TextAlign.center,
            // Sentient Bold. Built from `titleMd` (Sentient Medium) with the
            // weight overridden — safe here because Sentient is a bundled
            // asset family with both cuts registered, so Flutter resolves
            // w700 to the real Bold file. The same override on a google_fonts
            // style would only fake it, since the family name there is baked
            // per weight at call time.
            style: AppTypography.titleMd.copyWith(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              // NOTE: only Sentient-Medium and Sentient-Bold are bundled —
              // there is no italic cut. Flutter has no true italic to reach
              // for, so this is a synthetic slant, not drawn italic glyphs.
              // Adding Sentient-Italic to assets/fonts (and to the family in
              // pubspec.yaml under `style: italic`) would make it real.
              fontStyle: FontStyle.italic,
              height: 1.5,
              letterSpacing: 0.4,
              color: const Color(0xFF8C173A),
            ),
          ),
        ),
        const SizedBox(height: 22),
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
      padding: const EdgeInsets.fromLTRB(22, 26, 22, 24),
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
          // 'Welcome to Adorini' repeated the brand name within ~150px of the
          // script logotype directly above it. The greeting carries the warmth;
          // the wordmark already carries the name. Neutral on purpose — one
          // flow serves both sign-in and sign-up, so 'Welcome back' would be
          // wrong for a new shopper.
          Text(
            otpSent ? 'Enter the code' : 'Welcome',
            textAlign: TextAlign.center,
            style: AppTypography.titleMd.copyWith(
              fontSize: 28,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF211517),
            ),
          ),
          const SizedBox(height: 6),
          if (otpSent) ...<Widget>[
            Text(
              'We sent a 6-digit code to +91 ${phoneController.text.trim()}',
              textAlign: TextAlign.center,
              style: AppTypography.bodyMd.copyWith(
                fontSize: 14,
                color: const Color(0xFF5D5352),
              ),
            ),
            const SizedBox(height: 14),
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
                const Icon(Icons.error_outline,
                    size: 16, color: AppColors.error),
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

          const SizedBox(height: 20),
          SizedBox(
            height: 56,
            child: ElevatedButton(
              onPressed:
                  auth.isLoading || !canContinue ? null : () => onSubmit(),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFA81746),
                foregroundColor: Colors.white,
                // A translucent wash of the brand maroon under white text sat
                // near 1.9:1 — unreadable, and it still read as an enabled
                // button, so it invited taps that do nothing. A neutral fill
                // with dark text is unmistakably inert and stays legible.
                disabledBackgroundColor: const Color(0xFFEFE7E3),
                disabledForegroundColor: AppColors.onSurfaceVariant,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999)),
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
                const SizedBox(height: 18),
                Row(
                  children: <Widget>[
                    const Expanded(child: Divider(color: Color(0xFFE6D9D8))),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(
                        'or continue with',
                        style: AppTypography.bodyMd.copyWith(
                            fontSize: 13, color: AppColors.onSurfaceVariant),
                      ),
                    ),
                    const Expanded(child: Divider(color: Color(0xFFE6D9D8))),
                  ],
                ),
                const SizedBox(height: 12),
                // Styled as pending, not ready. The plugin and OAuth client
                // are not configured, so `onGoogle` only explains that —
                // presenting it identically to a working control was the
                // same kind of promise the removed auth-bypass button made.
                // It stays tappable so the tap is answered rather than
                // swallowed by a dead button.
                OutlinedButton(
                  onPressed: onGoogle,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.onSurfaceVariant,
                    side: const BorderSide(color: Color(0xFFEDE3E0)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                    minimumSize: const Size.fromHeight(50),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      // Neutral rather than Google blue: the real mark is the
                      // four-colour 'G', and a blue letter is both off-brand
                      // and outside Google's identity guidelines.
                      Text(
                        'G',
                        style: AppTypography.bodyMd.copyWith(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppColors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text('Continue with Google',
                          style: AppTypography.bodyMd.copyWith(fontSize: 14)),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFE7E3),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          'SOON',
                          style: AppTypography.labelBold.copyWith(
                            fontSize: 9,
                            letterSpacing: 0.8,
                            color: AppColors.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Icon(Icons.verified_user_outlined,
                  size: 18, color: Color(0xFFA81746)),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  'Your data is 100% secure with us',
                  textAlign: TextAlign.center,
                  style: AppTypography.bodyMd.copyWith(
                      fontSize: 13, color: AppColors.onSurfaceVariant),
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

    // Sits directly on the photographic collage, where garment detail runs
    // right under the labels. Unbacked, 11px text over that is unreadable —
    // this translucent surface lifts it off the imagery without competing
    // with the solid card above.
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFCFB).withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: <Widget>[
          for (int index = 0; index < benefits.length; index++) ...<Widget>[
            if (index > 0) const SizedBox(width: 8),
            Expanded(
              child: Column(
                children: <Widget>[
                  Icon(benefits[index].$1, color: accent, size: 22),
                  const SizedBox(height: 6),
                  Text(
                    benefits[index].$2,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodyMd
                        .copyWith(fontSize: 11, color: const Color(0xFF3B282B)),
                  ),
                ],
              ),
            ),
            if (index < benefits.length - 1)
              Container(width: 1, height: 30, color: const Color(0xFFE2C9CF)),
          ],
        ],
      ),
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
              style: AppTypography.bodyLg
                  .copyWith(fontSize: 16, letterSpacing: 1.2),
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
      inputFormatters: <TextInputFormatter>[
        FilteringTextInputFormatter.digitsOnly
      ],
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
