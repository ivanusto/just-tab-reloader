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

        // 建立並插入現代化毛玻璃倒數計時浮動介面
        countdownDiv = document.createElement('div');
        countdownDiv.style.position = 'fixed';
        countdownDiv.style.bottom = '20px';
        countdownDiv.style.right = '20px';
        countdownDiv.style.padding = '8px 14px';
        countdownDiv.style.backgroundColor = 'rgba(15, 23, 42, 0.82)';
        countdownDiv.style.color = '#f8fafc';
        countdownDiv.style.backdropFilter = 'blur(8px)';
        countdownDiv.style.webkitBackdropFilter = 'blur(8px)';
        countdownDiv.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        countdownDiv.style.borderRadius = '20px';
        countdownDiv.style.zIndex = '2147483647';
        countdownDiv.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        countdownDiv.style.fontSize = '13px';
        countdownDiv.style.fontWeight = '500';
        countdownDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
        countdownDiv.style.display = 'flex';
        countdownDiv.style.alignItems = 'center';
        countdownDiv.style.gap = '6px';
        countdownDiv.style.cursor = 'pointer';
        countdownDiv.style.userSelect = 'none';
        countdownDiv.style.transition = 'opacity 0.25s ease, transform 0.2s ease';
        countdownDiv.style.opacity = '0.9';

        const tooltipMsg = chrome.i18n.getMessage("countdownTooltip");
        if (tooltipMsg) {
            countdownDiv.title = tooltipMsg;
        }

        // 綠色狀態指示點
        const dot = document.createElement('span');
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.backgroundColor = '#22c55e';
        dot.style.borderRadius = '50%';
        dot.style.display = 'inline-block';
        dot.style.boxShadow = '0 0 6px #22c55e';
        dot.style.flexShrink = '0';

        const textSpan = document.createElement('span');
        textSpan.innerText = chrome.i18n.getMessage("countdownText", [remainingSeconds.toString()]);

        countdownDiv.appendChild(dot);
        countdownDiv.appendChild(textSpan);

        // 滑鼠懸停時自動半透明（避免存取下方內容時遮檔視覺）
        countdownDiv.addEventListener('mouseenter', () => {
            countdownDiv.style.opacity = '0.2';
        });
        countdownDiv.addEventListener('mouseleave', () => {
            countdownDiv.style.opacity = '0.9';
        });

        // 雙擊標籤手動隱藏
        countdownDiv.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            countdownDiv.style.display = 'none';
        });

        document.body.appendChild(countdownDiv);

        // 每秒更新一次倒數數字
        countdownIntervalId = setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds >= 0) {
                if (textSpan) {
                    textSpan.innerText = chrome.i18n.getMessage("countdownText", [remainingSeconds.toString()]);
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
