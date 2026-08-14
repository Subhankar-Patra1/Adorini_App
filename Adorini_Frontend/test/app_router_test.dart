import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:adorini_frontend/features/auth/domain/auth_controller.dart';
import 'package:adorini_frontend/features/auth/domain/auth_state.dart';
import 'package:adorini_frontend/routes/app_router.dart';

/// Replaces the real controller so the test never touches secure storage or
/// the network, and can drive [AuthState] directly.
class _TestAuthController extends AuthController {
  @override
  AuthState build() => const AuthState(status: AuthStatus.unauthenticated);

  void emit(AuthState next) => state = next;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  ProviderContainer makeContainer() {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        authControllerProvider.overrideWith(_TestAuthController.new),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('appRouterProvider', () {
    /// Regression: the router used to `ref.watch(authControllerProvider)`, so
    /// every `AuthState` change built a new GoRouter. `MaterialApp.router`
    /// rebuilds its whole tree when `routerConfig` changes, which destroyed the
    /// on-screen `State` — OnboardingScreen's `_otpSent` reset to false on the
    /// `isLoading` flip that "SEND CODE" emits, so the OTP field never showed.
    test('survives an isLoading change without being rebuilt', () {
      final ProviderContainer container = makeContainer();
      final GoRouter before = container.read(appRouterProvider);

      final _TestAuthController auth =
          container.read(authControllerProvider.notifier) as _TestAuthController;
      auth.emit(const AuthState(status: AuthStatus.unauthenticated, isLoading: true));
      auth.emit(const AuthState(status: AuthStatus.unauthenticated, isLoading: false));

      expect(identical(container.read(appRouterProvider), before), isTrue,
          reason: 'a new GoRouter here wipes the OTP screen mid-login');
    });

    test('survives an error change without being rebuilt', () {
      final ProviderContainer container = makeContainer();
      final GoRouter before = container.read(appRouterProvider);

      (container.read(authControllerProvider.notifier) as _TestAuthController)
          .emit(const AuthState(status: AuthStatus.unauthenticated, error: 'nope'));

      expect(identical(container.read(appRouterProvider), before), isTrue);
    });

    test('keeps the same router instance when the user signs in', () {
      final ProviderContainer container = makeContainer();
      final GoRouter before = container.read(appRouterProvider);

      (container.read(authControllerProvider.notifier) as _TestAuthController)
          .emit(const AuthState(status: AuthStatus.authenticated));

      // Sign-in must be handled by re-running redirect, not by swapping routers.
      expect(identical(container.read(appRouterProvider), before), isTrue);
    });
  });
}
