import 'package:flutter_test/flutter_test.dart';

import 'package:adorini_frontend/core/utils/money.dart';

/// The backend sends every amount as an integer count of paise, and the app is
/// expected to keep it that way until render time. These tests pin the
/// conversion boundary — the one place a rounding bug could enter and quietly
/// misprice something.
void main() {
  group('asRupees', () {
    test('formats whole rupees with Indian digit grouping', () {
      // en_IN groups the last three digits, then in pairs: 12,50,000 not 1,250,000.
      expect(125000.asRupees, '₹1,250');
      expect(125000000.asRupees, '₹12,50,000');
    });

    test('drops the paise part, as Indian retail pricing does', () {
      expect(89999.asRupees, '₹900');
      expect(32900.asRupees, '₹329');
    });

    test('handles zero', () {
      expect(0.asRupees, '₹0');
    });
  });

  group('asRupeesExact', () {
    test('keeps paise where they matter, such as a wallet ledger', () {
      expect(125050.asRupeesExact, '₹1,250.50');
      expect(1.asRupeesExact, '₹0.01');
    });
  });

  group('asSignedRupees', () {
    test('marks credits and debits distinctly', () {
      expect(10000.asSignedRupees, '+₹100');
      expect((-10000).asSignedRupees, '-₹100');
    });

    test('treats zero as a credit rather than printing a bare minus', () {
      expect(0.asSignedRupees, '+₹0');
    });

    test('does not double-negate a debit', () {
      // The sign is applied by hand, so a negative reaching asRupees twice
      // would render "-₹-100".
      expect((-5000).asSignedRupees, '-₹50');
    });
  });
}
