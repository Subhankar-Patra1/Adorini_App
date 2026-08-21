import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:adorini_admin/main.dart';

void main() {
  testWidgets('boots to the login screen with no stored session', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: AdorniAdminApp()));
    await tester.pumpAndSettle();

    expect(find.text('Adorini Admin'), findsOneWidget);
    expect(find.text('Phone number'), findsOneWidget);
  });
}
