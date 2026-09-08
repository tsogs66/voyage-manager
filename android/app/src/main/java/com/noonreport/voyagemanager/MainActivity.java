package com.noonreport.voyagemanager;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * The Android WebView implements neither window.print() nor a download
 * manager, so both the printer picker and "save this backup where I can find
 * it" have to come from the activity.
 *
 * Without the file bridge a JSON export on the phone is silently lost: the
 * File System Access picker does not exist here, navigator.share refuses
 * files, and a blob anchor click does nothing at all while still looking to
 * the page like it worked. ChengAndroidFiles writes the file to
 * Downloads/VoyageChief through MediaStore and returns where it went, so the
 * program can tell the user a path that is actually there.
 *
 * ChengAndroidPrint was already here and is unchanged; it is carried along so
 * this file stays the single description of what the activity exposes.
 */
public class MainActivity extends BridgeActivity {
  private WebView printWebView;
  private boolean bridgesInstalled = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    installBridgesSoon();
  }

  @Override
  public void onStart() {
    super.onStart();
    installBridgesSoon();
  }

  private void installBridgesSoon() {
    new Handler(Looper.getMainLooper()).post(this::installBridges);
    new Handler(Looper.getMainLooper()).postDelayed(this::installBridges, 400);
  }

  private void installBridges() {
    try {
      Bridge bridge = getBridge();
      if (bridge == null) return;
      WebView webView = bridge.getWebView();
      if (webView == null) return;
      if (!bridgesInstalled) {
        webView.addJavascriptInterface(new PrintBridge(), "ChengAndroidPrint");
        webView.addJavascriptInterface(new FileBridge(), "ChengAndroidFiles");
        bridgesInstalled = true;
      }
      webView.post(() -> webView.evaluateJavascript(
          "window.__CHENG_ANDROID_PRINT__=true;window.__CHENG_ANDROID_FILES__=true;"
              + "try{window.dispatchEvent(new CustomEvent('cheng-android-print-ready'));}catch(e){}",
          null
      ));
    } catch (Exception ignored) {
      /* Bridge may not be ready yet; the delayed retry covers that. */
    }
  }

  /** Writes a text file into the public Downloads folder. */
  private class FileBridge {
    @JavascriptInterface
    public String saveText(final String fileName, final String text, final String mimeType) {
      final String name = safeName(fileName);
      final String mime = (mimeType == null || mimeType.trim().isEmpty())
          ? "application/json" : mimeType.trim();
      final byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          ContentResolver resolver = getContentResolver();
          ContentValues values = new ContentValues();
          values.put(MediaStore.Downloads.DISPLAY_NAME, name);
          values.put(MediaStore.Downloads.MIME_TYPE, mime);
          values.put(MediaStore.Downloads.RELATIVE_PATH,
              Environment.DIRECTORY_DOWNLOADS + "/VoyageChief");
          values.put(MediaStore.Downloads.IS_PENDING, 1);
          Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
          if (uri == null) return "";
          OutputStream out = resolver.openOutputStream(uri);
          if (out == null) return "";
          try {
            out.write(bytes);
            out.flush();
          } finally {
            out.close();
          }
          values.clear();
          values.put(MediaStore.Downloads.IS_PENDING, 0);
          resolver.update(uri, values, null, null);
          return "Downloads/VoyageChief/" + name;
        }
        File dir = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "VoyageChief");
        if (!dir.isDirectory() && !dir.mkdirs()) return "";
        File target = new File(dir, name);
        FileOutputStream out = new FileOutputStream(target);
        try {
          out.write(bytes);
          out.flush();
        } finally {
          out.close();
        }
        return target.getAbsolutePath();
      } catch (Exception e) {
        /* Empty string means "I could not write it" — the page then falls
           through to the share sheet rather than claiming a saved backup. */
        return "";
      }
    }

    private String safeName(String raw) {
      /* Path separators and the Windows-reserved set; a quote is legal in an
         Android filename and is left alone rather than escaped through two
         layers of template literal on the way into this file. */
      String name = raw == null ? "" : raw.trim().replaceAll("[\\/:*?<>|]+", "-");
      if (name.isEmpty()) name = "voyagechief-backup.json";
      return name;
    }
  }

  private class PrintBridge {
    @JavascriptInterface
    public void printHtml(final String html, final String jobName) {
      runOnUiThread(() -> {
        final String name = (jobName == null || jobName.trim().isEmpty())
            ? "Voyage Chief" : jobName.trim();
        if (printWebView != null) {
          try {
            printWebView.destroy();
          } catch (Exception ignored) {
          }
          printWebView = null;
        }
        printWebView = new WebView(MainActivity.this);
        WebSettings settings = printWebView.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        printWebView.setWebViewClient(new WebViewClient() {
          @Override
          public void onPageFinished(WebView view, String url) {
            try {
              PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
              if (printManager == null) return;
              PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(name);
              PrintAttributes.MediaSize media = PrintAttributes.MediaSize.ISO_A4;
              String src = html != null ? html.toLowerCase(Locale.US) : "";
              if (src.contains("size: a4 landscape") || src.contains("size:a4 landscape")) {
                media = media.asLandscape();
              }
              PrintAttributes attrs = new PrintAttributes.Builder()
                  .setMediaSize(media)
                  .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                  .build();
              printManager.print(name, adapter, attrs);
            } catch (Exception ignored) {
            }
          }
        });
        printWebView.loadDataWithBaseURL(
            "https://localhost/",
            html != null ? html : "<html><body></body></html>",
            "text/html",
            "UTF-8",
            null
        );
      });
    }
  }
}
