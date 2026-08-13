import 'package:intl/intl.dart';

/// Every monetary amount on the Adorini API is an **integer count of paise**
/// (1 rupee = 100 paise). Amounts are never floats on the wire — parsing them
/// as doubles would reintroduce the rounding errors the integer representation
/// exists to prevent.
///
/// Keep values in paise all the way through the app and convert only when
/// rendering.
extension PaiseFormatting on int {
  /// `125000` → `₹1,250`. Drops the paise part, which Indian retail pricing
  /// never uses in practice.
  String get asRupees {
    final NumberFormat format = NumberFormat.currency(
      locale: 'en_IN',
      symbol: '₹',
      decimalDigits: 0,
    );
    return format.format(this / 100);
  }

  /// `125050` → `₹1,250.50`. Use where exact paise matter, e.g. a wallet ledger.
  String get asRupeesExact {
    final NumberFormat format = NumberFormat.currency(
      locale: 'en_IN',
      symbol: '₹',
      decimalDigits: 2,
    );
    return format.format(this / 100);
  }

  /// Signed form for wallet entries, which arrive already signed
  /// (credits positive, debits negative).
  String get asSignedRupees => this >= 0 ? '+$asRupees' : '-${(-this).asRupees}';
}
