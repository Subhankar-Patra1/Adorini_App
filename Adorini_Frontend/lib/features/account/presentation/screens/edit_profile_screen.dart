import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../auth/data/auth_api.dart';
import '../../../checkout/data/checkout_api.dart';
import '../../../checkout/domain/checkout_providers.dart';
import '../../domain/account_providers.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

enum _SaveStatus { save, saving, saved }

class _EditProfileScreenState extends ConsumerState<EditProfileScreen>
    with WidgetsBindingObserver {
  static const String _birthdayPreferenceKeyPrefix = 'profile_birthday';
  static const List<String> _indianStates = <String>[
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
    'Andaman and Nicobar Islands',
    'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi',
    'Jammu and Kashmir',
    'Ladakh',
    'Lakshadweep',
    'Puducherry',
  ];

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _firstNameController = TextEditingController();
  final TextEditingController _lastNameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _pincodeController = TextEditingController();
  final TextEditingController _cityController = TextEditingController();
  final ImagePicker _imagePicker = ImagePicker();

  PublicUser? _user;
  Address? _defaultAddress;
  Uint8List? _selectedPhoto;
  String? _gender;
  String? _state;
  DateTime? _birthday;
  bool _isLoading = true;
  _SaveStatus _saveStatus = _SaveStatus.save;
  int _editVersion = 0;
  bool _isUploadingPhoto = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _firstNameController.addListener(_markDirty);
    _lastNameController.addListener(_markDirty);
    _emailController.addListener(_markDirty);
    _pincodeController.addListener(_markDirty);
    _cityController.addListener(_markDirty);
    _loadProfile();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _pincodeController.dispose();
    _cityController.dispose();
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    final views = WidgetsBinding.instance.platformDispatcher.views;
    if (views.isNotEmpty && views.first.viewInsets.bottom == 0) {
      FocusManager.instance.primaryFocus?.unfocus();
    }
  }

  void _markDirty() {
    if (_isLoading) return;
    _editVersion++;
    if (_saveStatus != _SaveStatus.saving && _saveStatus != _SaveStatus.save) {
      setState(() => _saveStatus = _SaveStatus.save);
    }
  }

  Future<void> _loadProfile() async {
    try {
      final (PublicUser user, List<Address> addresses) = await (
        ref.read(userProfileProvider.future),
        ref.read(addressListProvider.future),
      ).wait;
      if (!mounted) return;

      final List<String> nameParts = user.fullName?.trim().isNotEmpty == true
          ? user.fullName!.trim().split(RegExp(r'\s+'))
          : <String>[];
      final Address? defaultAddress = _findDefaultAddress(addresses);
      setState(() {
        _user = user;
        _defaultAddress = defaultAddress;
        _firstNameController.text = nameParts.isEmpty ? '' : nameParts.first;
        _lastNameController.text =
            nameParts.length > 1 ? nameParts.skip(1).join(' ') : '';
        _emailController.text = user.email ?? '';
        _gender = _normaliseGender(user.gender);
        if (defaultAddress != null) {
          _pincodeController.text = defaultAddress.pincode;
          _cityController.text = defaultAddress.city;
          _state = defaultAddress.state;
        }
        _isLoading = false;
      });
      await _loadBirthday(user.id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      _showMessage('Could not load your profile. Please try again.');
    }
  }

  Address? _findDefaultAddress(List<Address> addresses) {
    if (addresses.isEmpty) return null;
    for (final Address address in addresses) {
      if (address.isDefault) return address;
    }
    return addresses.first;
  }

  String? _normaliseGender(String? gender) {
    if (gender == null) return null;
    if (gender.toLowerCase() == 'male') return 'Male';
    if (gender.toLowerCase() == 'female') return 'Female';
    return null;
  }

  String _birthdayPreferenceKey(String userId) =>
      '$_birthdayPreferenceKeyPrefix:$userId';

  Future<void> _loadBirthday(String userId) async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    final DateTime? saved = DateTime.tryParse(
      preferences.getString(_birthdayPreferenceKey(userId)) ?? '',
    );
    if (!mounted || saved == null) return;
    setState(() => _birthday = saved);
  }

  Future<void> _openBirthdaySheet() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final DateTime now = DateTime.now();
    final DateTime initialDate = _birthday ?? DateTime(2000, 1, 1);
    final DateTime? selected = await showModalBottomSheet<DateTime>(
      context: context,
      useSafeArea: true,
      requestFocus: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) => _SmoothDismissibleBirthdaySheet(
        child: _BirthdayPickerSheet(
          initialDate: initialDate,
          minimumYear: 1820,
          maximumYear: now.year,
        ),
      ),
    );
    if (!mounted) return;
    FocusManager.instance.primaryFocus?.unfocus();
    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
      if (mounted) FocusManager.instance.primaryFocus?.unfocus();
    });
    if (selected == null || _user == null) return;

    final SharedPreferences preferences = await SharedPreferences.getInstance();
    await preferences.setString(
      _birthdayPreferenceKey(_user!.id),
      selected.toIso8601String(),
    );
    if (!mounted) return;
    setState(() {
      _birthday = selected;
      _editVersion++;
      _saveStatus = _SaveStatus.save;
    });
    _showMessage('Birthday saved on this device.');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceContainerLow,
      appBar: AppBar(
        backgroundColor: AppColors.surfaceContainerLow,
        leadingWidth: 48,
        titleSpacing: 0,
        title: const Text('Edit Profile'),
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.sm),
            child: Center(
              child: _SavePill(
                status: _saveStatus,
                enabled: !_isLoading,
                onPressed: _saveProfile,
              ),
            ),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.sm,
                  AppSpacing.sm,
                  AppSpacing.sm,
                  AppSpacing.lg,
                ),
                children: <Widget>[
                  _buildPhotoSection(),
                  const SizedBox(height: AppSpacing.md),
                  _NameSection(
                    firstNameController: _firstNameController,
                    lastNameController: _lastNameController,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  _InfoSection(
                    phone: _user?.phone ?? '',
                    emailController: _emailController,
                    gender: _gender,
                    birthdayLabel: _birthday == null
                        ? 'Add Birthday'
                        : DateFormat('dd MMMM yyyy').format(_birthday!),
                    emailValidator: _validateEmail,
                    onGenderChanged: (String? value) {
                      setState(() => _gender = value);
                      _markDirty();
                    },
                    onPhoneTap: () => _showMessage(
                      'Phone-number changes will use a separate OTP verification flow.',
                    ),
                    onBirthdayTap: _openBirthdaySheet,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  _ProfileSection(
                    title: 'Address',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (_defaultAddress == null)
                          Padding(
                            padding:
                                const EdgeInsets.only(bottom: AppSpacing.sm),
                            child: Text(
                              'Add a saved address first to edit delivery details here.',
                              style: AppTypography.bodyMd.copyWith(
                                fontSize: 13,
                                color: AppColors.onSurfaceVariant,
                              ),
                            ),
                          ),
                        _ProfileTextField(
                          controller: _pincodeController,
                          label: 'Pincode',
                          icon: Icons.pin_drop_outlined,
                          enabled: _defaultAddress != null,
                          keyboardType: TextInputType.number,
                          textInputAction: TextInputAction.next,
                          maxLength: 6,
                          validator: _defaultAddress == null
                              ? null
                              : (String? value) => RegExp(r'^[1-9][0-9]{5}$')
                                      .hasMatch(value?.trim() ?? '')
                                  ? null
                                  : 'Enter a valid 6-digit PIN code',
                        ),
                        _ProfileTextField(
                          controller: _cityController,
                          label: 'City',
                          icon: Icons.location_city_outlined,
                          enabled: _defaultAddress != null,
                          textInputAction: TextInputAction.next,
                          validator: _defaultAddress == null
                              ? null
                              : (String? value) =>
                                  value == null || value.trim().isEmpty
                                      ? 'Enter your city'
                                      : null,
                        ),
                        _ProfileDropdown(
                          icon: Icons.map_outlined,
                          label: 'State',
                          value: _state,
                          enabled: _defaultAddress != null,
                          items: _stateItems,
                          onChanged: (String? value) {
                            setState(() => _state = value);
                            _markDirty();
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  List<String> get _stateItems {
    if (_state == null || _indianStates.contains(_state)) return _indianStates;
    return <String>[_state!, ..._indianStates];
  }

  Widget _buildPhotoSection() {
    final String initials = _initials(_user?.displayName ?? 'A');
    return Center(
      child: Column(
        children: <Widget>[
          Stack(
            clipBehavior: Clip.none,
            children: <Widget>[
              CircleAvatar(
                radius: 44,
                backgroundColor: AppColors.primaryContainer,
                foregroundColor: AppColors.onPrimaryContainer,
                backgroundImage: _selectedPhoto == null
                    ? null
                    : MemoryImage(_selectedPhoto!),
                child: _selectedPhoto != null
                    ? null
                    : Text(
                        initials,
                        style: AppTypography.bodyMdBold.copyWith(
                          color: AppColors.onPrimaryContainer,
                        ),
                      ),
              ),
              Positioned(
                right: -2,
                bottom: -2,
                child: Material(
                  color: AppColors.primary,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: _isUploadingPhoto ? null : _choosePhotoSource,
                    child: SizedBox.square(
                      dimension: 34,
                      child: _isUploadingPhoto
                          ? const Padding(
                              padding: EdgeInsets.all(8),
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.onPrimary,
                              ),
                            )
                          : const Icon(
                              Icons.camera_alt_outlined,
                              size: 18,
                              color: AppColors.onPrimary,
                            ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          TextButton(
            onPressed: _isUploadingPhoto ? null : _choosePhotoSource,
            child: Text('Change Photo', style: AppTypography.bodyMd),
          ),
        ],
      ),
    );
  }

  String _initials(String name) {
    final List<String> words = name.trim().split(RegExp(r'\s+'));
    if (words.length == 1) return words.first.substring(0, 1).toUpperCase();
    return '${words.first[0]}${words.last[0]}'.toUpperCase();
  }

  Future<void> _choosePhotoSource() async {
    final ImageSource? source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.surfaceContainerLowest,
      showDragHandle: true,
      builder: (BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text('Choose a photo', style: AppTypography.titleMd),
              const SizedBox(height: AppSpacing.base),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Gallery'),
                onTap: () => Navigator.pop(context, ImageSource.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined),
                title: const Text('Camera'),
                onTap: () => Navigator.pop(context, ImageSource.camera),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null) return;

    final XFile? file = await _imagePicker.pickImage(
      source: source,
      imageQuality: 85,
      maxWidth: 1200,
    );
    if (file == null || !mounted) return;

    final Uint8List bytes = await file.readAsBytes();
    setState(() {
      _selectedPhoto = bytes;
      _isUploadingPhoto = true;
    });
    try {
      final PublicUser user = await ref.read(accountApiProvider).uploadAvatar(
            bytes: bytes,
            filename: file.name,
            mimeType: file.mimeType ?? _mimeTypeFor(file.name),
          );
      ref.invalidate(userProfileProvider);
      if (!mounted) return;
      setState(() {
        _user = user;
        _isUploadingPhoto = false;
      });
      _showMessage('Profile photo updated.');
    } on DioException catch (error) {
      if (!mounted) return;
      setState(() => _isUploadingPhoto = false);
      _showMessage(apiErrorMessage(error));
    }
  }

  String _mimeTypeFor(String filename) {
    final String lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  String? _validateEmail(String? value) {
    final String email = value?.trim() ?? '';
    if (email.isEmpty) return null;
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      return 'Enter a valid email address';
    }
    return null;
  }

  Future<void> _saveProfile() async {
    if (_saveStatus != _SaveStatus.save) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final int savingVersion = _editVersion;
    setState(() => _saveStatus = _SaveStatus.saving);
    try {
      final String fullName = <String>[
        _firstNameController.text.trim(),
        _lastNameController.text.trim(),
      ].where((String part) => part.isNotEmpty).join(' ');
      final String email = _emailController.text.trim();
      final PublicUser user = await ref.read(accountApiProvider).updateProfile(
            fullName: fullName,
            email: email.isEmpty ? null : email,
            clearEmail: email.isEmpty,
            gender: _gender,
          );

      final Address? address = _defaultAddress;
      if (address != null) {
        await ref.read(checkoutApiProvider).updateAddress(
              id: address.id,
              pincode: _pincodeController.text.trim(),
              city: _cityController.text.trim(),
              state: _state,
            );
      }
      ref
        ..invalidate(userProfileProvider)
        ..invalidate(addressListProvider);
      if (!mounted) return;
      setState(() {
        _user = user;
        _saveStatus = savingVersion == _editVersion
            ? _SaveStatus.saved
            : _SaveStatus.save;
      });
      _showMessage('Your profile has been updated.');
    } on DioException catch (error) {
      if (!mounted) return;
      setState(() => _saveStatus = _SaveStatus.save);
      _showMessage(apiErrorMessage(error));
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

class _SavePill extends StatelessWidget {
  const _SavePill({
    required this.status,
    required this.enabled,
    required this.onPressed,
  });

  final _SaveStatus status;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final String label = switch (status) {
      _SaveStatus.save => 'Save',
      _SaveStatus.saving => 'Saving',
      _SaveStatus.saved => 'Saved',
    };
    final bool canPress = enabled && status == _SaveStatus.save;
    final Color backgroundColor = !enabled
        ? AppColors.surfaceContainerHighest
        : status == _SaveStatus.saved
            ? AppColors.primaryContainer
            : AppColors.primary;
    final Color foregroundColor = !enabled
        ? AppColors.onSurfaceVariant
        : status == _SaveStatus.saved
            ? AppColors.onPrimaryContainer
            : AppColors.onPrimary;

    return Material(
      color: backgroundColor,
      shape: const StadiumBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: canPress ? onPressed : null,
        child: SizedBox(
          width: 76,
          height: 34,
          child: Center(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: Text(
                label,
                key: ValueKey<_SaveStatus>(status),
                style: AppTypography.labelBold.copyWith(
                  color: foregroundColor,
                  letterSpacing: 0.2,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SmoothDismissibleBirthdaySheet extends StatefulWidget {
  const _SmoothDismissibleBirthdaySheet({required this.child});

  final Widget child;

  @override
  State<_SmoothDismissibleBirthdaySheet> createState() =>
      _SmoothDismissibleBirthdaySheetState();
}

class _SmoothDismissibleBirthdaySheetState
    extends State<_SmoothDismissibleBirthdaySheet> {
  static const Duration _settleDuration = Duration(milliseconds: 200);

  double _dragOffset = 0;
  bool _isDragging = false;
  bool _isDismissing = false;

  void _handleDragUpdate(DragUpdateDetails details) {
    if (_isDismissing) return;
    setState(() {
      _isDragging = true;
      _dragOffset = (_dragOffset + details.delta.dy).clamp(0, 600);
    });
  }

  Future<void> _handleDragEnd(DragEndDetails details) async {
    if (_isDismissing) return;
    final bool shouldDismiss =
        _dragOffset > 72 || (details.primaryVelocity ?? 0) > 650;
    setState(() {
      _isDragging = false;
      _isDismissing = shouldDismiss;
      _dragOffset = shouldDismiss ? MediaQuery.sizeOf(context).height : 0;
    });
    if (!shouldDismiss) return;
    await Future<void>.delayed(_settleDuration);
    if (!mounted) return;
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onVerticalDragUpdate: _handleDragUpdate,
      onVerticalDragEnd: _handleDragEnd,
      child: AnimatedContainer(
        duration: _isDragging ? Duration.zero : _settleDuration,
        curve: Curves.easeOutCubic,
        transform: Matrix4.translationValues(0, _dragOffset, 0),
        child: Material(
          color: AppColors.surfaceContainerLowest,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(AppRadius.card),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const SizedBox(height: AppSpacing.base),
              Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.outlineVariant,
                  borderRadius: BorderRadius.circular(AppRadius.full),
                ),
              ),
              widget.child,
            ],
          ),
        ),
      ),
    );
  }
}

class _BirthdayPickerSheet extends StatefulWidget {
  const _BirthdayPickerSheet({
    required this.initialDate,
    required this.minimumYear,
    required this.maximumYear,
  });

  final DateTime initialDate;
  final int minimumYear;
  final int maximumYear;

  @override
  State<_BirthdayPickerSheet> createState() => _BirthdayPickerSheetState();
}

class _BirthdayPickerSheetState extends State<_BirthdayPickerSheet> {
  static const List<String> _months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  late int _day;
  late int _month;
  late int _year;
  late FixedExtentScrollController _dayController;
  late FixedExtentScrollController _monthController;
  late FixedExtentScrollController _yearController;

  @override
  void initState() {
    super.initState();
    _year = widget.initialDate.year.clamp(
      widget.minimumYear,
      widget.maximumYear,
    );
    _month = widget.initialDate.month;
    _day = widget.initialDate.day.clamp(1, _daysInMonth(_year, _month));
    _dayController = FixedExtentScrollController(initialItem: _day - 1);
    _monthController = FixedExtentScrollController(initialItem: _month - 1);
    _yearController = FixedExtentScrollController(
      initialItem: _year - widget.minimumYear,
    );
  }

  @override
  void dispose() {
    _dayController.dispose();
    _monthController.dispose();
    _yearController.dispose();
    super.dispose();
  }

  int _daysInMonth(int year, int month) => DateTime(year, month + 1, 0).day;

  void _changeMonth(int index) {
    final int nextMonth = index + 1;
    final int maximumDay = _daysInMonth(_year, nextMonth);
    final bool needsClamp = _day > maximumDay;
    setState(() {
      _month = nextMonth;
      if (needsClamp) _day = maximumDay;
    });
    if (needsClamp) {
      _dayController.animateToItem(
        maximumDay - 1,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    }
  }

  void _changeYear(int index) {
    final int nextYear = widget.minimumYear + index;
    final int maximumDay = _daysInMonth(nextYear, _month);
    final bool needsClamp = _day > maximumDay;
    setState(() {
      _year = nextYear;
      if (needsClamp) _day = maximumDay;
    });
    if (needsClamp) {
      _dayController.animateToItem(
        maximumDay - 1,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final int dayCount = _daysInMonth(_year, _month);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Birthday',
            style: AppTypography.titleMd.copyWith(
              color: AppColors.primary,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: 190,
            child: Stack(
              alignment: Alignment.center,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      flex: 2,
                      child: CupertinoPicker.builder(
                        scrollController: _dayController,
                        itemExtent: 40,
                        diameterRatio: 1.45,
                        useMagnifier: true,
                        magnification: 1.08,
                        selectionOverlay: const SizedBox.shrink(),
                        childCount: dayCount,
                        onSelectedItemChanged: (int index) =>
                            setState(() => _day = index + 1),
                        itemBuilder: (BuildContext context, int index) =>
                            Center(
                          child: Text(
                            '${index + 1}',
                            style: AppTypography.bodyMd,
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 3,
                      child: CupertinoPicker.builder(
                        scrollController: _monthController,
                        itemExtent: 40,
                        diameterRatio: 1.45,
                        useMagnifier: true,
                        magnification: 1.08,
                        selectionOverlay: const SizedBox.shrink(),
                        childCount: _months.length,
                        onSelectedItemChanged: _changeMonth,
                        itemBuilder: (BuildContext context, int index) =>
                            Center(
                          child: Text(
                            _months[index],
                            style: AppTypography.bodyMd,
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 2,
                      child: CupertinoPicker.builder(
                        scrollController: _yearController,
                        itemExtent: 40,
                        diameterRatio: 1.45,
                        useMagnifier: true,
                        magnification: 1.08,
                        selectionOverlay: const SizedBox.shrink(),
                        childCount: widget.maximumYear - widget.minimumYear + 1,
                        onSelectedItemChanged: _changeYear,
                        itemBuilder: (BuildContext context, int index) =>
                            Center(
                          child: Text(
                            '${widget.minimumYear + index}',
                            style: AppTypography.bodyMd,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                IgnorePointer(
                  child: Container(
                    height: 40,
                    decoration: const BoxDecoration(
                      border: Border.symmetric(
                        horizontal: BorderSide(
                          color: AppColors.primaryContainer,
                          width: 1,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          ElevatedButton(
            onPressed: () => Navigator.pop(
              context,
              DateTime(_year, _month, _day),
            ),
            child: const Text('SAVE BIRTHDAY'),
          ),
        ],
      ),
    );
  }
}

class _ProfileSection extends StatelessWidget {
  const _ProfileSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(AppRadius.card),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.sm,
          AppSpacing.md,
          AppSpacing.md,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              title,
              style: AppTypography.titleMd.copyWith(
                fontSize: 17,
                height: 1.35,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            child,
          ],
        ),
      ),
    );
  }
}

class _NameSection extends StatelessWidget {
  const _NameSection({
    required this.firstNameController,
    required this.lastNameController,
  });

  final TextEditingController firstNameController;
  final TextEditingController lastNameController;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
      child: Padding(
        padding: const EdgeInsets.only(top: AppSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Text(
                'Your name',
                style: AppTypography.titleMd.copyWith(
                  fontSize: 15.5,
                  height: 1.3,
                  color: AppColors.primary,
                ),
              ),
            ),
            _NameField(
              controller: firstNameController,
              hintText: 'First name',
              textInputAction: TextInputAction.next,
              validator: (String? value) =>
                  value == null || value.trim().isEmpty
                      ? 'Enter your first name'
                      : null,
            ),
            const Divider(
              height: 0.5,
              thickness: 0.5,
              indent: AppSpacing.md,
              endIndent: AppSpacing.md,
              color: AppColors.divider,
            ),
            _NameField(
              controller: lastNameController,
              hintText: 'Last name',
              textInputAction: TextInputAction.done,
            ),
          ],
        ),
      ),
    );
  }
}

class _NameField extends StatelessWidget {
  const _NameField({
    required this.controller,
    required this.hintText,
    required this.textInputAction,
    this.validator,
  });

  final TextEditingController controller;
  final String hintText;
  final TextInputAction textInputAction;
  final FormFieldValidator<String>? validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      onTapOutside: (PointerDownEvent event) =>
          FocusScope.of(context).unfocus(),
      textInputAction: textInputAction,
      validator: validator,
      style: AppTypography.bodyMd,
      decoration: InputDecoration(
        hintText: hintText,
        hintStyle: AppTypography.bodyMd.copyWith(
          color: AppColors.onSurfaceVariant.withValues(alpha: 0.62),
        ),
        errorStyle: AppTypography.bodyMd.copyWith(
          fontSize: 12,
          color: AppColors.error,
        ),
        filled: false,
        isDense: true,
        contentPadding: const EdgeInsets.fromLTRB(
          AppSpacing.containerMargin,
          10,
          AppSpacing.md,
          10,
        ),
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        errorBorder: InputBorder.none,
        focusedErrorBorder: InputBorder.none,
      ),
    );
  }
}

class _ProfileTextField extends StatelessWidget {
  const _ProfileTextField({
    required this.controller,
    required this.label,
    this.icon,
    this.enabled = true,
    this.keyboardType,
    this.textInputAction,
    this.maxLength,
    this.validator,
  });

  final TextEditingController controller;
  final String label;
  final IconData? icon;
  final bool enabled;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final int? maxLength;
  final FormFieldValidator<String>? validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      onTapOutside: (PointerDownEvent event) =>
          FocusScope.of(context).unfocus(),
      enabled: enabled,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      maxLength: maxLength,
      validator: validator,
      style: AppTypography.bodyMd,
      decoration: _fieldDecoration(label: label, icon: icon).copyWith(
        counterText: '',
      ),
    );
  }
}

class _ProfileDropdown extends StatelessWidget {
  const _ProfileDropdown({
    required this.icon,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final String? value;
  final List<String> items;
  final ValueChanged<String?> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: _fieldDecoration(label: label, icon: icon),
      style: AppTypography.bodyMd,
      items: items
          .map(
            (String item) => DropdownMenuItem<String>(
              value: item,
              child: Text(item),
            ),
          )
          .toList(),
      onChanged: enabled ? onChanged : null,
    );
  }
}

class _InfoSection extends StatelessWidget {
  const _InfoSection({
    required this.phone,
    required this.emailController,
    required this.gender,
    required this.birthdayLabel,
    required this.emailValidator,
    required this.onGenderChanged,
    required this.onPhoneTap,
    required this.onBirthdayTap,
  });

  final String phone;
  final TextEditingController emailController;
  final String? gender;
  final String birthdayLabel;
  final FormFieldValidator<String> emailValidator;
  final ValueChanged<String?> onGenderChanged;
  final VoidCallback onPhoneTap;
  final VoidCallback onBirthdayTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(AppRadius.card),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.base),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Text(
                'Your Info',
                style: AppTypography.titleMd.copyWith(
                  fontSize: 15.5,
                  height: 1.3,
                  color: AppColors.primary,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            _InfoTapRow(
              icon: Icons.call,
              iconColor: const Color(0xFF39B94A),
              value: phone,
              helper: 'Tap to change phone number',
              onTap: onPhoneTap,
            ),
            const SizedBox(height: AppSpacing.xs),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: _InfoEmailRow(
                controller: emailController,
                validator: emailValidator,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            _InfoTapRow(
              icon: Icons.cake,
              iconColor: const Color(0xFF289BD3),
              value: birthdayLabel,
              onTap: onBirthdayTap,
            ),
            const SizedBox(height: AppSpacing.xs),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: _InfoGenderRow(
                value: gender,
                onChanged: onGenderChanged,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoTapRow extends StatelessWidget {
  const _InfoTapRow({
    required this.icon,
    required this.iconColor,
    required this.value,
    required this.onTap,
    this.helper,
  });

  final IconData icon;
  final Color iconColor;
  final String value;
  final String? helper;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 6,
        ),
        child: Row(
          children: <Widget>[
            _InfoIcon(icon: icon, color: iconColor),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    value,
                    style: AppTypography.bodyMd.copyWith(fontSize: 17),
                  ),
                  if (helper != null)
                    Text(
                      helper!,
                      style: AppTypography.bodyMd.copyWith(
                        fontSize: 12,
                        height: 1.2,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoEmailRow extends StatelessWidget {
  const _InfoEmailRow({required this.controller, required this.validator});

  final TextEditingController controller;
  final FormFieldValidator<String> validator;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        const _InfoIcon(
          icon: Icons.email_outlined,
          color: Color(0xFFEC9415),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: TextFormField(
            controller: controller,
            onTapOutside: (PointerDownEvent event) =>
                FocusScope.of(context).unfocus(),
            validator: validator,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            style: AppTypography.bodyMd.copyWith(fontSize: 17),
            decoration: InputDecoration(
              hintText: 'Email (optional)',
              hintStyle: AppTypography.bodyMd.copyWith(
                color: AppColors.onSurfaceVariant.withValues(alpha: 0.62),
              ),
              errorStyle: AppTypography.bodyMd.copyWith(
                fontSize: 11,
                color: AppColors.error,
              ),
              filled: false,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 8),
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              errorBorder: InputBorder.none,
              focusedErrorBorder: InputBorder.none,
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoGenderRow extends StatefulWidget {
  const _InfoGenderRow({required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  State<_InfoGenderRow> createState() => _InfoGenderRowState();
}

class _InfoGenderRowState extends State<_InfoGenderRow> {
  static const Duration _duration = Duration(milliseconds: 240);

  final GlobalKey _femaleOptionKey = GlobalKey();
  bool _isExpanded = false;

  Future<void> _toggle() async {
    FocusScope.of(context).unfocus();
    if (_isExpanded) {
      setState(() => _isExpanded = false);
      return;
    }

    setState(() => _isExpanded = true);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    if (!mounted) return;
    final BuildContext? femaleContext = _femaleOptionKey.currentContext;
    if (femaleContext == null || !femaleContext.mounted) return;
    await Scrollable.ensureVisible(
      femaleContext,
      alignment: 0.78,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _select(String gender) async {
    widget.onChanged(gender);
    await Future<void>.delayed(const Duration(milliseconds: 200));
    if (!mounted) return;
    setState(() => _isExpanded = false);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        GestureDetector(
          onTap: _toggle,
          behavior: HitTestBehavior.opaque,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: <Widget>[
                const _InfoIcon(
                  icon: Icons.person,
                  color: AppColors.primary,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Gender',
                    style: AppTypography.bodyMd.copyWith(fontSize: 17),
                  ),
                ),
                if (widget.value != null)
                  Text(
                    widget.value!,
                    style: AppTypography.bodyMd.copyWith(
                      fontSize: 14,
                      color: AppColors.primary,
                    ),
                  ),
                const SizedBox(width: AppSpacing.xs),
                AnimatedRotation(
                  turns: _isExpanded ? 0.25 : 0,
                  duration: _duration,
                  curve: Curves.easeOutCubic,
                  child: const Icon(
                    Icons.chevron_right,
                    size: 22,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        ClipRect(
          child: AnimatedAlign(
            duration: _duration,
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            heightFactor: _isExpanded ? 1 : 0,
            child: AnimatedOpacity(
              duration: _duration,
              curve: Curves.easeOut,
              opacity: _isExpanded ? 1 : 0,
              child: IgnorePointer(
                ignoring: !_isExpanded,
                child: Padding(
                  padding: const EdgeInsets.only(
                    left: 40,
                    right: AppSpacing.xs,
                    bottom: AppSpacing.xs,
                  ),
                  child: Column(
                    children: <Widget>[
                      _GenderOption(
                        label: 'Male',
                        selected: widget.value == 'Male',
                        onTap: () => _select('Male'),
                      ),
                      _GenderOption(
                        key: _femaleOptionKey,
                        label: 'Female',
                        selected: widget.value == 'Female',
                        onTap: () => _select('Female'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _GenderOption extends StatelessWidget {
  const _GenderOption({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.base,
          vertical: 9,
        ),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(
                label,
                style: AppTypography.bodyMd.copyWith(fontSize: 16),
              ),
            ),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: selected
                  ? const Icon(
                      Icons.check_circle,
                      key: ValueKey<String>('selected'),
                      size: 20,
                      color: AppColors.primary,
                    )
                  : const Icon(
                      Icons.circle_outlined,
                      key: ValueKey<String>('unselected'),
                      size: 20,
                      color: AppColors.outlineVariant,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoIcon extends StatelessWidget {
  const _InfoIcon({required this.icon, required this.color});

  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(7),
      ),
      child: SizedBox.square(
        dimension: 28,
        child: Icon(icon, size: 18, color: Colors.white),
      ),
    );
  }
}

InputDecoration _fieldDecoration({required String label, IconData? icon}) {
  const UnderlineInputBorder border = UnderlineInputBorder(
    borderSide: BorderSide(color: AppColors.divider, width: 0.5),
  );
  return InputDecoration(
    labelText: label,
    labelStyle: AppTypography.bodyMd.copyWith(
      fontSize: 14,
      color: AppColors.onSurfaceVariant,
    ),
    floatingLabelStyle: AppTypography.bodyMd.copyWith(
      fontSize: 14,
      color: AppColors.primary,
    ),
    errorStyle: AppTypography.bodyMd.copyWith(
      fontSize: 12,
      color: AppColors.error,
    ),
    prefixIcon:
        icon == null ? null : Icon(icon, size: 20, color: AppColors.primary),
    prefixIconConstraints: const BoxConstraints(minWidth: 34),
    filled: false,
    isDense: true,
    contentPadding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
    border: border,
    enabledBorder: border,
    disabledBorder: border,
    focusedBorder: const UnderlineInputBorder(
      borderSide: BorderSide(color: AppColors.primary, width: 1),
    ),
  );
}
