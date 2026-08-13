import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/dio_client.dart';
import '../data/videos_api.dart';

final Provider<VideosApi> videosApiProvider = Provider<VideosApi>(
  (Ref ref) => VideosApi(ref.watch(dioProvider)),
);

/// Accumulating cursor-paginated reels feed.
final AsyncNotifierProvider<VideoFeedController, List<VideoFeedItem>> videoFeedProvider =
    AsyncNotifierProvider<VideoFeedController, List<VideoFeedItem>>(VideoFeedController.new);

class VideoFeedController extends AsyncNotifier<List<VideoFeedItem>> {
  String? _nextCursor;
  bool _isLoadingMore = false;

  @override
  Future<List<VideoFeedItem>> build() async {
    final VideoFeedPage page = await ref.watch(videosApiProvider).listFeed();
    _nextCursor = page.nextCursor;
    return page.items;
  }

  /// Called as the viewer nears the end of the loaded reels.
  Future<void> loadMore() async {
    if (_isLoadingMore || _nextCursor == null) return;
    final List<VideoFeedItem>? current = state.value;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final VideoFeedPage page =
          await ref.read(videosApiProvider).listFeed(cursor: _nextCursor);
      _nextCursor = page.nextCursor;
      state = AsyncData<List<VideoFeedItem>>(<VideoFeedItem>[...current, ...page.items]);
    } finally {
      _isLoadingMore = false;
    }
  }
}
