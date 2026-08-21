import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/theme/app_typography.dart';

/// Bottom-tab shell: Home, Video Reels, Catalog, Wishlist, Account.
class AppShell extends StatelessWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    final double statusBarHeight = MediaQuery.viewPaddingOf(context).top;
    final double navigationBottom =
        AppSpacing.base + MediaQuery.viewPaddingOf(context).bottom;
    final Color bottomSurfaceColor = switch (navigationShell.currentIndex) {
      1 => Colors.black,
      0 || 4 => AppColors.surfaceContainerLow,
      _ => AppColors.background,
    };

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
            height: navigationBottom + 22,
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(22),
              ),
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: <Color>[
                        bottomSurfaceColor.withValues(alpha: 0),
                        bottomSurfaceColor.withValues(alpha: 0.98),
                        bottomSurfaceColor,
                      ],
                      stops: const <double>[0, 0.22, 0.30],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: AppSpacing.base,
            right: AppSpacing.base,
            bottom: navigationBottom,
            child: _BottomNavigationPill(
              currentIndex: navigationShell.currentIndex,
              onTap: (int index) => navigationShell.goBranch(
                index,
                initialLocation: index == navigationShell.currentIndex,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Capsule height.
///
/// 58 keeps the floating capsule compact while preserving a comfortable tap
/// target and balanced padding around the icon-and-label stack.
const double _navHeight = 58;

@immutable
class _NavDestination {
  const _NavDestination({
    required this.icon,
    required this.activeIcon,
    required this.label,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
}

const List<_NavDestination> _destinations = <_NavDestination>[
  _NavDestination(
    icon: Icons.home_outlined,
    activeIcon: Icons.home,
    label: 'Home',
  ),
  _NavDestination(
    icon: Icons.play_circle_outline,
    activeIcon: Icons.play_circle_filled,
    label: 'Reels',
  ),
  _NavDestination(
    icon: Icons.grid_view_outlined,
    activeIcon: Icons.grid_view,
    label: 'Catalog',
  ),
  _NavDestination(
    icon: Icons.favorite_border,
    activeIcon: Icons.favorite,
    label: 'Wishlist',
  ),
  _NavDestination(
    icon: Icons.person_outline,
    activeIcon: Icons.person,
    label: 'Account',
  ),
];

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final _NavDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color color =
        selected ? AppColors.primary : AppColors.onSurfaceVariant;

    return GestureDetector(
      // Opaque so the whole column height is tappable, not just the glyphs.
      // The capsule is only 64 tall and already inset from the screen edge, so
      // every lost pixel of target matters.
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(
            selected ? destination.activeIcon : destination.icon,
            size: 22,
            color: color,
          ),
          const SizedBox(height: 2),
          Text(
            destination.label,
            maxLines: 1,
            // Clipped rather than ellipsised: at 11pt none of these five labels
            // comes close to its slot, and an ellipsis would only ever appear
            // at extreme text scales, where a "Wishlis…" is worse than a label
            // that simply runs to the edge.
            overflow: TextOverflow.clip,
            style: AppTypography.bodyMd.copyWith(
              fontSize: 11,
              height: 1.1,
              color: color,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _BottomNavigationPill extends StatelessWidget {
  const _BottomNavigationPill({
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(
          color: AppColors.outlineVariant.withValues(alpha: 0.55),
          width: 0.8,
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: SizedBox(
          height: _navHeight,
          child: Row(
            children: <Widget>[
              for (int i = 0; i < _destinations.length; i++)
                Expanded(
                  child: _NavItem(
                    destination: _destinations[i],
                    selected: i == currentIndex,
                    onTap: () => onTap(i),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
