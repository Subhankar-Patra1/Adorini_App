import 'package:flutter/material.dart';

import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_theme.dart';

/// A shimmering placeholder block.
///
/// Hand-rolled rather than pulling in the `shimmer` package: the effect is one
/// animated gradient, and the app already ships four fonts and a video stack —
/// a dependency for twenty lines is not a trade worth making.
///
/// Skeletons rather than a centred spinner, because they are honest about what
/// is coming. A spinner says "something is loading"; a rail of grey cards says
/// "ten products, in two columns, right here" — so the page does not jump when
/// the data lands.
class ShimmerBox extends StatefulWidget {
  const ShimmerBox({
    required this.width,
    required this.height,
    this.borderRadius = 12,
    super.key,
  });

  final double width;
  final double height;
  final double borderRadius;

  @override
  State<ShimmerBox> createState() => _ShimmerBoxState();
}

class _ShimmerBoxState extends State<ShimmerBox>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (BuildContext context, Widget? child) {
        // Swept across three widths so the highlight enters from off the left
        // edge and leaves past the right, instead of appearing and vanishing
        // inside the box.
        final double t = _controller.value * 3 - 1;
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.borderRadius),
            gradient: LinearGradient(
              begin: Alignment(t - 1, 0),
              end: Alignment(t + 1, 0),
              colors: const <Color>[
                AppColors.surfaceContainer,
                AppColors.surfaceContainerLow,
                AppColors.surfaceContainer,
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Placeholder matching the shape of a loaded [ProductRail].
class RailSkeleton extends StatelessWidget {
  const RailSkeleton({required this.cardWidth, required this.height, super.key});

  final double cardWidth;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.containerMargin,
        ),
        itemCount: 4,
        separatorBuilder: (BuildContext c, int i) =>
            const SizedBox(width: AppSpacing.sm),
        itemBuilder: (BuildContext context, int index) => ShimmerBox(
          width: cardWidth,
          height: height,
          borderRadius: 16,
        ),
      ),
    );
  }
}

/// Placeholder for a section title, so the heading does not pop in late.
class SectionHeaderSkeleton extends StatelessWidget {
  const SectionHeaderSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.containerMargin,
        AppSpacing.lg,
        AppSpacing.containerMargin,
        AppSpacing.sm,
      ),
      child: Align(
        alignment: Alignment.centerLeft,
        child: ShimmerBox(width: 160, height: 22, borderRadius: 6),
      ),
    );
  }
}
