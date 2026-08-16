import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../data/google_sign_in_service.dart';
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

  /// When the server will next accept a resend.
  ///
  /// Stored as a wall-clock instant rather than a counter that the ticker
  /// decrements. A periodic Timer is not a clock — Android throttles timers in
  /// backgrounded apps, so a decrementing counter drifts and would still be
  /// showing "wait 40s" after the user came back a minute later. Deriving the
  /// remaining seconds from `DateTime.now()` on each tick stays truthful no
  /// matter how unevenly the ticks arrive.
  DateTime? _resendAvailableAt;
  Timer? _resendTicker;

  int get _resendSecondsLeft {
    final DateTime? at = _resendAvailableAt;
    if (at == null) return 0;
    final int left = at.difference(DateTime.now()).inSeconds;
    return left > 0 ? left : 0;
  }

  @override
  void initState() {
    super.initState();
    _phoneController.addListener(_onInputChanged);
    // Drives the Continue button's enabled state on the OTP step too, so it
    // cannot be tapped on a half-typed code only for the server to reject it.
    _otpController.addListener(_onInputChanged);
  }

  @override
  void dispose() {
    _resendTicker?.cancel();
    _phoneController.removeListener(_onInputChanged);
    _otpController.removeListener(_onInputChanged);
    _phoneController.dispose();
    _otpController.dispose();
    _referralController.dispose();
    super.dispose();
  }

  void _onInputChanged() {
    if (mounted) setState(() {});
  }

  /// Arms the cooldown using the window the *server* reported, rather than a
  /// number hard-coded here: the backend owns `OTP_RESEND_COOLDOWN_SECONDS`,
  /// and a client guessing it would either unlock early (and get rejected) or
  /// late (and make the shopper wait for nothing).
  void _startResendCooldown(int seconds) {
    _resendTicker?.cancel();
    if (seconds <= 0) {
      setState(() => _resendAvailableAt = null);
      return;
    }
    setState(() {
      _resendAvailableAt = DateTime.now().add(Duration(seconds: seconds));
    });
    _resendTicker = Timer.periodic(const Duration(seconds: 1), (Timer t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      // The tick only repaints; the remaining time is recomputed from the
      // clock, so a late or dropped tick cannot desynchronise the display.
      setState(() {});
      if (_resendSecondsLeft <= 0) t.cancel();
    });
  }

  Future<void> _sendOtp() async {
    final String phone = _phoneController.text.trim();
    if (phone.isEmpty) return;
    await ref.read(authControllerProvider.notifier).requestOtp(phone);
    if (!mounted) return;
    final AuthState state = ref.read(authControllerProvider);
    if (state.error == null) {
      setState(() => _otpSent = true);
      _startResendCooldown(state.otpRequested?.resendAfterSeconds ?? 0);
    } else if (state.retryAfterSeconds != null) {
      // Refused for being too soon — a code is already in flight from an
      // earlier attempt. Run the same countdown here, on the phone step, so
      // the wait is visibly ticking down instead of frozen at the number the
      // server happened to quote.
      _startResendCooldown(state.retryAfterSeconds!);
    }
  }

  /// Re-requests a code for the same number. Same endpoint as the first send —
  /// the backend has no separate resend route; it simply re-issues and hands
  /// back a fresh cooldown.
  Future<void> _resendOtp() async {
    if (_resendSecondsLeft > 0) return;
    _otpController.clear();
    await _sendOtp();
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
    // threshold.
    //
    // Nothing on this screen scales. The emblem, the script wordmark and the
    // tagline keep their drawn size throughout; the whole composition simply
    // rides upward, the lockup by `maxLockupLift` and the card by `maxLift`.
    //
    // The two caps differ on purpose. Moving both by the same amount would
    // buy the card no clearance it did not already have — the group would
    // just translate as a block. Lifting the lockup less closes the gap
    // between them, and that difference *is* the room the card gains. The
    // lockup's own cap is what keeps the emblem clear of the Skip control it
    // is travelling toward, and 100pt of that closing gap is what the card
    // used to have in total.
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
    const double liftSaturatesAtInset = 200;
    const double maxLift = 144;
    const double maxLockupLift = 44;
    final double liftProgress =
        (keyboardInset / liftSaturatesAtInset).clamp(0.0, 1.0);
    final double liftEased = Curves.easeOutCubic.transform(liftProgress);
    final double keyboardLift = maxLift * liftEased;
    // Same eased progress, so the lockup and the card start, travel and settle
    // together instead of arriving as two separate movements.
    final double lockupLift = maxLockupLift * liftEased;
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
                        onGoogle: _signInWithGoogle,
                        canContinue: _otpSent
                            ? _otpController.text.trim().length == 6
                            // Blocked during the cooldown: tapping Continue
                            // then can only earn another rejection, and the
                            // ticking message already says why.
                            : _phoneController.text.trim().length == 10 &&
                                _resendSecondsLeft == 0,
                        resendSecondsLeft: _resendSecondsLeft,
                        onResend: _resendOtp,
                      );

                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Column(
                          children: <Widget>[
                            SizedBox(height: compact ? 2 : 6),
                            _Wordmark(lift: lockupLift),
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
                                      // The OTP card is taller, so the FittedBox
                                      // scales it down more. Use a smaller canvas
                                      // for the shorter Welcome card so both
                                      // states finish at the same visible width.
                                      width: constraints.maxWidth *
                                          (_otpSent ? 1.11 : 1.03),
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

  /// Google sign-in.
  ///
  /// Three outcomes, and only one of them is an error:
  ///
  /// * **Authenticated** — a known Google account. Straight to `/home`.
  /// * **Phone required** — a new account. `signInWithGoogle` returns `false`
  ///   here, which is *not* a failure: it has stored a `registrationToken` in
  ///   `AuthState`, and the OTP flow already on this screen carries that token
  ///   into `/auth/otp/verify` to finish creating the account. So the screen
  ///   stays put and asks for a number. Treating that `false` as an error would
  ///   strand every new Google user on a dead end.
  /// * **Dismissed** — a null token. The shopper closed the sheet; saying
  ///   anything about it would be scolding them for changing their mind.
  Future<void> _signInWithGoogle() async {
    final String? idToken;
    try {
      idToken = await ref.read(googleSignInServiceProvider).signIn();
    } on GoogleSignInUnavailable catch (e) {
      if (mounted) _showMessage(e.message);
      return;
    }
    if (idToken == null || !mounted) return;

    final bool signedIn =
        await ref.read(authControllerProvider.notifier).signInWithGoogle(idToken);
    if (!mounted) return;

    if (signedIn) {
      context.go('/home');
      return;
    }

    // The controller reports a real failure through `state.error` and a
    // phone-required handoff through `registrationToken`, so read which of the
    // two happened rather than inferring it from the `false`.
    final AuthState state = ref.read(authControllerProvider);
    if (state.registrationToken != null) {
      _showMessage('Almost there — add your phone number to finish signing up.');
    } else if (state.error != null) {
      _showMessage(state.error!);
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
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
  const _Wordmark({this.lift = 0});

  /// How far the whole lockup rides upward, in logical pixels.
  ///
  /// A translation, never a scale: the emblem, the script wordmark and the
  /// tagline all keep their exact drawn size while the keyboard is up. The
  /// group moves as one, so the optical corrections between the three marks
  /// stay intact.
  final double lift;

  @override
  Widget build(BuildContext context) {
    // Transform, not padding or a shortened SizedBox: this must be paint-only.
    // Changing the lockup's reserved height would re-run layout on the Column
    // every frame of the keyboard's slide — the card, the trust row and the
    // FittedBox's scale factor would all be recomputed along with it, which is
    // exactly the whole-screen resize this screen exists to avoid.
    return Transform.translate(
      offset: Offset(0, -lift),
      child: Column(
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
      ),
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
    required this.resendSecondsLeft,
    required this.onResend,
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

  /// 0 once a resend is allowed.
  final int resendSecondsLeft;
  final Future<void> Function() onResend;

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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                TextButton(
                  onPressed: onChangeNumber,
                  style: TextButton.styleFrom(padding: EdgeInsets.zero),
                  child: const Text('Change number'),
                ),
                _ResendControl(
                  secondsLeft: resendSecondsLeft,
                  onResend: onResend,
                ),
              ],
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

          // A live cooldown outranks the server's sentence. The message was
          // accurate the instant it was generated and stale immediately
          // after, so once there is a running countdown it replaces the text
          // rather than sitting beside it contradicting itself.
          if (resendSecondsLeft > 0 && !otpSent) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Padding(
                  padding: EdgeInsets.only(top: 2),
                  child: Icon(
                    Icons.schedule,
                    size: 16,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    'Please wait ${resendSecondsLeft}s before requesting another code.',
                    style: AppTypography.bodyMd.copyWith(
                      fontSize: 13,
                      color: AppColors.onSurfaceVariant,
                      fontFeatures: const <FontFeature>[
                        FontFeature.tabularFigures()
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ] else if (auth.error != null) ...<Widget>[
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
                // Live: `onGoogle` runs the real account picker.
                //
                // Kept in the muted outline treatment rather than promoted to a
                // filled button. Phone/OTP is the primary path — it is the only
                // one that works for a shopper without a Google account, and
                // the backend can end up asking for a number anyway.
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

/// Live cooldown, flipping to a tappable "Resend code" when it expires.
///
/// The countdown is shown as plain text rather than a disabled button on
/// purpose: a greyed-out button invites tapping and then ignores it, whereas
/// a sentence that visibly counts down explains itself and needs no tap to
/// find out.
class _ResendControl extends StatelessWidget {
  const _ResendControl({required this.secondsLeft, required this.onResend});

  final int secondsLeft;
  final Future<void> Function() onResend;

  @override
  Widget build(BuildContext context) {
    if (secondsLeft <= 0) {
      return TextButton(
        onPressed: () => onResend(),
        style: TextButton.styleFrom(padding: EdgeInsets.zero),
        child: const Text('Resend code'),
      );
    }
    return Text(
      'Resend in ${secondsLeft}s',
      style: AppTypography.bodyMd.copyWith(
        fontSize: 13,
        color: AppColors.onSurfaceVariant,
        fontFeatures: const <FontFeature>[
          // Tabular digits: without them the proportional font re-measures as
          // the numbers change and the label jitters sideways once a second.
          FontFeature.tabularFigures(),
        ],
      ),
    );
  }
}

/// Six single-digit boxes, one focusable field each.
///
/// Built as six real fields rather than one field painted to look like six,
/// because that is what makes a middle digit directly editable: tapping box
/// three focuses box three, and there is no cursor arithmetic to map a tap
/// back into a position inside a hidden string.
///
/// [controller] stays the single source of truth for the joined code, so the
/// verify call and its `length != 6` guard are untouched by this widget.
class _OtpField extends StatefulWidget {
  const _OtpField({required this.controller});

  final TextEditingController controller;

  /// Fixed rather than a constructor parameter: the verify call's own
  /// `otp.length != 6` guard hard-codes the same number, so making this
  /// configurable here would only let the two drift apart.
  static const int length = 6;

  @override
  State<_OtpField> createState() => _OtpFieldState();
}

class _OtpFieldState extends State<_OtpField> {
  int get _length => _OtpField.length;

  late final List<TextEditingController> _boxes;
  late final List<FocusNode> _nodes;

  /// Guards the two-way sync. Writing the joined value out to
  /// [widget.controller] notifies its listeners, one of which is the pull
  /// below — without this the widget would immediately overwrite the digit it
  /// had just accepted.
  bool _writingOut = false;

  @override
  void initState() {
    super.initState();
    _boxes = List<TextEditingController>.generate(
      _length,
      (_) => TextEditingController(),
    );
    _nodes = List<FocusNode>.generate(_length, (int i) {
      return FocusNode(
        // Backspace on an already-empty box has no text change to report, so
        // onChanged never fires and the caret would simply stall. Handling the
        // key directly is what lets it step back and clear the previous digit.
        onKeyEvent: (FocusNode node, KeyEvent event) {
          if (event is KeyDownEvent &&
              event.logicalKey == LogicalKeyboardKey.backspace &&
              _boxes[i].text.isEmpty &&
              i > 0) {
            _boxes[i - 1].clear();
            _nodes[i - 1].requestFocus();
            _pushOut();
            setState(() {});
            return KeyEventResult.handled;
          }
          return KeyEventResult.ignored;
        },
      );
    });
    // Focus changes do not rebuild on their own, and the highlight is drawn
    // from `node.hasFocus` — without this it would never move off box one.
    for (final FocusNode n in _nodes) {
      n.addListener(_onFocusChanged);
    }
    _pullIn();
    widget.controller.addListener(_pullIn);
  }

  void _onFocusChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.controller.removeListener(_pullIn);
    for (final TextEditingController c in _boxes) {
      c.dispose();
    }
    for (final FocusNode n in _nodes) {
      n.removeListener(_onFocusChanged);
      n.dispose();
    }
    super.dispose();
  }

  /// Mirrors the joined controller back into the boxes — this is what makes
  /// "Change number" (which clears the controller) actually empty them.
  void _pullIn() {
    if (_writingOut) return;
    final String text = widget.controller.text;
    for (int i = 0; i < _length; i++) {
      final String next = i < text.length ? text[i] : '';
      if (_boxes[i].text != next) _boxes[i].text = next;
    }
    if (mounted) setState(() {});
  }

  void _pushOut() {
    _writingOut = true;
    widget.controller.text =
        _boxes.map((TextEditingController c) => c.text).join();
    _writingOut = false;
  }

  /// After a digit lands, move to the next box that is still empty; if the
  /// code is now complete, settle on the last box.
  ///
  /// Typing straight through, "next empty" is simply the box to the right, so
  /// one rule covers both that and correcting a digit in the middle — after
  /// the fix the caret jumps to whatever gap is still outstanding rather than
  /// marching pointlessly through digits that are already right.
  void _advanceFrom(int from) {
    for (int i = from + 1; i < _length; i++) {
      if (_boxes[i].text.isEmpty) {
        _nodes[i].requestFocus();
        return;
      }
    }
    for (int i = 0; i < _length; i++) {
      if (_boxes[i].text.isEmpty) {
        _nodes[i].requestFocus();
        return;
      }
    }
    _nodes[_length - 1].requestFocus();
  }

  void _onChanged(int i, String value) {
    // A paste or an SMS autofill arrives as one long string in whichever box
    // happens to hold focus; spread it across the row instead of truncating.
    if (value.length > 1) {
      final String digits = value.replaceAll(RegExp(r'\D'), '');
      for (int j = 0; j < _length; j++) {
        _boxes[j].text = j < digits.length ? digits[j] : '';
      }
      _pushOut();
      _advanceFrom(-1);
      setState(() {});
      return;
    }

    _pushOut();
    if (value.isNotEmpty) _advanceFrom(i);
    setState(() {});
  }

  void _focusBox(int index) {
    _nodes[index].requestFocus();
    _boxes[index].selection = TextSelection.collapsed(
      offset: _boxes[index].text.length,
    );
  }

  TextEditingValue _replaceExistingDigit(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (oldValue.text.length != 1 || newValue.text.length <= 1) {
      return newValue;
    }

    String inserted = newValue.text;
    if (newValue.text.startsWith(oldValue.text)) {
      inserted = newValue.text.substring(1);
    } else if (newValue.text.endsWith(oldValue.text)) {
      inserted = newValue.text.substring(0, newValue.text.length - 1);
    }

    return TextEditingValue(
      text: inserted,
      selection: TextSelection.collapsed(offset: inserted.length),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        for (int i = 0; i < _length; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: 4),
          Expanded(child: _OtpBox(index: i, state: this)),
        ],
      ],
    );
  }
}

class _OtpBox extends StatelessWidget {
  const _OtpBox({required this.index, required this.state});

  final int index;
  final _OtpFieldState state;

  static const Color _brand = Color(0xFFA81746);

  @override
  Widget build(BuildContext context) {
    final FocusNode node = state._nodes[index];
    final TextEditingController controller = state._boxes[index];
    final bool focused = node.hasFocus;
    final bool filled = controller.text.isNotEmpty;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      height: 54,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: focused
            ? <BoxShadow>[
                BoxShadow(
                  color: _brand.withValues(alpha: 0.12),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ]
            : null,
      ),
      // Draw the outline above the TextField. The app-wide input theme uses
      // a filled decoration, which otherwise paints across parts of a border
      // placed behind the field.
      foregroundDecoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: focused
              ? _brand
              : filled
                  ? _brand.withValues(alpha: 0.30)
                  : AppColors.outlineVariant,
          width: focused ? 2 : 1.2,
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          Theme(
            data: Theme.of(context).copyWith(
              textSelectionTheme: const TextSelectionThemeData(
                cursorColor: Colors.transparent,
                selectionColor: Colors.transparent,
                selectionHandleColor: Colors.transparent,
              ),
            ),
            child: TextField(
              controller: controller,
              focusNode: node,
              autofocus: index == 0,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              textAlignVertical: TextAlignVertical.center,
              expands: true,
              minLines: null,
              maxLines: null,
              maxLength: 1,
              maxLengthEnforcement: MaxLengthEnforcement.none,
              cursorColor: Colors.transparent,
              showCursor: false,
              enableInteractiveSelection: false,
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
                TextInputFormatter.withFunction(state._replaceExistingDigit),
              ],
              // The editable layer owns focus, keyboard and the full-size hit
              // target. Its glyph is transparent; the display layer below is
              // what guarantees exact optical centering.
              style: const TextStyle(color: Colors.transparent),
              decoration: const InputDecoration(
                filled: false,
                fillColor: Colors.transparent,
                counterText: '',
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
              ),
              onTap: () => state._focusBox(index),
              onChanged: (String value) => state._onChanged(index, value),
            ),
          ),
          IgnorePointer(
            child: Center(
              child: Text(
                controller.text,
                textAlign: TextAlign.center,
                style: AppTypography.displayLg.copyWith(
                  fontSize: 24,
                  height: 1,
                  fontWeight: FontWeight.w600,
                  color: AppColors.onSurface,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
