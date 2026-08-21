import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/network/dio_client.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/login_screen.dart';
import 'features/products/add_product_screen.dart';
import 'features/products/admin_catalog_api.dart';

void main() {
  runApp(const ProviderScope(child: AdorniAdminApp()));
}

class AdorniAdminApp extends StatelessWidget {
  const AdorniAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Adorini Admin',
      // Same design system as the buyer app (Adorini_Frontend) — this is
      // staff tooling for the same product, not a separate brand.
      theme: AppTheme.light,
      home: const _StartupGate(),
    );
  }
}

/// On launch, tries to use a stored token straight away rather than always
/// forcing a fresh login — the same `assertAdmin` probe the login screen
/// uses, since a token being present says nothing about whether it is still
/// valid or still belongs to an admin.
class _StartupGate extends ConsumerStatefulWidget {
  const _StartupGate();

  @override
  ConsumerState<_StartupGate> createState() => _StartupGateState();
}

class _StartupGateState extends ConsumerState<_StartupGate> {
  late final Future<bool> _checkFuture = _checkExistingSession();

  Future<bool> _checkExistingSession() async {
    final String? token = await ref.read(tokenStorageProvider).readAccessToken();
    if (token == null) return false;

    try {
      await AdminCatalogApi(ref.read(dioProvider)).assertAdmin();
      return true;
    } on DioException {
      await ref.read(tokenStorageProvider).clear();
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _checkFuture,
      builder: (BuildContext context, AsyncSnapshot<bool> snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        return snapshot.data == true ? const AddProductScreen() : const LoginScreen();
      },
    );
  }
}
