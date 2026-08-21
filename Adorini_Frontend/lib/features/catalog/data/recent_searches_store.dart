import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Recently searched terms, most recent first.
///
/// Device-local on purpose. A search history is a browsing habit rather than
/// account data, it is worthless on another device, and syncing it would mean
/// shipping every shopper's queries to the server for no feature they asked
/// for. `SharedPreferences`, not `flutter_secure_storage`: these are not
/// secrets, and the secure store is slower per read.
class RecentSearchesStore {
  const RecentSearchesStore();

  static const String _key = 'recent_searches';

  /// Beyond this the list stops being "recent" and becomes a log the shopper
  /// has to read. Eight fills the empty state without needing to scroll.
  static const int maxEntries = 8;

  Future<List<String>> read() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_key) ?? <String>[];
  }

  /// Adds [term] at the head, removing any earlier occurrence first so that
  /// repeating a search moves it up rather than listing it twice.
  Future<List<String>> add(String term) async {
    final String trimmed = term.trim();
    if (trimmed.isEmpty) return read();

    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final List<String> current = prefs.getStringList(_key) ?? <String>[];
    // Case-insensitive de-dupe: "Kurti" and "kurti" are the same search, and
    // showing both would waste two of eight slots on one term.
    current.removeWhere(
      (String existing) => existing.toLowerCase() == trimmed.toLowerCase(),
    );
    final List<String> next = <String>[trimmed, ...current].take(maxEntries).toList();
    await prefs.setStringList(_key, next);
    return next;
  }

  Future<List<String>> remove(String term) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final List<String> current = prefs.getStringList(_key) ?? <String>[];
    current.remove(term);
    await prefs.setStringList(_key, current);
    return current;
  }

  Future<void> clear() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}

final Provider<RecentSearchesStore> recentSearchesStoreProvider =
    Provider<RecentSearchesStore>((Ref ref) => const RecentSearchesStore());

/// The list the search page renders.
///
/// An [AsyncNotifier] rather than a [FutureProvider] because the page both
/// reads and writes it: every mutation returns the new list from the store, so
/// the UI never guesses at what was persisted.
final AsyncNotifierProvider<RecentSearchesController, List<String>>
    recentSearchesProvider =
    AsyncNotifierProvider<RecentSearchesController, List<String>>(
  RecentSearchesController.new,
);

class RecentSearchesController extends AsyncNotifier<List<String>> {
  RecentSearchesStore get _store => ref.read(recentSearchesStoreProvider);

  @override
  Future<List<String>> build() => _store.read();

  Future<void> add(String term) async {
    state = AsyncData<List<String>>(await _store.add(term));
  }

  Future<void> remove(String term) async {
    state = AsyncData<List<String>>(await _store.remove(term));
  }

  Future<void> clear() async {
    await _store.clear();
    state = const AsyncData<List<String>>(<String>[]);
  }
}
