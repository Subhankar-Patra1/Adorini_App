import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';

/// Bottom-tab shell: Home, Video Reels, Catalog, Wishlist, Account.
class AppShell extends StatelessWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    final double statusBarHeight = MediaQuery.viewPaddingOf(context).top;
    final double navigationBottom =
        AppSpacing.base + MediaQuery.viewPaddingOf(context).bottom;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          Positioned.fill(child: navigationShell),
          Positioned(
            left: 0,
            top: 0,
            right: 0,
            height: statusBarHeight,
            child: const IgnorePointer(
              child: ColoredBox(color: AppColors.surfaceContainerLow),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: navigationBottom + 60,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: <Color>[
                      AppColors.surfaceContainerLow.withValues(alpha: 0),
                      AppColors.surfaceContainerLow,
                      AppColors.surfaceContainerLow,
                    ],
                    stops: const <double>[0, 0.3, 1],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: AppSpacing.base,
            right: AppSpacing.base,
            bottom: navigationBottom,
            child: DecoratedBox(
              position: DecorationPosition.foreground,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadius.full),
                border: Border.all(
                  color: AppColors.outlineVariant.withValues(alpha: 0.55),
                  width: 0.8,
                ),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.full),
                child: SizedBox(
                  height: 60,
                  child: MediaQuery.removePadding(
                    context: context,
                    removeBottom: true,
                    child: BottomNavigationBar(
                      elevation: 0,
                      iconSize: 22,
                      selectedFontSize: 11,
                      unselectedFontSize: 11,
                      currentIndex: navigationShell.currentIndex,
                      onTap: (int index) => navigationShell.goBranch(
                        index,
                        initialLocation: index == navigationShell.currentIndex,
                      ),
                      items: const <BottomNavigationBarItem>[
                        BottomNavigationBarItem(
                          icon: Icon(Icons.home_outlined),
                          activeIcon: Icon(Icons.home),
                          label: 'Home',
                        ),
                        BottomNavigationBarItem(
                          icon: Icon(Icons.play_circle_outline),
                          activeIcon: Icon(Icons.play_circle_filled),
                          label: 'Reels',
                        ),
                        BottomNavigationBarItem(
                          icon: Icon(Icons.grid_view_outlined),
                          activeIcon: Icon(Icons.grid_view),
                          label: 'Catalog',
                        ),
                        BottomNavigationBarItem(
                          icon: Icon(Icons.favorite_border),
                          activeIcon: Icon(Icons.favorite),
                          label: 'Wishlist',
                        ),
                        BottomNavigationBarItem(
                          icon: Icon(Icons.person_outline),
                          activeIcon: Icon(Icons.person),
                          label: 'Account',
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
