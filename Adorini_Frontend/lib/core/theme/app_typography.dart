import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// Text styles matching the Adorini Stitch type scale (Outfit).
class AppTypography {
  const AppTypography._();

  static TextStyle _outfit({
    required double fontSize,
    required FontWeight fontWeight,
    required double height,
    double? letterSpacing,
    Color color = AppColors.onSurface,
  }) {
    return GoogleFonts.outfit(
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height / fontSize,
      letterSpacing: letterSpacing,
      color: color,
    );
  }

  static final TextStyle displayLg = _outfit(
    fontSize: 40,
    fontWeight: FontWeight.w600,
    height: 48,
    letterSpacing: -0.8,
  );

  static final TextStyle headlineLg = _outfit(
    fontSize: 32,
    fontWeight: FontWeight.w500,
    height: 40,
    letterSpacing: -0.32,
  );

  static final TextStyle headlineLgMobile = _outfit(
    fontSize: 24,
    fontWeight: FontWeight.w600,
    height: 32,
  );

  static final TextStyle titleMd = _outfit(
    fontSize: 20,
    fontWeight: FontWeight.w500,
    height: 28,
  );

  static final TextStyle bodyLg = _outfit(
    fontSize: 18,
    fontWeight: FontWeight.w400,
    height: 28,
  );

  static final TextStyle bodyMd = _outfit(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 24,
  );

  static final TextStyle labelBold = _outfit(
    fontSize: 14,
    fontWeight: FontWeight.w700,
    height: 20,
    letterSpacing: 0.7,
  );

  static final TextStyle priceDisplay = _outfit(
    fontSize: 22,
    fontWeight: FontWeight.w600,
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
