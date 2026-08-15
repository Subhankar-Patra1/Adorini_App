import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:adorini_frontend/core/theme/app_typography.dart';

/// `ThemeData` merges the `TextTheme` it is given with the platform typography
/// instead of replacing it, so a slot left null keeps the platform default —
/// Roboto on Android. That is silent: nothing errors, the wrong face simply
/// appears. `AlertDialog` headings and `Badge` counts were doing exactly that.
///
/// These pin every slot to one of the app's two bundled families.
void main() {
  const Set<String> allowedFamilies = <String>{'Sentient', 'ClashGrotesk'};

  TextTheme theme() => AppTypography.textTheme;

  Map<String, TextStyle?> slots(TextTheme t) => <String, TextStyle?>{
        'displayLarge': t.displayLarge,
        'displayMedium': t.displayMedium,
        'displaySmall': t.displaySmall,
        'headlineLarge': t.headlineLarge,
        'headlineMedium': t.headlineMedium,
        'headlineSmall': t.headlineSmall,
        'titleLarge': t.titleLarge,
        'titleMedium': t.titleMedium,
        'titleSmall': t.titleSmall,
        'bodyLarge': t.bodyLarge,
        'bodyMedium': t.bodyMedium,
        'bodySmall': t.bodySmall,
        'labelLarge': t.labelLarge,
        'labelMedium': t.labelMedium,
        'labelSmall': t.labelSmall,
      };

  group('AppTypography.textTheme', () {
    test('fills every slot, so none falls back to the platform font', () {
      final List<String> empty = slots(theme())
          .entries
          .where((MapEntry<String, TextStyle?> e) => e.value == null)
          .map((MapEntry<String, TextStyle?> e) => e.key)
          .toList();

      expect(empty, isEmpty,
          reason: 'these slots would render in Roboto: ${empty.join(', ')}');
    });

    test('every slot uses a bundled family', () {
      slots(theme()).forEach((String name, TextStyle? style) {
        expect(allowedFamilies, contains(style!.fontFamily),
            reason: '$name uses ${style.fontFamily}');
      });
    });

    test('every slot asks for a weight that has a real font file', () {
      // Only Medium (500) and Bold (700) are bundled for both families; any
      // other weight would be synthesized rather than drawn.
      final Set<FontWeight> bundled = <FontWeight>{
        FontWeight.w500,
        FontWeight.w700,
      };
      slots(theme()).forEach((String name, TextStyle? style) {
        expect(bundled, contains(style!.fontWeight),
            reason: '$name asks for ${style.fontWeight}');
      });
    });

    test('the slots that were leaking Roboto are now Clash Grotesk', () {
      final TextTheme t = theme();
      expect(t.headlineSmall!.fontFamily, 'ClashGrotesk'); // AlertDialog title
      expect(t.labelSmall!.fontFamily, 'ClashGrotesk'); // Badge count
    });
  });
}
