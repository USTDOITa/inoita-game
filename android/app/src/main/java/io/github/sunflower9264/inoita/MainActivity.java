package io.github.sunflower9264.inoita;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.io.ByteArrayInputStream;
import java.util.Collections;

/**
 * 离线 WebView 壳。
 *
 * 游戏构建产物（story-game/dist）作为 Android assets 打进 APK，
 * 再由 WebViewAssetLoader 映射到 https://appassets.androidplatform.net/。
 * 之所以不用 file://：模块脚本、fetch 和 localStorage 都需要一个稳定的 HTTPS 源。
 */
public class MainActivity extends Activity {

    private static final String GAME_URL = "https://appassets.androidplatform.net/index.html";
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final long DOUBLE_BACK_MS = 2000;

    private FrameLayout root;
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private long lastBackPressed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#080d12"));
        setContentView(root);

        assetLoader = new WebViewAssetLoader.Builder()
                // 诊断上报在离线包里没有接收端，直接吞掉，避免请求落到网络。
                .addPathHandler("/__diagnostics/", path -> new WebResourceResponse(
                        "application/json", "utf-8", 204, "No Content",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0])))
                // 根路径必须和入口 /index.html 配对；源码里还有 /assets/... 的硬编码路径。
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(getApplicationContext()))
                .build();

        createWebView();
        hideSystemBars();
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#080d12"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setFocusable(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    @NonNull WebView view, @NonNull WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    @NonNull WebView view, @NonNull WebResourceRequest request) {
                String host = request.getUrl().getHost();
                return host == null || !ASSET_HOST.equals(host);
            }

            @Override
            public boolean onRenderProcessGone(
                    @NonNull WebView view, @NonNull RenderProcessGoneDetail detail) {
                // 渲染进程被系统回收后 WebView 实例不可再用，换一个新的，避免整个应用闪退。
                root.post(MainActivity.this::recreateWebView);
                return true;
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(GAME_URL + "?v=" + BuildConfig.VERSION_CODE);
    }

    private void recreateWebView() {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        createWebView();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    protected void onPause() {
        WebView view = webView;
        if (view != null) {
            // 先让页面跑完 pagehide（暂停场景、音频并落一次自动存档），再冻结 WebView。
            view.evaluateJavascript("window.dispatchEvent(new Event('pagehide'));", ignored -> {
                view.onPause();
                view.pauseTimers();
            });
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        WebView view = webView;
        if (view != null) {
            view.resumeTimers();
            view.onResume();
            view.postDelayed(() -> view.evaluateJavascript(
                    "window.dispatchEvent(new Event('pageshow'));", null), 50);
        }
        hideSystemBars();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        WebView view = webView;
        if (view != null) {
            view.requestFocus();
            long now = SystemClock.uptimeMillis();
            dispatchEscape(view, now);
        }

        long now = SystemClock.uptimeMillis();
        if (now - lastBackPressed <= DOUBLE_BACK_MS) {
            lastBackPressed = 0;
            confirmExit();
        } else {
            lastBackPressed = now;
        }
    }

    private void dispatchEscape(WebView view, long now) {
        KeyEvent down = new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE,
                0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0,
                KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD);
        KeyEvent up = new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE,
                0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0,
                KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD);
        view.dispatchKeyEvent(down);
        view.dispatchKeyEvent(up);
    }

    private void confirmExit() {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        new AlertDialog.Builder(this)
                .setMessage(R.string.exit_message)
                .setPositiveButton(R.string.exit_confirm, (dialog, which) -> finish())
                .setNegativeButton(R.string.exit_cancel, null)
                .show();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
