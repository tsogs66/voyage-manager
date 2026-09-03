package com.noonreport.voyagemanager;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/** Android WebView has no window.print() — bridge to PrintManager. */
public class MainActivity extends BridgeActivity {
  private WebView printWebView;
  private boolean printBridgeInstalled = false;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    installPrintBridgeSoon();
  }

  @Override
  public void onStart() {
    super.onStart();
    installPrintBridgeSoon();
  }

  private void installPrintBridgeSoon() {
    new Handler(Looper.getMainLooper()).post(this::installPrintBridge);
    new Handler(Looper.getMainLooper()).postDelayed(this::installPrintBridge, 400);
  }

  private void installPrintBridge() {
    try {
      Bridge bridge = getBridge();
      if (bridge == null) return;
      WebView webView = bridge.getWebView();
      if (webView == null) return;
      if (!printBridgeInstalled) {
        webView.addJavascriptInterface(new PrintBridge(), "ChengAndroidPrint");
        printBridgeInstalled = true;
      }
      webView.post(() -> webView.evaluateJavascript(
          "window.__CHENG_ANDROID_PRINT__=true;"
              + "try{window.dispatchEvent(new CustomEvent('cheng-android-print-ready'));}catch(e){}",
          null
      ));
    } catch (Exception ignored) {
    }
  }

  private class PrintBridge {
    @JavascriptInterface
    public void printHtml(final String html, final String jobName) {
      runOnUiThread(() -> {
        final String name = (jobName == null || jobName.trim().isEmpty()) ? "Voyage Chief" : jobName.trim();
        if (printWebView != null) {
          try { printWebView.destroy(); } catch (Exception ignored) {}
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
              PrintAttributes attrs = new PrintAttributes.Builder()
                  .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
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
