# Android Studio build (Capacitor)

This repo includes a Capacitor Android project under `android/`. The WebView loads the Noon Report PWA from bundled assets (`www/` → `android/app/src/main/assets/public`).

## Requirements

- Node.js 18+ and npm
- [Android Studio](https://developer.android.com/studio) (Ladybug / recent) with Android SDK 35
- JDK 17+ (Android Studio usually provides one)

## One-time setup

From the **repo root** (not inside `android/`):

```bash
npm install
npm run cap:sync
```

Then open the Android project:

```bash
npx cap open android
```

Or in Android Studio: **File → Open** → select the `android/` folder.

## Build / run commands

### From Android Studio
1. Wait for Gradle sync
2. Pick a device/emulator
3. Click **Run** (▶)

### From the terminal

```bash
# refresh web assets into the Android project after HTML changes
npm run cap:sync

# open Android Studio
npx cap open android

# debug APK
cd android && ./gradlew assembleDebug

# release APK / Play Store bundle
cd android && ./gradlew assembleRelease
cd android && ./gradlew bundleRelease
```

Outputs:
- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
- Release AAB: `android/app/build/outputs/bundle/release/app-release.aab`

For a signed Play Store build, create a keystore in Android Studio (**Build → Generate Signed Bundle / APK**) or configure `signingConfigs` in `android/app/build.gradle`.

## After editing the web app

Whenever you change `voyage_manager.html`, `sw.js`, `manifest.webmanifest`, or `icons/`:

```bash
npm run cap:sync
```

Then rebuild/run in Android Studio.

## App identity

| Field | Value |
|-------|--------|
| Application ID | `com.noonreport.voyagemanager` |
| App name | Noon Report |
| Min SDK | 23 |
| Target / Compile SDK | 35 |

## Notes

- Offline IndexedDB storage works inside the WebView the same as the browser PWA.
- Cleartext HTTP is allowed so LAN sync servers (e.g. `http://192.168.x.x`) can be used from the Data tab.
- Service worker registration still runs; for local `https://` Capacitor scheme assets it is best-effort. Core app data does not depend on the SW.
