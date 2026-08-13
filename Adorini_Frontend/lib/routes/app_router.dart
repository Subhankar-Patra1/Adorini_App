import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/domain/auth_controller.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/auth/presentation/screens/onboarding_screen.dart';
import '../features/catalog/presentation/screens/home_screen.dart';
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
import 'app_shell.dart';

final Provider<GoRouter> appRouterProvider = Provider<GoRouter>((Ref ref) {
  final AuthState authState = ref.watch(authControllerProvider);

  return GoRouter(
    initialLocation: '/home',
    redirect: (BuildContext context, GoRouterState state) {
      final bool onOnboarding = state.matchedLocation == '/onboarding';
      if (authState.status == AuthStatus.unknown) return null;
      if (!authState.isAuthenticated && !onOnboarding) return '/onboarding';
      if (authState.isAuthenticated && onOnboarding) return '/home';
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/onboarding',
        builder: (BuildContext context, GoRouterState state) => const OnboardingScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (BuildContext context, GoRouterState state, StatefulNavigationShell shell) {
          return AppShell(navigationShell: shell);
        },
        branches: <StatefulShellBranch>[
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(path: '/home', builder: (BuildContext c, GoRouterState s) => const HomeScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/videos',
                builder: (BuildContext c, GoRouterState s) => const VideoFeedScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/catalog',
                builder: (BuildContext c, GoRouterState s) => const ProductListScreen(),
                routes: <RouteBase>[
                  GoRoute(
                    path: 'product/:slug',
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
                builder: (BuildContext c, GoRouterState s) => const WishlistScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/profile',
                builder: (BuildContext c, GoRouterState s) => const ProfileScreen(),
                routes: <RouteBase>[
                  GoRoute(
                    path: 'wallet',
                    builder: (BuildContext c, GoRouterState s) => const WalletScreen(),
                  ),
                  GoRoute(
                    path: 'orders',
                    builder: (BuildContext c, GoRouterState s) => const OrderHistoryScreen(),
                  ),
                  GoRoute(
                    path: 'orders/:orderId',
                    builder: (BuildContext c, GoRouterState s) =>
                        OrderDetailScreen(orderId: s.pathParameters['orderId']!),
                  ),
                  GoRoute(
                    path: 'orders/:orderId/return',
                    builder: (BuildContext c, GoRouterState s) =>
                        ReturnRequestScreen(orderId: s.pathParameters['orderId']!),
                  ),
                  GoRoute(
                    path: 'returns',
                    builder: (BuildContext c, GoRouterState s) => const ReturnsListScreen(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/cart',
        builder: (BuildContext context, GoRouterState state) => const CartScreen(),
      ),
      GoRoute(
        path: '/checkout',
        builder: (BuildContext context, GoRouterState state) => const CheckoutScreen(),
      ),
    ],
  );
});
