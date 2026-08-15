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

  /// Prices, everywhere they appear.
  ///
  /// Clash Grotesk Bold, set smaller than the rest of the scale. The weight is
  /// what makes a price read as a price at a glance down a grid; the size is
  /// what stops it shouting over the product name beside it. Dropping the
  /// weight instead made prices recede into the caption, so only the size came
  /// down.
  ///
  /// w700 is a bundled cut, not a synthesised one — Clash Grotesk ships Medium
  /// (500) and Bold (700) here, and anything between them snaps to one or the
  /// other.
  ///
  /// `height` is in points, not a multiplier; the helper divides it by
  /// `fontSize`. Kept at ~1.28 so the line box shrinks with the type rather
  /// than leaving the old 22pt leading around 18pt text.
  static final TextStyle priceDisplay = _clashGrotesk(
    fontSize: 16,
    fontWeight: FontWeight.w700,
    height: 20,
  );

  /// Clash Grotesk Medium, for a [TextTheme] slot the scale does not name.
  ///
  /// Sizes follow the Material 3 defaults so widgets keep their intended
  /// proportions — only the typeface changes.
  static TextStyle _fallback(
          {required double fontSize, required double height}) =>
      _clashGrotesk(
        fontSize: fontSize,
        fontWeight: FontWeight.w500,
        height: height,
      );

  /// Every slot filled, deliberately.
  ///
  /// `ThemeData` *merges* the theme it is given with the platform typography
  /// rather than replacing it, so any slot left null silently keeps Roboto.
  /// That is how `AlertDialog` headings (`headlineSmall`) and `Badge` counts
  /// (`labelSmall`) were rendering in a face this app does not otherwise use.
  /// The named styles below carry the brand scale; the rest fall back to
  /// Clash Grotesk Medium so nothing can leak through.
  static TextTheme get textTheme => TextTheme(
        displayLarge: displayLg,
        displayMedium: _fallback(fontSize: 45, height: 52),
        displaySmall: _fallback(fontSize: 36, height: 44),
        headlineLarge: headlineLg,
        headlineMedium: headlineLgMobile,
        headlineSmall: _fallback(fontSize: 24, height: 32),
        titleLarge: _fallback(fontSize: 22, height: 28),
        titleMedium: titleMd,
        titleSmall: _fallback(fontSize: 14, height: 20),
        bodyLarge: bodyLg,
        bodyMedium: bodyMd,
        bodySmall: _fallback(fontSize: 12, height: 16),
        labelLarge: labelBold,
        labelMedium: _fallback(fontSize: 12, height: 16),
        labelSmall: _fallback(fontSize: 11, height: 16),
      );
}
