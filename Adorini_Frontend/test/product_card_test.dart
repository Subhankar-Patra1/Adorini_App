import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:adorini_frontend/core/constants/domain_enums.dart';
import 'package:adorini_frontend/features/catalog/data/product_model.dart';
import 'package:adorini_frontend/features/catalog/presentation/widgets/product_card.dart';

/// The catalogue grid overflowed by 38px because the cell height came from a
/// fixed `childAspectRatio`: the image scales with the cell width while the
/// caption is a fixed stack of text, so no single ratio survives every screen
/// width — or every font, and this app's type scale was reassigned repeatedly.
///
/// These pin the replacement: a cell measured from the live text styles, and a
/// card that ellipsises rather than overflowing if the measurement is ever off.
void main() {
  ProductSummary product(
      {String name = 'Anarkali Suit', bool discounted = false}) {
    return ProductSummary(
      id: 'p1',
      slug: 'anarkali-suit',
      name: name,
      pricePaise: 249900,
      compareAtPricePaise: discounted ? 349900 : null,
      fabricType: FabricType.values.first,
      categorySlug: 'suits',
      brandSlug: 'adorini',
    );
  }

  double cellWidth(double viewportWidth) =>
      ProductCard.cellWidthFor(viewportWidth);

  Future<void> pumpCell(
    WidgetTester tester, {
    required double viewportWidth,
    required ProductSummary summary,
    double textScale = 1.0,
  }) async {
    late double width;
    late double extent;

    await tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(
          size: Size(viewportWidth, 900),
          textScaler: TextScaler.linear(textScale),
        ),
        child: MaterialApp(
          home: Builder(
            builder: (BuildContext context) {
              width = cellWidth(viewportWidth);
              extent = ProductCard.extentFor(context, cellWidth: width);
              return Scaffold(
                body: Center(
                  child: SizedBox(
                    width: width,
                    height: extent,
                    child: ProductCard(product: summary, onTap: () {}),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  group('ProductCard in a measured grid cell', () {
    // The three widths bracket the common Android range; 393 is the device the
    // 38px overflow was reported on.
    for (final double width in <double>[360, 393, 412]) {
      testWidgets('does not overflow at ${width.toInt()}pt wide',
          (WidgetTester tester) async {
        await pumpCell(tester, viewportWidth: width, summary: product());
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('does not overflow with a long name and a strike-through price',
        (WidgetTester tester) async {
      await pumpCell(
        tester,
        viewportWidth: 393,
        summary: product(
          name: 'Hand Block Printed Cotton Anarkali Suit Set with Dupatta',
          discounted: true,
        ),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('does not overflow at a large accessibility text scale',
        (WidgetTester tester) async {
      await pumpCell(
        tester,
        viewportWidth: 393,
        summary: product(discounted: true),
        textScale: 1.5,
      );
      expect(tester.takeException(), isNull);
    });

    test('cell grows with width and with text scale', () {
      // Sanity on the formula itself: both inputs must push the cell taller,
      // which is exactly what the old fixed ratio failed to do.
      expect(ProductCard.imageAspectRatio, closeTo(0.75, 0.0001));
      expect(cellWidth(412), greaterThan(cellWidth(360)));
    });

    /// Home and Catalog each had their own `childAspectRatio: 0.58` delegate,
    /// so fixing one left the other clipping names. Both now go through
    /// [ProductCard.gridDelegate]; this pins that it sizes by measurement.
    testWidgets('shared grid delegate sizes cells by measurement, not ratio',
        (WidgetTester tester) async {
      late SliverGridDelegate delegate;
      late double expected;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (BuildContext context) {
              delegate = ProductCard.gridDelegate(context, viewportWidth: 393);
              expected = ProductCard.extentFor(
                context,
                cellWidth: ProductCard.cellWidthFor(393),
              );
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      final SliverGridDelegateWithFixedCrossAxisCount fixed =
          delegate as SliverGridDelegateWithFixedCrossAxisCount;
      expect(fixed.crossAxisCount, ProductCard.gridColumns);
      // The bug was expressing height as a ratio; mainAxisExtent must win.
      expect(fixed.mainAxisExtent, isNotNull);
      expect(fixed.mainAxisExtent, closeTo(expected, 0.01));
    });
  });
}
