import 'package:dio/dio.dart';

import '../../../core/constants/api_constants.dart';

/// A "shop this look" chip. Deliberately thinner than the catalog summary — a
/// feed scrolls fast and the chip only needs enough to render and link.
class TaggedProduct {
  const TaggedProduct({
    required this.id,
    required this.slug,
    required this.name,
    required this.pricePaise,
    this.thumbnailUrl,
  });

  factory TaggedProduct.fromJson(Map<String, dynamic> json) {
    return TaggedProduct(
      id: json['id'] as String,
      slug: json['slug'] as String,
      name: json['name'] as String,
      pricePaise: json['pricePaise'] as int,
      thumbnailUrl: json['thumbnailUrl'] as String?,
    );
  }

  final String id;
  final String slug;
  final String name;
  final int pricePaise;
  final String? thumbnailUrl;
}

class VideoFeedItem {
  const VideoFeedItem({
    required this.id,
    required this.url,
    required this.taggedProducts,
    required this.createdAt,
    this.thumbnailUrl,
    this.caption,
  });

  factory VideoFeedItem.fromJson(Map<String, dynamic> json) {
    return VideoFeedItem(
      id: json['id'] as String,
      url: json['url'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      caption: json['caption'] as String?,
      taggedProducts: (json['taggedProducts'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => TaggedProduct.fromJson(e as Map<String, dynamic>))
          .toList(),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String url;
  final String? thumbnailUrl;
  final String? caption;
  final List<TaggedProduct> taggedProducts;
  final DateTime createdAt;
}

class VideoFeedPage {
  const VideoFeedPage({required this.items, this.nextCursor});

  factory VideoFeedPage.fromJson(Map<String, dynamic> json) {
    return VideoFeedPage(
      items: (json['items'] as List<dynamic>? ?? <dynamic>[])
          .map((dynamic e) => VideoFeedItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }

  final List<VideoFeedItem> items;
  final String? nextCursor;
}

class VideosApi {
  VideosApi(this._dio);

  final Dio _dio;

  /// Public — the feed is browsable signed-out. Max page size is 20.
  Future<VideoFeedPage> listFeed({String? cursor, int limit = 10}) async {
    final Response<Map<String, dynamic>> response = await _dio.get<Map<String, dynamic>>(
      ApiConstants.videos,
      queryParameters: <String, dynamic>{
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
    );
    return VideoFeedPage.fromJson(response.data!);
  }
}
