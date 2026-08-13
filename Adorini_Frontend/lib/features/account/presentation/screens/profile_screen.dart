import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../auth/data/auth_api.dart';
import '../../../auth/domain/auth_controller.dart';
import '../../domain/account_providers.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PublicUser> profile = ref.watch(userProfileProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.containerMargin),
        children: <Widget>[
          profile.when(
            data: (PublicUser user) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(user.displayName, style: AppTypography.headlineLgMobile),
                Text(
                  user.phone,
                  style: AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
                ),
                if (user.email != null)
                  Text(
                    user.email!,
                    style: AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
                  ),
              ],
            ),
            error: (Object e, StackTrace s) => Text('Could not load profile: $e'),
            loading: () => const Center(child: CircularProgressIndicator()),
          ),

          const SizedBox(height: AppSpacing.xl),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.receipt_long_outlined),
            title: const Text('My Orders'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/profile/orders'),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.assignment_return_outlined),
            title: const Text('Returns'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/profile/returns'),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.account_balance_wallet_outlined),
            title: const Text('Wallet & Referrals'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/profile/wallet'),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.chat_outlined),
            title: const Text('Chat with us on WhatsApp'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => launchUrl(
              Uri.parse('https://wa.me/'),
              mode: LaunchMode.externalApplication,
            ),
          ),

          const SizedBox(height: AppSpacing.xl),
          OutlinedButton(
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            child: const Text('LOG OUT'),
          ),
        ],
      ),
    );
  }
}
