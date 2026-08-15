import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';

/// One fabric swatch in the fan.
///
/// Deliberately a *swatch*, not a garment cutout. A photographed garment with
/// no body inside reads as a ghost, and a ghost-mannequin shoot is a whole
/// production this brand does not have yet — whereas swatches read as fabric,
/// which is the thing actually being sold. Each card also names a real
/// category, so the screen doubles as merchandising for a shopper who has
/// never seen the store.
///
/// The gradient is a stand-in for a product photograph. When real imagery
/// exists in R2, [image] becomes the card's background and everything else
/// here — geometry, motion, stagger — is unchanged.
class CategorySwatch {
  const CategorySwatch({
    required this.label,
    required this.top,
    required this.bottom,
  });

  final String label;
  final Color top;
  final Color bottom;
}

/// Six of the ten catalogue categories. Not all ten: at phone width, ten
/// overlapping cards collapse into an unreadable smear, and the fan is
/// decoration for the sign-in screen rather than a navigation surface.
/// These six are the most visually distinct silhouettes in the range.
///
/// Colours are muted on purpose — saturated versions of the same hues read
/// as a discount app. Dusty reads as expensive.
const List<CategorySwatch> kAdoriniSwatches = <CategorySwatch>[
  CategorySwatch(label: 'KURTIS', top: Color(0xFFC98A70), bottom: Color(0xFFB5715A)),
  CategorySwatch(label: 'SUIT SETS', top: Color(0xFFB07E60), bottom: Color(0xFF9C6B4F)),
  CategorySwatch(label: 'KAFTAANS', top: Color(0xFFD9A85F), bottom: Color(0xFFC9954A)),
  CategorySwatch(label: 'PALAZZOS', top: Color(0xFF9AA88D), bottom: Color(0xFF87957A)),
  CategorySwatch(label: 'BLOUSES', top: Color(0xFFCB9E9C), bottom: Color(0xFFB98A88)),
  CategorySwatch(label: 'ONE-PIECE', top: Color(0xFF8F7180), bottom: Color(0xFF7D5F6B)),
];

/// A fan of fabric swatches that drift in from the screen edges and settle
/// into a shallow arc, then breathe.
///
/// The entrance is `easeOutBack` — a small overshoot past the resting spot,
/// which is what makes the motion read as physical rather than mechanical.
/// There is deliberately **no** wobble or shake afterwards: overshoot-plus-
/// settle reads premium, while overshoot-plus-shake reads like a grocery
/// delivery app. Same principle behind the slow float once everything has
/// landed — a still image looks broken, a bouncing one looks cheap.
class CategorySwatchFan extends StatefulWidget {
  const CategorySwatchFan({
    super.key,
    this.swatches = kAdoriniSwatches,
    this.cardWidth = 84,
    this.cardHeight = 112,
    this.spacing = 52,
  });

  final List<CategorySwatch> swatches;
  final double cardWidth;
  final double cardHeight;

  /// Distance between card centres. Less than [cardWidth], so cards overlap
  /// the way swatches do when spread out by hand.
  final double spacing;

  @override
  State<CategorySwatchFan> createState() => _CategorySwatchFanState();
}

class _CategorySwatchFanState extends State<CategorySwatchFan>
    with TickerProviderStateMixin {
  late final AnimationController _entry;
  late final AnimationController _float;

  /// Max tilt of the outermost cards, radians (~13°).
  static const double _maxTilt = 0.23;

  /// How much lower the outer cards sit than the centre ones — the arc.
  static const double _arcDrop = 20;

  /// Idle drift, peak-to-centre.
  static const double _floatAmplitude = 4;

  @override
  void initState() {
    super.initState();
    _entry = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..forward();
    _float = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 7000),
    )..repeat();
  }

  @override
  void dispose() {
    _entry.dispose();
    _float.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final int count = widget.swatches.length;
    final double centreIndex = (count - 1) / 2;
    final double screenWidth = MediaQuery.sizeOf(context).width;

    return SizedBox(
      height: widget.cardHeight + _arcDrop + 24,
      child: AnimatedBuilder(
        animation: Listenable.merge(<Listenable>[_entry, _float]),
        builder: (BuildContext context, Widget? child) {
          return Stack(
            alignment: Alignment.topCenter,
            clipBehavior: Clip.none,
            children: <Widget>[
              for (int i = 0; i < count; i++) _buildCard(i, centreIndex, screenWidth),
            ],
          );
        },
      ),
    );
  }

  Widget _buildCard(int i, double centreIndex, double screenWidth) {
    // -1 at the far left card, +1 at the far right, 0 in the middle.
    final double t = centreIndex == 0 ? 0 : (i - centreIndex) / centreIndex;

    // Cards land outward from centre, tilted, outer ones sitting lower.
    final double restX = t * centreIndex * widget.spacing;
    final double restY = _arcDrop * t * t;
    final double tilt = t * _maxTilt;

    // Stagger: outermost pair starts first so the fan fills from the edges
    // inward, which reads as "converging on the card" rather than "spraying
    // outward from it".
    final int stagger = (centreIndex - (i - centreIndex).abs()).round();
    final double begin = (stagger * 0.07).clamp(0.0, 0.6);
    final double end = (begin + 0.55).clamp(0.0, 1.0);

    final double slide = CurvedAnimation(
      parent: _entry,
      curve: Interval(begin, end, curve: Curves.easeOutBack),
    ).value;
    final double fade = CurvedAnimation(
      parent: _entry,
      curve: Interval(begin, (begin + 0.22).clamp(0.0, 1.0), curve: Curves.easeOut),
    ).value;

    // Each card enters from whichever edge it is closest to. A card exactly
    // in the middle (odd-length fans) rises from below instead.
    final double offX = t == 0 ? 0 : (t < 0 ? -screenWidth * 0.75 : screenWidth * 0.75);
    final double offY = t == 0 ? widget.cardHeight * 1.5 : 0;

    final double x = restX + (offX * (1 - slide));
    final double baseY = restY + (offY * (1 - slide));

    // Per-card phase so they don't bob in unison.
    final double phase = i * 0.37;
    final double floatY =
        math.sin(2 * math.pi * (_float.value + phase)) * _floatAmplitude * slide.clamp(0.0, 1.0);

    return Positioned(
      top: baseY + floatY,
      child: Transform.translate(
        offset: Offset(x, 0),
        child: Transform.rotate(
          angle: tilt * slide,
          child: Opacity(
            opacity: fade.clamp(0.0, 1.0),
            child: _SwatchCard(
              swatch: widget.swatches[i],
              width: widget.cardWidth,
              height: widget.cardHeight,
            ),
          ),
        ),
      ),
    );
  }
}

class _SwatchCard extends StatelessWidget {
  const _SwatchCard({
    required this.swatch,
    required this.width,
    required this.height,
  });

  final CategorySwatch swatch;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.card),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: <Color>[swatch.top, swatch.bottom],
        ),
        border: Border.all(color: Colors.white.withValues(alpha: 0.55), width: 1.2),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: const Color(0xFF3A2A1E).withValues(alpha: 0.18),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.base),
        child: Align(
          alignment: Alignment.bottomLeft,
          child: Text(
            swatch.label,
            style: AppTypography.labelBold.copyWith(
              color: Colors.white,
              fontSize: 9,
              letterSpacing: 1.1,
            ),
          ),
        ),
      ),
    );
  }
}
