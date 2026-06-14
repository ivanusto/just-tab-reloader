// 共用純函式
// ----------------------------------------------------------------------------
// 這個檔案只包含「無副作用、不依賴 chrome.* / DOM」的純函式，方便用 node:test 做單元測試。
// 在瀏覽器中以一般 <script> / importScripts 載入時，這些函式會掛在全域；
// 在 Node 測試中則透過底部的 module.exports 匯出。

// 允許的區間邊界（秒）：最小 1 秒，最大 24 小時。
const INTERVAL_MIN_SEC = 1;
const INTERVAL_MAX_SEC = 86400;

// 在 [min, max] 範圍內隨機挑選秒數並轉為毫秒
function randomDelayMs(min, max) {
    const delaySec = Math.floor(Math.random() * (max - min + 1)) + min;
    return delaySec * 1000;
}

// 比對兩個網址是否相同（忽略協定、結尾斜線、hash）
function isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;
    if (url1 === url2) return true;

    try {
        const u1 = new URL(url1);
        const u2 = new URL(url2);
        // 忽略協定 (http/https) 與結尾斜線，比對主機名、路徑與查詢參數
        const path1 = u1.pathname.replace(/\/$/, "");
        const path2 = u2.pathname.replace(/\/$/, "");
        return u1.host === u2.host && path1 === path2 && u1.search === u2.search;
    } catch (e) {
        return false;
    }
}

// 判斷是否為無法注入 content script 的受限頁面（瀏覽器內部頁、擴充功能商店等）。
// 在這些頁面上無法顯示倒數，且 chrome.tabs.reload 可能失敗。
function isRestrictedUrl(url) {
    if (!url) return true;
    if (/^(chrome|edge|brave|about|chrome-extension|moz-extension|view-source|devtools|data):/i.test(url)) {
        return true;
    }
    return /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org)/i.test(url);
}

// 驗證隨機區間的核心邏輯（純函式，不碰 DOM）。
// 回傳 { min, max } 代表通過；否則回傳 { error: 'bad' | 'bounds' | 'minmax' }。
function validateInterval(minRaw, maxRaw) {
    const minStr = String(minRaw).trim();
    const maxStr = String(maxRaw).trim();

    const intRegex = /^[1-9]\d*$/;
    if (!intRegex.test(minStr) || !intRegex.test(maxStr)) {
        return { error: 'bad' };
    }

    const min = parseInt(minStr, 10);
    const max = parseInt(maxStr, 10);
    if (min < INTERVAL_MIN_SEC || min > INTERVAL_MAX_SEC ||
        max < INTERVAL_MIN_SEC || max > INTERVAL_MAX_SEC) {
        return { error: 'bounds' };
    }
    if (max < min) {
        return { error: 'minmax' };
    }
    return { min, max };
}

// Node 測試環境：匯出純函式。瀏覽器中 module 未定義，會略過。
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        INTERVAL_MIN_SEC,
        INTERVAL_MAX_SEC,
        randomDelayMs,
        isUrlMatch,
        isRestrictedUrl,
        validateInterval,
    };
}
