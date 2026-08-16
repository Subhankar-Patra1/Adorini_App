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
      backgroundColor: AppColors.surfaceContainerLow,
      appBar: AppBar(
        backgroundColor: AppColors.surfaceContainerLow,
        leadingWidth: 48,
        titleSpacing: 0,
        leading: IconButton(
          tooltip: 'Back to home',
          onPressed: () => context.go('/home'),
          icon: const Icon(Icons.arrow_back),
        ),
        title: const Text('My Account'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.sm,
          AppSpacing.sm,
          AppSpacing.sm,
          104,
        ),
        children: <Widget>[
          _AccountHeader(profile: profile),
          const SizedBox(height: AppSpacing.lg),
          _QuickActions(
            onEditProfile: () => context.push('/profile/edit'),
            onUnavailable: (String label) => _showComingSoon(context, label),
          ),
          const SizedBox(height: AppSpacing.md),
          _AccountCard(
            children: <Widget>[
              _AccountRow(
                icon: Icons.receipt_long_outlined,
                label: 'My Orders',
                onTap: () => context.push('/profile/orders'),
              ),
              _AccountRow(
                icon: Icons.favorite_border,
                label: 'Wishlist',
                onTap: () => context.go('/wishlist'),
              ),
              _AccountRow(
                icon: Icons.assignment_return_outlined,
                label: 'Returns',
                onTap: () => context.push('/profile/returns'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _AccountCard(
            children: <Widget>[
              _AccountRow(
                icon: Icons.credit_card_outlined,
                label: 'Payment Details',
                onTap: () => _showComingSoon(context, 'Payment Details'),
              ),
              _AccountRow(
                icon: Icons.group_add_outlined,
                label: 'Referrals',
                onTap: () => context.push('/profile/wallet'),
              ),
              _AccountRow(
                icon: Icons.account_balance_wallet_outlined,
                label: 'Wallet',
                onTap: () => context.push('/profile/wallet'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _AccountCard(
            children: <Widget>[
              _AccountRow(
                icon: Icons.support_agent_outlined,
                label: 'Help Centre',
                onTap: () => launchUrl(
                  Uri.parse('https://wa.me/'),
                  mode: LaunchMode.externalApplication,
                ),
              ),
              _AccountRow(
                icon: Icons.settings_outlined,
                label: 'Settings',
                onTap: () => _showComingSoon(context, 'Settings'),
              ),
              _AccountRow(
                icon: Icons.notifications_none_outlined,
                label: 'Notifications',
                onTap: () => _showComingSoon(context, 'Notifications'),
              ),
              _AccountRow(
                icon: Icons.policy_outlined,
                label: 'Legal & Policies',
                onTap: () => _showComingSoon(context, 'Legal & Policies'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.errorContainer,
              foregroundColor: AppColors.error,
              elevation: 0,
            ),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout, size: 20),
            label: const Text('LOG OUT'),
          ),
        ],
      ),
    );
  }

  void _showComingSoon(BuildContext context, String feature) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text('$feature is coming soon.')));
  }
}

class _AccountHeader extends StatelessWidget {
  const _AccountHeader({required this.profile});

  final AsyncValue<PublicUser> profile;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 126,
      child: profile.when(
        data: (PublicUser user) => Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            CircleAvatar(
              radius: 38,
              backgroundColor: AppColors.primaryContainer,
              foregroundColor: AppColors.onPrimaryContainer,
              child: Text(
                _initials(user.displayName),
                style: AppTypography.titleMd.copyWith(
                  color: AppColors.onPrimaryContainer,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              user.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.titleMd,
            ),
          ],
        ),
        error: (Object error, StackTrace stackTrace) => Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Icon(Icons.account_circle_outlined,
                size: 64, color: AppColors.onSurfaceVariant),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Could not load your account',
              style: AppTypography.bodyMd
                  .copyWith(color: AppColors.onSurfaceVariant),
            ),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }

  String _initials(String name) {
    final List<String> words = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((String word) => word.isNotEmpty)
        .toList();
    if (words.isEmpty) return 'A';
    if (words.length == 1) return words.first.substring(0, 1).toUpperCase();
    return '${words.first[0]}${words.last[0]}'.toUpperCase();
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({
    required this.onEditProfile,
    required this.onUnavailable,
  });

  final VoidCallback onEditProfile;
  final ValueChanged<String> onUnavailable;

  @override
  Widget build(BuildContext context) {
    const List<({IconData icon, String label})> actions =
        <({IconData icon, String label})>[
      (icon: Icons.manage_accounts_outlined, label: 'Edit\nProfile'),
      (icon: Icons.location_on_outlined, label: 'Saved\nAddress'),
      (icon: Icons.currency_rupee, label: 'My\nRefunds'),
      (icon: Icons.star_border, label: 'Rate\nUs'),
    ];

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: actions
          .map(
            (({IconData icon, String label}) action) => Expanded(
              child: Padding(
                padding: EdgeInsets.only(
                  right: action == actions.last ? 0 : 6,
                ),
                child: _QuickAction(
                  icon: action.icon,
                  label: action.label,
                  onTap: action == actions.first
                      ? onEditProfile
                      : () => onUnavailable(
                            action.label.replaceAll('\n', ' '),
                          ),
                ),
              ),
            ),
          )
          .toList(),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.base,
            vertical: AppSpacing.base,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(icon, color: AppColors.primary, size: 20),
              const SizedBox(height: AppSpacing.xs),
              Text(
                label,
                textAlign: TextAlign.left,
                maxLines: 2,
                style: AppTypography.bodyMd.copyWith(
                  fontSize: 12,
                  height: 1.1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppColors.surfaceContainerLowest,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: List<Widget>.generate(children.length * 2 - 1, (int index) {
          if (index.isEven) return children[index ~/ 2];
          return const Divider(
            height: 0.5,
            thickness: 0.5,
            indent: AppSpacing.md,
            endIndent: AppSpacing.md,
            color: AppColors.divider,
          );
        }),
      ),
    );
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      minTileHeight: 48,
      dense: true,
      visualDensity: VisualDensity.compact,
      minVerticalPadding: 0,
      minLeadingWidth: 22,
      horizontalTitleGap: AppSpacing.sm,
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      leading: Icon(icon, size: 20, color: AppColors.onSurfaceVariant),
      title: Text(label, style: AppTypography.bodyMd),
      trailing: const Icon(
        Icons.chevron_right,
        size: 20,
        color: AppColors.onSurfaceVariant,
      ),
      onTap: onTap,
    );
  }
}
