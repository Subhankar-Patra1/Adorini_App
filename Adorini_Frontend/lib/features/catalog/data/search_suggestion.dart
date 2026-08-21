import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/network/dio_client.dart';

/// What a suggestion points at, which decides what tapping it does.
enum SuggestionKind { category, brand, product }

/// One row in the type-ahead list.
class SearchSuggestion {
  const SearchSuggestion({
    required this.kind,
    required this.label,
    required this.slug,
  });

  factory SearchSuggestion.fromJson(Map<String, dynamic> json) {
    return SearchSuggestion(
      kind: switch (json['kind'] as String) {
        'CATEGORY' => SuggestionKind.category,
        'BRAND' => SuggestionKind.brand,
        _ => SuggestionKind.product,
      },
      label: json['label'] as String,
      slug: json['slug'] as String,
    );
  }

  final SuggestionKind kind;
  final String label;
  final String slug;
}

class SearchSuggestionApi {
  const SearchSuggestionApi(this._dio);

  final Dio _dio;

  Future<List<SearchSuggestion>> suggest(String query) async {
    final Response<Map<String, dynamic>> response =
        await _dio.get<Map<String, dynamic>>(
      ApiConstants.suggest,
      queryParameters: <String, dynamic>{'q': query},
    );
    final List<dynamic> items = response.data?['items'] as List<dynamic>? ?? <dynamic>[];
    return items
        .map((dynamic e) => SearchSuggestion.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final Provider<SearchSuggestionApi> searchSuggestionApiProvider =
    Provider<SearchSuggestionApi>(
  (Ref ref) => SearchSuggestionApi(ref.watch(dioProvider)),
);

/// Suggestions for the term currently in the search box.
///
/// Family-keyed on the query so Riverpod caches per term: backspacing from
/// "kurti" to "kurt" reuses the earlier response instead of re-fetching a list
/// the shopper saw two keystrokes ago.
final AutoDisposeFutureProviderFamily<List<SearchSuggestion>, String>
    searchSuggestionsProvider =
    FutureProvider.autoDispose.family<List<SearchSuggestion>, String>(
  (Ref ref, String query) async {
    final String trimmed = query.trim();
    if (trimmed.length < 2) return const <SearchSuggestion>[];
    return ref.watch(searchSuggestionApiProvider).suggest(trimmed);
  },
);
