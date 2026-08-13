/// Mirrors `Adorini_Backend/src/common/enums/domain.enums.ts`.
///
/// These are persisted as native PostgreSQL enum types on the server, so the
/// wire values are exact — renaming a member here without a backend migration
/// breaks parsing.
library;

enum OrderStatus {
  ordered('ORDERED', 'Ordered'),
  pendingVerification('PENDING_VERIFICATION', 'Awaiting confirmation'),
  confirmed('CONFIRMED', 'Confirmed'),
  shipped('SHIPPED', 'Shipped'),
  deliveryFailed('DELIVERY_FAILED', 'Delivery attempted'),
  delivered('DELIVERED', 'Delivered'),
  cancelled('CANCELLED', 'Cancelled');

  const OrderStatus(this.wire, this.label);

  final String wire;
  final String label;

  static OrderStatus fromWire(String value) =>
      OrderStatus.values.firstWhere((OrderStatus s) => s.wire == value, orElse: () => ordered);
}

enum PaymentMethod {
  cod('COD', 'Cash on delivery'),
  upi('UPI', 'UPI'),
  card('CARD', 'Card');

  const PaymentMethod(this.wire, this.label);

  final String wire;
  final String label;

  static PaymentMethod fromWire(String value) =>
      PaymentMethod.values.firstWhere((PaymentMethod m) => m.wire == value, orElse: () => cod);
}

enum PaymentStatus {
  pending('PENDING'),
  paid('PAID'),
  failed('FAILED'),
  refunded('REFUNDED');

  const PaymentStatus(this.wire);

  final String wire;

  static PaymentStatus fromWire(String value) =>
      PaymentStatus.values.firstWhere((PaymentStatus s) => s.wire == value, orElse: () => pending);
}

enum FabricType {
  stretch('STRETCH'),
  rigid('RIGID');

  const FabricType(this.wire);

  final String wire;

  static FabricType fromWire(String value) =>
      FabricType.values.firstWhere((FabricType f) => f.wire == value, orElse: () => rigid);
}

enum PrintTechnique {
  kalankari('KALANKARI', 'Kalankari'),
  ajrak('AJRAK', 'Ajrak'),
  batik('BATIK', 'Batik'),
  aplik('APLIK', 'Aplik'),
  fancy('FANCY', 'Fancy');

  const PrintTechnique(this.wire, this.label);

  final String wire;
  final String label;

  static PrintTechnique? fromWire(String? value) {
    if (value == null) return null;
    for (final PrintTechnique t in PrintTechnique.values) {
      if (t.wire == value) return t;
    }
    return null;
  }
}

enum MediaType {
  image('IMAGE'),
  video('VIDEO');

  const MediaType(this.wire);

  final String wire;

  static MediaType fromWire(String value) =>
      MediaType.values.firstWhere((MediaType t) => t.wire == value, orElse: () => image);
}

enum FitTag {
  runsSmall('RUNS_SMALL', 'Runs small'),
  trueToSize('TRUE_TO_SIZE', 'True to size'),
  runsLarge('RUNS_LARGE', 'Runs large');

  const FitTag(this.wire, this.label);

  final String wire;
  final String label;

  static FitTag? fromWire(String? value) {
    if (value == null) return null;
    for (final FitTag t in FitTag.values) {
      if (t.wire == value) return t;
    }
    return null;
  }
}

enum ReturnStatus {
  requested('REQUESTED', 'Requested'),
  approved('APPROVED', 'Approved'),
  rejected('REJECTED', 'Rejected'),
  completed('COMPLETED', 'Completed');

  const ReturnStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ReturnStatus fromWire(String value) =>
      ReturnStatus.values.firstWhere((ReturnStatus s) => s.wire == value, orElse: () => requested);
}

/// Closed list from `returns.dto.ts`. A sizing reason implies its fit tag
/// server-side, so the client never sends both.
enum ReturnReason {
  sizeTooSmall('SIZE_TOO_SMALL', 'Size too small'),
  sizeTooLarge('SIZE_TOO_LARGE', 'Size too large'),
  qualityNotAsExpected('QUALITY_NOT_AS_EXPECTED', 'Quality not as expected'),
  wrongItemReceived('WRONG_ITEM_RECEIVED', 'Wrong item received'),
  damagedOnArrival('DAMAGED_ON_ARRIVAL', 'Damaged on arrival'),
  colourDifferent('COLOUR_DIFFERENT', 'Colour different'),
  changedMyMind('CHANGED_MY_MIND', 'Changed my mind'),
  other('OTHER', 'Other');

  const ReturnReason(this.wire, this.label);

  final String wire;
  final String label;
}

enum WalletTransactionType {
  referralCredit('REFERRAL_CREDIT', 'Referral reward'),
  orderDebit('ORDER_DEBIT', 'Spent on order'),
  refundCredit('REFUND_CREDIT', 'Refund'),
  adminAdjustment('ADMIN_ADJUSTMENT', 'Adjustment');

  const WalletTransactionType(this.wire, this.label);

  final String wire;
  final String label;

  static WalletTransactionType fromWire(String value) => WalletTransactionType.values
      .firstWhere((WalletTransactionType t) => t.wire == value, orElse: () => adminAdjustment);
}

enum ReferralStatus {
  pending('PENDING', 'Pending'),
  credited('CREDITED', 'Credited'),
  isVoid('VOID', 'Void');

  const ReferralStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ReferralStatus fromWire(String value) =>
      ReferralStatus.values.firstWhere((ReferralStatus s) => s.wire == value, orElse: () => pending);
}

/// Catalog sort modes accepted by `/catalog/products`.
enum CatalogSort {
  newest('newest', 'Newest'),
  priceAsc('price_asc', 'Price: low to high'),
  priceDesc('price_desc', 'Price: high to low');

  const CatalogSort(this.wire, this.label);

  final String wire;
  final String label;
}

/// Why a referral was or was not recorded at OTP verification.
enum ReferralOutcome {
  applied('APPLIED'),
  notProvided('NOT_PROVIDED'),
  codeNotFound('CODE_NOT_FOUND'),
  alreadyReferred('ALREADY_REFERRED'),
  selfReferral('SELF_REFERRAL'),
  existingUser('EXISTING_USER'),
  unavailable('UNAVAILABLE');

  const ReferralOutcome(this.wire);

  final String wire;

  static ReferralOutcome fromWire(String value) => ReferralOutcome.values
      .firstWhere((ReferralOutcome o) => o.wire == value, orElse: () => notProvided);
}
