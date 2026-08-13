import 'package:cached_network_image/cached_network_image.dart';
import 'package:chewie/chewie.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/utils/money.dart';
import '../../data/videos_api.dart';
import '../../domain/videos_providers.dart';

class VideoFeedScreen extends ConsumerStatefulWidget {
  const VideoFeedScreen({super.key});

  @override
  ConsumerState<VideoFeedScreen> createState() => _VideoFeedScreenState();
}

class _VideoFeedScreenState extends ConsumerState<VideoFeedScreen> {
  int _currentPage = 0;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<VideoFeedItem>> feed = ref.watch(videoFeedProvider);

    return Scaffold(
      backgroundColor: Colors.black,
      body: feed.when(
        data: (List<VideoFeedItem> videos) {
          if (videos.isEmpty) {
            return const Center(
              child: Text('No reels yet.', style: TextStyle(color: Colors.white)),
            );
          }
          return PageView.builder(
            scrollDirection: Axis.vertical,
            itemCount: videos.length,
            onPageChanged: (int index) {
              setState(() => _currentPage = index);
              // Pull the next cursor page as the viewer nears the end.
              if (index >= videos.length - 3) {
                ref.read(videoFeedProvider.notifier).loadMore();
              }
            },
            itemBuilder: (BuildContext context, int index) => _Reel(
              video: videos[index],
              // Only the visible reel plays — every controller playing at once
              // would saturate the network and the decoder.
              isActive: index == _currentPage,
            ),
          );
        },
        error: (Object error, StackTrace stackTrace) => Center(
          child: Text(
            'Failed to load reels: $error',
            style: const TextStyle(color: Colors.white),
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}

class _Reel extends StatefulWidget {
  const _Reel({required this.video, required this.isActive});

  final VideoFeedItem video;
  final bool isActive;

  @override
  State<_Reel> createState() => _ReelState();
}

class _ReelState extends State<_Reel> {
  VideoPlayerController? _videoController;
  ChewieController? _chewieController;

  @override
  void initState() {
    super.initState();
    if (widget.isActive) _initialise();
  }

  @override
  void didUpdateWidget(_Reel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isActive && _videoController == null) {
      _initialise();
    } else if (!widget.isActive && _videoController != null) {
      _disposeControllers();
      setState(() {});
    }
  }

  Future<void> _initialise() async {
    final VideoPlayerController controller =
        VideoPlayerController.networkUrl(Uri.parse(widget.video.url));
    _videoController = controller;
    await controller.initialize();
    if (!mounted) {
      controller.dispose();
      return;
    }
    setState(() {
      _chewieController = ChewieController(
        videoPlayerController: controller,
        autoPlay: true,
        looping: true,
        showControls: false,
      );
    });
  }

  void _disposeControllers() {
    _chewieController?.dispose();
    _videoController?.dispose();
    _chewieController = null;
    _videoController = null;
  }

  @override
  void dispose() {
    _disposeControllers();
    super.dispose();
  }

  void _showShopLook(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.containerMargin),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('Shop this look', style: AppTypography.titleMd),
              const SizedBox(height: AppSpacing.sm),
              ...widget.video.taggedProducts.map(
                (TaggedProduct product) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: product.thumbnailUrl == null
                      ? null
                      : ClipRRect(
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                          child: CachedNetworkImage(
                            imageUrl: product.thumbnailUrl!,
                            width: 48,
                            height: 60,
                            fit: BoxFit.cover,
                          ),
                        ),
                  title: Text(product.name),
                  subtitle: Text(product.pricePaise.asRupees),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    context.push('/catalog/product/${product.slug}');
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool ready = _chewieController != null &&
        (_videoController?.value.isInitialized ?? false);

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        // The thumbnail holds the frame until the video is ready, so scrolling
        // never lands on a black rectangle.
        if (widget.video.thumbnailUrl != null)
          CachedNetworkImage(imageUrl: widget.video.thumbnailUrl!, fit: BoxFit.cover),
        if (ready) Chewie(controller: _chewieController!),
        if (!ready) const Center(child: CircularProgressIndicator()),
        Positioned(
          left: AppSpacing.containerMargin,
          right: AppSpacing.containerMargin,
          bottom: AppSpacing.xl,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: widget.video.caption == null
                    ? const SizedBox.shrink()
                    : Text(
                        widget.video.caption!,
                        style: const TextStyle(color: Colors.white),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
              ),
              if (widget.video.taggedProducts.isNotEmpty)
                ElevatedButton(
                  onPressed: () => _showShopLook(context),
                  child: const Text('SHOP LOOK'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
