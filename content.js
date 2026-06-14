// 內容腳本 (Content Script)
// 負責在每個網頁載入時向背景詢問是否需要自動重讀。

if (!window.justTabReloaderInjected) {
    window.justTabReloaderInjected = true;

    let countdownIntervalId = null;
    let reloadTimeoutId = null;
    let countdownDiv = null;

    function stopReloader() {
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
        }
        if (reloadTimeoutId) {
            clearTimeout(reloadTimeoutId);
            reloadTimeoutId = null;
        }
        if (countdownDiv && countdownDiv.parentNode) {
            countdownDiv.parentNode.removeChild(countdownDiv);
            countdownDiv = null;
        }
        sessionStorage.removeItem('__tab_reloader_uuid__');
    }

    function startReloader(response) {
        // 儲存 UUID 到 sessionStorage，以便在重新整理或瀏覽器重開還原時讀取
        if (response.uuid) {
            sessionStorage.setItem('__tab_reloader_uuid__', response.uuid);
        }

        // 防禦性防範重複建立 UI
        if (countdownDiv && countdownDiv.parentNode) {
            countdownDiv.parentNode.removeChild(countdownDiv);
        }

        let remainingSeconds = Math.round(response.delay / 1000);

        // 建立並插入倒數計時的浮動介面
        countdownDiv = document.createElement('div');
        countdownDiv.style.position = 'fixed';
        countdownDiv.style.bottom = '20px';
        countdownDiv.style.right = '20px';
        countdownDiv.style.padding = '8px 12px';
        countdownDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        countdownDiv.style.color = '#fff';
        countdownDiv.style.borderRadius = '6px';
        countdownDiv.style.zIndex = '2147483647'; // 確保在最上層
        countdownDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        countdownDiv.style.fontSize = '14px';
        countdownDiv.style.pointerEvents = 'none'; // 避免阻擋使用者點擊網頁
        countdownDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        countdownDiv.innerText = chrome.i18n.getMessage("countdownText", [remainingSeconds.toString()]);
        document.body.appendChild(countdownDiv);

        // 每秒更新一次倒數數字
        countdownIntervalId = setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds >= 0) {
                if (countdownDiv) {
                    countdownDiv.innerText = chrome.i18n.getMessage("countdownText", [remainingSeconds.toString()]);
                }
            } else {
                if (countdownIntervalId) {
                    clearInterval(countdownIntervalId);
                    countdownIntervalId = null;
                }
            }
        }, 1000);

        // 設定計時器，時間到後要求背景進行強制重新載入 (bypassCache)
        reloadTimeoutId = setTimeout(() => {
            chrome.runtime.sendMessage({ action: "do_hard_reload" });
        }, response.delay);
    }

    // 取得先前儲存的分頁 UUID
    const savedUuid = sessionStorage.getItem('__tab_reloader_uuid__');

    // 向背景腳本確認狀態
    chrome.runtime.sendMessage({ action: "check_reload", uuid: savedUuid }, (response) => {
        if (response && response.enabled) {
            startReloader(response);
        } else {
            // 如果背景說沒有啟用，且原本有 uuid，代表可能被使用者關閉了，清除它
            if (savedUuid) {
                stopReloader();
            }
        }
    });

    // 接收來自背景腳本的控制訊息 (例如停止重讀)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "stop_reloader") {
            stopReloader();
            sendResponse({ success: true });
        }
    });
}
