# Adorini Flutter Frontend — Handoff

**Date:** 2026-08-14
**Repo:** `E:\PROJECTS\Adorini_App`
**Work area:** `Adorini_Frontend/` (Flutter). Backend `Adorini_Backend/` (NestJS) is complete and untouched.

---

## 1. Current state in one line

51 Dart files written implementing the full shopping app against the **real, verified** backend contract. **Nothing has been compiled or run** — Flutter is not installed in the authoring environment. Platform runner folders do not exist yet.

---

## 2. Do these three things first

```bash
cd E:\PROJECTS\Adorini_App\Adorini_Frontend

# 1. Generate android/ ios/ web/ runners (they do NOT exist; flutter run fails without them).
#    This does not overwrite lib/ or pubspec.yaml.
flutter create . --project-name adorini_frontend --platforms=android,ios

# 2. Resolve dependencies (every "Target of URI doesn't exist" error is just this).
flutter pub get

# 3. First real compile. Expect a handful of genuine errors — fix them.
flutter analyze
```

Run against a live backend with:
```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api   # Android emulator → host localhost
```

---

## 3. Backend contract — verified facts that drove every model

Read from `Adorini_Backend/src/modules/*/controllers/*.ts` and `*/dto/*.ts`. **These corrected an earlier draft that guessed wrong on nearly every point.**

| Fact | Detail |
|---|---|
| **Global prefix** | `/api`. **No `/v1`.** Do not add a version segment. |
| **Auth** | Custom `JwtAuthGuard` registered globally via `APP_GUARD` — every route is protected unless it carries `@Public()`. Bearer access token in `Authorization` header, 15-min expiry, single-use refresh tokens (reusing a rotated one revokes all sessions). |
| **Money** | **All amounts are integer paise** (`pricePaise`, `totalPaise`, `amountPaise`). Never floats. `lib/core/utils/money.dart` has the `int.asRupees` extension. |
| **Sizes** | **Numeric nominal sizes 40–48**, not S/M/L. Anything outside that band goes through the PDP size-enquiry form. |
| **Validation** | Zod via `nestjs-zod` throughout. Errors come back as `{ message }` (string or array). `lib/core/network/api_error.dart` parses this. |

### Route map (all relative to `/api`)

```
POST /auth/otp/request     { phone }                        → { expiresInSeconds, resendAfterSeconds }   202
POST /auth/otp/verify      { phone, otp, registrationToken?, referralCode? } → LoginResult
POST /auth/google          { idToken }                      → discriminated union on `status`:
                                                               AUTHENTICATED (=LoginResult) | PHONE_REQUIRED
POST /auth/refresh         { refreshToken }                 → { accessToken, refreshToken, expiresIn }
POST /auth/logout          { refreshToken }                 → 204   ← body required, and it is @Public()

GET  /catalog/categories                                    → Category[]   (bare array)
GET  /catalog/brands                                        → Brand[]
GET  /catalog/products     ?category&brand&fabricType&printTechnique&size&minPrice&maxPrice&q&sort&cursor&limit
                                                            → { items, nextCursor }   ← CURSOR, not offset

GET  /pdp/:slug                                             → ProductDetail   ← keyed by SLUG, not id
POST /pdp/:slug/size-enquiry { requestedSize, contactPhone, message? }   ← works signed-out

GET    /cart               ?walletCreditPaise&couponCode    → CartView
POST   /cart/items         { variantId, quantity }          → CartView   ← variantId, NOT productId
PATCH  /cart/items/:lineId { quantity?, variantId? }        → CartView
DELETE /cart/items/:lineId                                  → CartView
DELETE /cart                                                → CartView
   ⚠ Coupons are a QUERY PARAM on the GET. There is no POST /cart/coupon.
   ⚠ Every mutation returns the WHOLE cart, not the changed line.

GET  /checkout/quote       ?walletCreditPaise&couponCode    → CartView
POST /checkout/place       { addressId, paymentMethod, walletCreditPaise, couponCode? } → PlacedOrder
     ⚠ Body carries NO amounts — all totals derived server-side.
POST /checkout/orders/:id/verify-cod  { otp }               → { status }
POST /checkout/orders/:id/resend-cod                        → { expiresInSeconds }

GET  /orders               ?limit&offset                    → OrderSummary[]   ← BARE ARRAY, offset-paginated
GET  /orders/:id                                            → OrderDetail
     ⚠ There is NO /orders/:id/tracking. Tracking lives inside OrderDetail
       (delhiveryWaybill + shippedAt/deliveredAt/cancelledAt timestamps).
PATCH /orders/:id/address                                   → OrderDetail
POST  /orders/:id/cancel   { reason? }                      → OrderDetail
POST  /orders/:id/request-redelivery                        → OrderDetail

GET  /returns                                               → ReturnRequest[]
GET  /returns/orders/:orderId/eligible-items                → EligibleItem[]  (409 if not delivered)
POST /returns/orders/:orderId { orderItemId, quantity, reason, comment?, fitTag? } → ReturnRequest
     ⚠ Per ORDER ITEM, not per order. Closed reason enum. NO PHOTO UPLOAD on this endpoint.
     ⚠ A sizing reason derives its own fitTag server-side.

GET   /users/me                                             → PublicUser
PATCH /users/me            { fullName?, email?, gender? }   → PublicUser   (phone NOT editable here)
GET   /users/me/referral-code                               → { referralCode }
GET   /users/me/referrals                                   → Referral[]
GET   /users/me/addresses                                   → Address[]
POST  /users/me/addresses  { recipientName, recipientPhone, line1, line2?, city, state, pincode, isDefault? }

GET  /videos               ?cursor&limit(max 20)            → { items, nextCursor }   (public)

GET  /wallet                                                → { balancePaise, pendingReferralCreditPaise }
GET  /wallet/transactions  ?limit&offset                    → WalletEntry[]
     ⚠ Balance and statement are SEPARATE endpoints.
```

### Key enums (mirrored in `lib/core/constants/domain_enums.dart`)
- `OrderStatus`: ORDERED, PENDING_VERIFICATION, CONFIRMED, SHIPPED, DELIVERY_FAILED, DELIVERED, CANCELLED
- `PaymentMethod`: COD, UPI, CARD
- `ReturnReason`: SIZE_TOO_SMALL, SIZE_TOO_LARGE, QUALITY_NOT_AS_EXPECTED, WRONG_ITEM_RECEIVED, DAMAGED_ON_ARRIVAL, COLOUR_DIFFERENT, CHANGED_MY_MIND, OTHER
- `FitTag`, `FabricType`, `PrintTechnique`, `WalletTransactionType`, `ReferralStatus`, `CatalogSort`

---

## 4. What exists (51 files)

**Foundation:** `pubspec.yaml`, `analysis_options.yaml`, `lib/main.dart`
Deps: flutter_riverpod, dio, go_router, google_fonts, lucide_icons, cached_network_image, flutter_secure_storage, video_player, chewie, url_launcher, intl.

**Core** (`lib/core/`)
- `theme/` — `app_colors.dart`, `app_typography.dart` (Outfit via google_fonts), `app_theme.dart` (+ `AppSpacing`/`AppRadius`). Tokens taken verbatim from the Stitch design system: primary `#74593F`, peach container `#FFDAB9`, sand `#C4A484`, canvas `#FFF8F5`, charcoal `#1E1B19`; 18px cards, 12px buttons, pill chips.
- `network/dio_client.dart` — Bearer injection + 401 → refresh → retry-once.
- `network/api_error.dart` — Nest/Zod error envelope → human sentence.
- `storage/token_storage.dart` — flutter_secure_storage wrapper.
- `constants/api_constants.dart` — every route above.
- `constants/domain_enums.dart` — backend enum mirrors.
- `utils/money.dart` — paise → ₹ formatting.

**Features** — each with `data/` (models + API), `domain/` (Riverpod providers), `presentation/screens|widgets/`:
- `auth` — OTP + Google union handling, referral code capture, onboarding screen
- `catalog` — cursor-paginated product list, home w/ category rail, filter sheet, product card
- `pdp` — slug-based detail, variant selection, fit-tag hint, size-enquiry sheet
- `cart` — whole-cart mutations, coupon-as-query, free-delivery progress, totals breakdown
- `checkout` — address picker, payment method, wallet toggle, COD verification screen
- `orders` — history, detail-with-derived-timeline, cancel, redelivery request
- `orders/returns` — per-item 3-step request flow, returns list
- `content_videos` — vertical reels, one-controller-at-a-time playback, Shop Look sheet
- `growth` — wallet balance + pending referral credit, statement, referral share
- `account` — profile, reuses auth's `PublicUser`

**Routing:** `lib/routes/app_router.dart` (go_router + auth-guard redirect + StatefulShellRoute), `app_shell.dart` (bottom nav).

---

## 5. Open items — what the next agent must do

### 5a. ⚠ `app_router.dart` is STALE — fix first
It was written before the model corrections and still references removed/renamed things:
- imports `order_tracking_screen.dart` — **deleted**; use `order_detail_screen.dart`
- `PdpScreen(productId:)` → now takes **`slug:`**; route `'/catalog/product/:productId'` → `:slug`
- needs new routes: `/profile/returns` → `ReturnsListScreen`, `/profile/orders/:orderId` → `OrderDetailScreen`
- `ReturnRequestScreen` path is now under `screens/returns/`
- wishlist route/tab — see 5b

### 5b. Wishlist — DECIDED: build a backend endpoint
**There is currently no wishlist anywhere in `Adorini_Backend` (zero grep matches).**
Product decision made by the owner: **cloud-backed storage is the source of truth; device-local storage is only a cache/temporary layer.**

Required work:
1. **Backend (new):** a `wishlist` module — suggested `GET /users/me/wishlist`, `POST /users/me/wishlist/:productId`, `DELETE /users/me/wishlist/:productId`. Should return the same thin `ProductSummary` projection the catalog uses.
2. **Frontend:** `lib/features/catalog/presentation/screens/wishlist_screen.dart` currently still holds the **old pre-correction code** and references a deleted `wishlistProvider` — it must be rewritten once the endpoint shape is fixed, with an on-device cache layer in front of it.

### 5c. Deliberately stubbed (documented in-code, not silently missing)
- **Google Sign-In** — button disabled. `AuthController.signInWithGoogle(idToken)` is fully implemented incl. the PHONE_REQUIRED branch, but no plugin/OAuth client mints the `idToken`.
- **Cashfree prepaid payment** — `PlacedOrder.paymentSessionId` is parsed; checkout shows a "not available in this build" message for UPI/CARD. COD path is complete.
- **Review submission / review list** — `/pdp/:slug/reviews` (GET + multipart POST) exists on the backend, unused by the app. Only `reviewSummary` is displayed.
- **Address creation UI** — `CheckoutApi.createAddress` exists; no form screen. Checkout says "No saved addresses yet" with no way to add one.
- **Avatar upload** — `/users/me/avatar` unused.

### 5d. Expect on first `flutter analyze`
All current IDE errors are `pub get` artifacts. Genuine issues likely to surface:
- Riverpod generic/inference nits in the `AsyncNotifier` pagination controllers (`ProductListController`, `VideoFeedController`, `CartController`)
- `RadioListTile.groupValue`/`onChanged` deprecation on newer Flutter
- `CardThemeData` vs `CardTheme` depending on SDK version
- `withValues(alpha:)` in `app_theme.dart` requires a recent Flutter; swap to `withOpacity` on older SDKs
- Unused imports after the rewrites

---

## 6. Stitch design source

Project "Adorini Ethnic Wear App", ID `7659701532742633314`, 14 screens, MOBILE/390px, accessible via the Stitch MCP tools (`list_screens`, `get_screen`). Design system is embedded in the project's `designMd`. Every token in `lib/core/theme/` came from there.

Screen → file map: Onboarding→`auth/`, Home/Catalog/Filters/Wishlist→`catalog/`, PDP→`pdp/`, Cart→`cart/`, Checkout→`checkout/`, Order Tracking+History+Returns→`orders/`, Video Feed→`content_videos/`, Wallet&Referrals→`growth/`, Profile→`account/`.
