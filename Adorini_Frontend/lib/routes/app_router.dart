import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/auth/presentation/screens/onboarding_screen.dart';
import '../features/catalog/presentation/screens/home_screen.dart';
import '../features/catalog/presentation/screens/new_showcase_screen.dart';
import '../features/catalog/presentation/screens/product_list_screen.dart';
import '../features/catalog/presentation/screens/wishlist_screen.dart';
import '../features/content_videos/presentation/screens/video_feed_screen.dart';
import '../features/pdp/presentation/screens/pdp_screen.dart';
import '../features/cart/presentation/screens/cart_screen.dart';
import '../features/checkout/presentation/screens/checkout_screen.dart';
import '../features/orders/presentation/screens/order_detail_screen.dart';
import '../features/orders/presentation/screens/order_history_screen.dart';
import '../features/orders/presentation/screens/returns/returns_list_screen.dart';
import '../features/orders/presentation/screens/returns/return_request_screen.dart';
import '../features/growth/presentation/screens/wallet_screen.dart';
import '../features/account/presentation/screens/profile_screen.dart';
import '../features/account/presentation/screens/edit_profile_screen.dart';
import '../features/splash/presentation/screens/splash_screen.dart';
import 'app_shell.dart';

/// Nudges GoRouter to re-run [GoRouter.redirect] when sign-in state changes,
/// without rebuilding the router itself.
///
/// The router must be built exactly once. `MaterialApp.router` treats a new
/// `routerConfig` as a new Navigator and rebuilds the entire widget tree from
/// scratch, destroying the `State` of whatever screen is on top. Watching
/// `authControllerProvider` here did precisely that: `AuthState` has no `==`,
/// so every `copyWith` — including the `isLoading` true/false pair that each
/// auth call emits — produced a fresh router and wiped the screen. Tapping
/// "SEND CODE" therefore reset OnboardingScreen's `_otpSent` back to false and
/// the OTP field could never appear.
///
/// Only `status` is worth a refresh; `isLoading` and `error` change constantly
/// during a login and never affect where the user should be routed.
class AuthRouterRefresh extends ChangeNotifier {
  AuthRouterRefresh(Ref ref) {
    ref.listen<AuthState>(authControllerProvider,
        (AuthState? previous, AuthState next) {
      if (previous?.status != next.status) {
        notifyListeners();
      }
    });
  }
}

final Provider<AuthRouterRefresh> _authRouterRefreshProvider =
    Provider<AuthRouterRefresh>((Ref ref) {
  final AuthRouterRefresh refresh = AuthRouterRefresh(ref);
  ref.onDispose(refresh.dispose);
  return refresh;
});

/// Routes a signed-out shopper may reach via "Browse".
///
/// These mirror what the backend itself leaves open: catalog, PDP and the
/// video feed are all `@Public()` there, so gating them in the client only
/// loses browsers who have not decided to buy yet. Everything tied to a
/// person — cart, checkout, orders, wallet, wishlist, profile — stays behind
/// the redirect, and tapping one of those simply returns the shopper here to
/// sign in.
bool _isGuestBrowsable(String location) {
  // '/new' is the showcase. It reads the same `@Public()` product list the
  // catalog does, so gating it would turn the home page's most eye-catching
  // tile into a sign-in wall for a shopper who has not decided to buy yet.
  const List<String> browsable = <String>[
    '/home',
    '/catalog',
    '/videos',
    '/new',
  ];
  return browsable.any(location.startsWith);
}

/// The Navigator above the tab shell.
///
/// Needed so that routes reachable from more than one tab — the PDP above all
/// — can declare themselves as belonging to it. Without that, `context.push`
/// of a route nested inside the catalog branch, performed from the *home*
/// branch, asks GoRouter to re-enter the shell it is already inside. It builds
/// a second `StatefulShellRoute` match whose page key is derived from the
/// route object's `hashCode` — the same object, therefore the same key — and
/// the root Navigator asserts on the duplicate:
///
///     '!keyReservation.contains(key)': is not true
///
/// The visible symptom before the assertion fires is a product tap that snaps
/// back to the top of Home instead of opening anything.
final GlobalKey<NavigatorState> _rootNavigatorKey =
    GlobalKey<NavigatorState>(debugLabel: 'root');

final Provider<GoRouter> appRouterProvider = Provider<GoRouter>((Ref ref) {
  // Identity-stable: this provider never rebuilds, so neither does the router.
  final AuthRouterRefresh refresh = ref.watch(_authRouterRefreshProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      // Read, not watch — the refreshListenable above decides when this re-runs.
      final AuthState authState = ref.read(authControllerProvider);

      final bool onSplash = state.matchedLocation == '/splash';
      if (onSplash) return null;

      final bool onOnboarding = state.matchedLocation == '/onboarding';
      if (authState.status == AuthStatus.unknown) return null;
      if (!authState.isAuthenticated &&
          !onOnboarding &&
          !_isGuestBrowsable(state.matchedLocation)) {
        return '/onboarding';
      }
      if (authState.isAuthenticated && onOnboarding) return '/home';
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/splash',
        builder: (BuildContext context, GoRouterState state) =>
            const SplashScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (BuildContext context, GoRouterState state) =>
            const OnboardingScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (BuildContext context, GoRouterState state,
            StatefulNavigationShell shell) {
          return AppShell(navigationShell: shell);
        },
        branches: <StatefulShellBranch>[
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                  path: '/home',
                  builder: (BuildContext c, GoRouterState s) =>
                      const HomeScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/videos',
                builder: (BuildContext c, GoRouterState s) =>
                    const VideoFeedScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/catalog',
                builder: (BuildContext c, GoRouterState s) =>
                    const ProductListScreen(),
                routes: <RouteBase>[
                  // Pinned to the root Navigator. The path stays nested under
                  // /catalog so every existing link keeps working, but the
                  // page is pushed *above* the tab shell rather than inside
                  // the catalog branch — which is what makes it openable from
                  // the home rails, the reels feed and the showcase alike.
                  //
                  // It also matches how a PDP should behave: full screen, over
                  // the tabs, with Back returning to wherever it was opened
                  // from rather than to the catalog grid.
                  GoRoute(
                    path: 'product/:slug',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (BuildContext c, GoRouterState s) =>
                        PdpScreen(slug: s.pathParameters['slug']!),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/wishlist',
                builder: (BuildContext c, GoRouterState s) =>
                    const WishlistScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/profile',
                builder: (BuildContext c, GoRouterState s) =>
                    const ProfileScreen(),
                routes: <RouteBase>[
                  GoRoute(
                    path: 'edit',
                    builder: (BuildContext c, GoRouterState s) =>
                        const EditProfileScreen(),
                  ),
                  GoRoute(
                    path: 'wallet',
                    builder: (BuildContext c, GoRouterState s) =>
                        const WalletScreen(),
                  ),
                  GoRoute(
                    path: 'orders',
                    builder: (BuildContext c, GoRouterState s) =>
                        const OrderHistoryScreen(),
                  ),
                  GoRoute(
                    path: 'orders/:orderId',
                    builder: (BuildContext c, GoRouterState s) =>
                        OrderDetailScreen(
                            orderId: s.pathParameters['orderId']!),
                  ),
                  GoRoute(
                    path: 'orders/:orderId/return',
                    builder: (BuildContext c, GoRouterState s) =>
                        ReturnRequestScreen(
                            orderId: s.pathParameters['orderId']!),
                  ),
                  GoRoute(
                    path: 'returns',
                    builder: (BuildContext c, GoRouterState s) =>
                        const ReturnsListScreen(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      // Outside the tab shell on purpose: the showcase is a full-bleed
      // composition, and the bottom bar would both crop the garment and
      // contradict the screen's own Back control.
      GoRoute(
        path: '/new',
        builder: (BuildContext context, GoRouterState state) =>
            const NewShowcaseScreen(),
      ),
      GoRoute(
        path: '/cart',
        builder: (BuildContext context, GoRouterState state) =>
            const CartScreen(),
      ),
      GoRoute(
        path: '/checkout',
        builder: (BuildContext context, GoRouterState state) =>
            const CheckoutScreen(),
      ),
    ],
  );
});
