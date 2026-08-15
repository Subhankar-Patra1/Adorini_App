import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';
import '../../../../../core/theme/app_typography.dart';
import '../../../domain/catalog_providers.dart';
import '../../../domain/home_providers.dart';

/// The merchandising banner at the top of the home page.
///
/// Auto-advances, but stops permanently the first time the shopper swipes it.
/// A carousel that keeps moving under a finger fights the person using it —
/// once they have taken control of the pacing, taking it back is the app
/// overriding a deliberate action.
class HeroCarousel extends ConsumerStatefulWidget {
  const HeroCarousel({super.key});

  static const double height = 208;

  @override
  ConsumerState<HeroCarousel> createState() => _HeroCarouselState();
}

class _HeroCarouselState extends ConsumerState<HeroCarousel> {
  final PageController _controller = PageController(viewportFraction: 0.9);
  Timer? _autoAdvance;
  int _page = 0;
  bool _userTookOver = false;

  @override
  void initState() {
    super.initState();
    _autoAdvance = Timer.periodic(const Duration(seconds: 5), (Timer t) {
      if (!mounted || _userTookOver) return;
      final int count = ref.read(heroSlidesProvider).length;
      if (count < 2) return;
      _controller.animateToPage(
        (_page + 1) % count,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _autoAdvance?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _open(HeroSlide slide) {
    ref.read(catalogFiltersProvider.notifier).state = slide.filters;
    context.go('/catalog');
  }

  @override
  Widget build(BuildContext context) {
    final List<HeroSlide> slides = ref.watch(heroSlidesProvider);
    if (slides.isEmpty) return const SizedBox.shrink();

    return Column(
      children: <Widget>[
        SizedBox(
          height: HeroCarousel.height,
          // Only a drag counts as taking over. A ScrollNotification also fires
          // for the programmatic animation above, which would switch the
          // carousel off after its own first advance.
          child: NotificationListener<UserScrollNotification>(
            onNotification: (UserScrollNotification n) {
              if (!_userTookOver) setState(() => _userTookOver = true);
              return false;
            },
            child: PageView.builder(
              controller: _controller,
              onPageChanged: (int i) => setState(() => _page = i),
              itemCount: slides.length,
              itemBuilder: (BuildContext context, int index) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                child: _HeroSlideCard(
                  slide: slides[index],
                  onTap: () => _open(slides[index]),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        _Dots(count: slides.length, active: _page),
      ],
    );
  }
}

class _HeroSlideCard extends StatelessWidget {
  const _HeroSlideCard({required this.slide, required this.onTap});

  final HeroSlide slide;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bool hasImage = slide.imageAsset != null;
    // Over a photograph the copy sits on a dark scrim and goes light; on a
    // plain panel it stays in the theme's own ink. Two palettes rather than
    // one set of light text everywhere, because white on `primaryContainer`
    // is barely 1.4:1 — legible in a mockup, unreadable in daylight.
    final Color ink =
        hasImage ? Colors.white : AppColors.onPrimaryContainer;
    final Color inkSoft = hasImage
        ? Colors.white.withValues(alpha: 0.86)
        : AppColors.onSurfaceVariant;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: hasImage
              ? null
              : const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: <Color>[
                    AppColors.primaryContainer,
                    AppColors.tertiaryContainer,
                  ],
                ),
          color: hasImage ? AppColors.surfaceContainer : null,
        ),
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (hasImage)
              Image.asset(
                slide.imageAsset!,
                fit: BoxFit.cover,
                alignment: const Alignment(0.4, -0.6),
              ),
            if (hasImage)
              // Left-weighted rather than a flat overlay: the copy occupies
              // the left half, so darkening the right as heavily would only
              // dull the photograph for no legibility gained.
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: <Color>[Color(0xCC1E1B19), Color(0x111E1B19)],
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 20, 22, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: <Widget>[
                  Text(
                    slide.eyebrow,
                    style: AppTypography.labelBold.copyWith(
                      fontSize: 10,
                      letterSpacing: 1.6,
                      color: inkSoft,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.base),
                  Text(
                    slide.headline,
                    style: AppTypography.headlineLgMobile.copyWith(
                      color: ink,
                      height: 1.15,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        slide.cta,
                        style: AppTypography.bodyMdBold.copyWith(
                          fontSize: 13,
                          color: ink,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Icon(Icons.arrow_forward, size: 16, color: ink),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.active});

  final int count;
  final int active;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        for (int i = 0; i < count; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: 6),
          // The active dot stretches into a pill rather than only changing
          // colour, so the position is readable without relying on a
          // colour difference alone.
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOut,
            width: i == active ? 18 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == active ? AppColors.primary : AppColors.outlineVariant,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
        ],
      ],
    );
  }
}
