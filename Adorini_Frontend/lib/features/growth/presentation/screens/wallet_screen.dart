import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/wallet_api.dart';
import '../../domain/wallet_providers.dart';

class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  Future<void> _shareReferral(BuildContext context, String code) async {
    final Uri uri = Uri.parse(
      'https://wa.me/?text=${Uri.encodeComponent(
        'Shop beautiful ethnic wear on Adorini — use my code $code for a discount on your first order!',
      )}',
    );
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Could not open WhatsApp')));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WalletBalance> balance = ref.watch(walletBalanceProvider);
    final AsyncValue<List<WalletEntry>> transactions = ref.watch(walletTransactionsProvider);
    final AsyncValue<String> referralCode = ref.watch(referralCodeProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Wallet & Referrals')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.containerMargin),
        children: <Widget>[
          balance.when(
            data: (WalletBalance data) => Card(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Store credit', style: AppTypography.labelBold),
                    const SizedBox(height: AppSpacing.xs),
                    Text(data.balancePaise.asRupees, style: AppTypography.displayLg),
                    // Shown apart from the spendable balance so a pending
                    // referral reward never looks like money available today.
                    if (data.pendingReferralCreditPaise > 0) ...<Widget>[
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        '${data.pendingReferralCreditPaise.asRupees} pending — '
                        'released once your friend’s first order is delivered.',
                        style: AppTypography.bodyMd
                            .copyWith(color: AppColors.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            error: (Object e, StackTrace s) => Text('Could not load balance: $e'),
            loading: () => const Center(child: CircularProgressIndicator()),
          ),

          const SizedBox(height: AppSpacing.md),
          referralCode.when(
            data: (String code) => Card(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Your referral code', style: AppTypography.labelBold),
                    const SizedBox(height: AppSpacing.xs),
                    Row(
                      children: <Widget>[
                        Text(code, style: AppTypography.headlineLgMobile),
                        IconButton(
                          icon: const Icon(Icons.copy, size: 18),
                          onPressed: () {
                            Clipboard.setData(ClipboardData(text: code));
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Code copied')),
                            );
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'Your friend enters this when they sign up. Codes only apply '
                      'to new accounts, and the reward lands once their first order '
                      'is delivered.',
                      style: AppTypography.bodyMd.copyWith(color: AppColors.onSurfaceVariant),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    ElevatedButton(
                      onPressed: () => _shareReferral(context, code),
                      child: const Text('SHARE ON WHATSAPP'),
                    ),
                  ],
                ),
              ),
            ),
            error: (Object e, StackTrace s) => const SizedBox.shrink(),
            loading: () => const SizedBox.shrink(),
          ),

          const SizedBox(height: AppSpacing.xl),
          Text('Statement', style: AppTypography.titleMd),
          const SizedBox(height: AppSpacing.xs),
          transactions.when(
            data: (List<WalletEntry> entries) {
              if (entries.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                  child: Text('No wallet activity yet.'),
                );
              }
              return Column(
                children: entries
                    .map((WalletEntry tx) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(tx.description ?? tx.type.label),
                          subtitle: Text(DateFormat.yMMMd().format(tx.createdAt)),
                          trailing: Text(
                            tx.amountPaise.asSignedRupees,
                            style: AppTypography.bodyMd.copyWith(
                              fontWeight: FontWeight.bold,
                              color: tx.isCredit
                                  ? AppColors.primary
                                  : Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ))
                    .toList(),
              );
            },
            error: (Object e, StackTrace s) => Text('Could not load statement: $e'),
            loading: () => const Center(child: CircularProgressIndicator()),
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
      ),
    );
  }
}
