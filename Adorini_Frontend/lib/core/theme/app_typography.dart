import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Text styles matching the Adorini Stitch type scale: Sentient for the
/// headings/title, Clash Grotesk Medium for the lower levels (body, labels,
/// price).
class AppTypography {
  const AppTypography._();

  /// Sentient is bundled as an asset (see pubspec.yaml `fonts:`) — only
  /// Medium (500) and Bold (700) cuts were supplied, so every style below
  /// asks for one of those two rather than a weight with no matching file,
  /// which Flutter would otherwise fake by synthesizing a bolder stroke on
  /// top of whichever real cut is closest.
  static TextStyle _sentient({
    required double fontSize,
    required FontWeight fontWeight,
    required double height,
    double? letterSpacing,
    Color color = AppColors.onSurface,
  }) {
    return TextStyle(
      fontFamily: 'Sentient',
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height / fontSize,
      letterSpacing: letterSpacing,
      color: color,
    );
  }

  /// Clash Grotesk is bundled as an asset, same as Sentient — Medium (500)
  /// and Bold (700) cuts were both supplied for this tier.
  static TextStyle _clashGrotesk({
    required double fontSize,
    required FontWeight fontWeight,
    required double height,
    double? letterSpacing,
    Color color = AppColors.onSurface,
  }) {
    return TextStyle(
      fontFamily: 'ClashGrotesk',
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height / fontSize,
      letterSpacing: letterSpacing,
      color: color,
    );
  }

  static final TextStyle displayLg = _sentient(
    fontSize: 40,
    fontWeight: FontWeight.w700,
    height: 48,
    letterSpacing: -0.8,
  );

  static final TextStyle headlineLg = _sentient(
    fontSize: 32,
    fontWeight: FontWeight.w700,
    height: 40,
    letterSpacing: -0.32,
  );

  static final TextStyle headlineLgMobile = _sentient(
    fontSize: 24,
    fontWeight: FontWeight.w500,
    height: 32,
  );

  static final TextStyle titleMd = _sentient(
    fontSize: 20,
    fontWeight: FontWeight.w500,
    height: 28,
  );

  static final TextStyle bodyLg = _clashGrotesk(
    fontSize: 18,
    fontWeight: FontWeight.w500,
    height: 28,
  );

  static final TextStyle bodyLgBold = _clashGrotesk(
    fontSize: 18,
    fontWeight: FontWeight.w700,
    height: 28,
  );

  static final TextStyle bodyMd = _clashGrotesk(
    fontSize: 16,
    fontWeight: FontWeight.w500,
    height: 24,
  );

  static final TextStyle bodyMdBold = _clashGrotesk(
    fontSize: 16,
    fontWeight: FontWeight.w700,
    height: 24,
  );

  static final TextStyle labelBold = _clashGrotesk(
    fontSize: 14,
    fontWeight: FontWeight.w700,
    height: 20,
    letterSpacing: 0.7,
  );

  static final TextStyle priceDisplay = _clashGrotesk(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    height: 28,
  );

  static TextTheme get textTheme => TextTheme(
        displayLarge: displayLg,
        headlineLarge: headlineLg,
        headlineMedium: headlineLgMobile,
        titleMedium: titleMd,
        bodyLarge: bodyLg,
        bodyMedium: bodyMd,
        labelLarge: labelBold,
      );
}
