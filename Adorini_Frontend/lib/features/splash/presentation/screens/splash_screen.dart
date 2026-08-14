import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../auth/domain/auth_controller.dart';
import '../../../auth/domain/auth_state.dart';
import '../widgets/adorini_animated_logo.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with SingleTickerProviderStateMixin {
  bool _navigated = false;
  late final AnimationController _fadeController;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fadeAnimation = CurvedAnimation(
      parent: _fadeController,
      curve: Curves.easeIn,
    );
    _fadeController.forward();
  }

  @override
  void dispose() {
    _fadeController.dispose();
    super.dispose();
  }

  void _proceedToApp() {
    if (_navigated || !mounted) return;
    _navigated = true;

    final AuthState authState = ref.read(authControllerProvider);
    if (authState.isAuthenticated) {
      context.go('/home');
    } else {
      context.go('/onboarding');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D0D),
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _proceedToApp, // Allow quick skip on tap if user desires
        child: Stack(
          children: <Widget>[
            // Subtle luxury ambient background glow
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment.center,
                    radius: 0.85,
                    colors: <Color>[
                      const Color(0xFF261D16).withValues(alpha: 0.35),
                      const Color(0xFF0D0D0D),
                    ],
                  ),
                ),
              ),
            ),
            // Centered Animated Logo
            Center(
              child: FadeTransition(
                opacity: _fadeAnimation,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24.0),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      maxWidth: 672.0, // Max-w-2xl
                      maxHeight: 310.0,
                    ),
                    child: AspectRatio(
                      aspectRatio: 1088.0 / 500.0,
                      child: AdoriniAnimatedLogo(
                        duration: const Duration(milliseconds: 3200),
                        color: Colors.white,
                        strokeWidth: 1.5,
                        onAnimationComplete: () {
                          // Allow a brief moment to admire the complete logo
                          Future<void>.delayed(
                            const Duration(milliseconds: 400),
                            _proceedToApp,
                          );
                        },
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
