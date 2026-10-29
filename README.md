# L$B Interior Design

A no-dependency Node.js storefront for paint and POP materials. It includes a public catalog, guest checkout, customer accounts, order lookup, and a server-protected admin dashboard. The Android app is built with Capacitor.

## Run locally

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Set a unique `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`. Use a password with at least 12 characters.
4. Add the real store contact information to `STORE_PHONE`, `STORE_EMAIL`, and `STORE_ADDRESS`.
5. Run `npm start` and open `http://localhost:3000`. The admin signs in at `/admin`.

The `.env` file and `store-data.json` contain private configuration and customer order details. Do not publish either file or commit `.env`.
The server reads `.env` on startup, with already-set process environment variables taking precedence.

## Orders, payments and delivery

Checkout records an order as pending, reserves stock, and displays an order number. Customers can look up an order using that number and their checkout phone number. Customers can create an account at `/account` to view orders placed while signed in and change their password. Guest checkout remains available; guest orders can be looked up by order number and checkout phone number. The administrator reviews orders in `/admin`, contacts the customer using the supplied details, and updates the order status.

The admin order list includes an **Open in Google Maps** link generated from the buyer-provided delivery address. It opens a Google Maps address search in a new tab; it does not collect GPS coordinates or track the buyer's device. The address is sent to Google only when an administrator opens that link.

Customer signup is separate from administrator sign-in. Customer accounts cannot access the admin dashboard. Email verification and email-based password recovery are not available in this version; users who forget a password cannot self-recover it. Customers can change their password while signed in.

This version does **not** collect payment, send email/SMS, calculate delivery fees, or book couriers. Confirm availability, delivery charges, delivery timing, and a payment method with the customer before processing an order. Add a payment provider only after configuring its merchant account and server-side credentials.

The delivery, returns, privacy and ordering information is at `/policies`. Review it against the store's actual policies and local legal requirements before publishing.

## Production checklist

- Serve the app behind HTTPS, set `NODE_ENV=production`, and use a strong unique admin password.
- Configure and verify the store's contact information, delivery terms, return terms, and payment process.
- Use a persistent, backed-up data volume for `store-data.json`. Restrict access to the server and backups; order records contain names, phone numbers, addresses and optional emails.
- Arrange data retention/deletion, privacy notices, monitoring, and recovery procedures appropriate for the business.
- Test guest checkout, customer account creation/sign-in, order lookup and admin sign-in on the deployed host before advertising the site.

Run `npm run check` for JavaScript syntax checks.

## Deploy the website and API on Render

The included `render.yaml` deploys the Node.js website/API with a persistent disk for orders and customer accounts. A persistent disk requires a paid Render web service; do not remove the disk or change its mount path after customers begin placing orders.

1. Put this project in a private GitHub repository. Do not upload `.env` or `store-data.json`; both are ignored by `.gitignore`. Keep `store-data.example.json`, which provides the initial public product catalog for a new deployment.
2. In Render, create a Blueprint from that repository and review the service and disk costs before confirming.
3. During setup, provide a unique admin username and a strong password of at least 12 characters as the `ADMIN_USERNAME` and `ADMIN_PASSWORD` secret environment variables. Never put these values in GitHub or this file.
4. After the service deploys, open its assigned `https://...onrender.com` address and test product browsing, checkout, order tracking, account creation and admin sign-in.
5. To use a custom domain later, register a domain through a registrar, attach it to the Render service, and verify HTTPS before using it as `CAPACITOR_SERVER_URL`.

The app's suggested custom-domain name, `lbsinteriordesign.com`, is only an idea; check availability and ownership with a domain registrar before purchase. Render assigns an HTTPS service domain even before a custom domain is configured.

## Mobile app release readiness

The Android and iOS projects are Capacitor shells around the storefront. Catalog, order, and account features need the Node.js server deployed and reachable over HTTPS; an installed app cannot run `server.js` locally. Configure the deployed site URL when syncing native platforms:

```sh
CAPACITOR_SERVER_URL=https://your-real-domain.example npm run android:sync
CAPACITOR_SERVER_URL=https://your-real-domain.example npm run ios:sync
```

The previously suggested `shop.lbShop.com` host did not pass an HTTPS connection check, so do not use it until its domain and TLS certificate are verified. The app is not ready to release without a live, tested host.

For Google Play, open `android/` in Android Studio, create a signed Android App Bundle (`.aab`), and submit it through a Play Console account. For Apple's App Store, open `ios/App/App.xcodeproj` on a Mac with Xcode, configure signing, archive the app, and submit it through an Apple Developer account. iOS builds and signing cannot be completed on Linux. Keep the Android package ID and iOS bundle ID stable after publishing. Test release builds on real devices.

The public website also needs its own real domain with HTTPS to appear in Google Search. Deploy the site, provide complete store contact and policy information, then verify the domain in Google Search Console and submit its sitemap. Search indexing and app-store approval are controlled by Google and Apple and cannot be guaranteed by code changes alone. The app may need more native functionality than this web storefront wrapper to satisfy each store's review rules.

The branded 512x512 Google Play listing icon is `assets/store-icon-512.png`; the source icon is `assets/app-icon.svg`.
# l-B-Interior-design
