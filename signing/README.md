# Stable sideload signing for Voyage Chief Android APKs.
# Same keystore + higher versionCode = install over the previous APK (no uninstall).
# Password default: voyagechief (override with VOYAGE_KEYSTORE_PASS).
#
# Note: APKs built before this key was introduced were debug-signed on CI and
# cannot be updated in place — uninstall that one build once, then updates work.
