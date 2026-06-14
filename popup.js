document.addEventListener('DOMContentLoaded', async () => {
    // 取得當前活躍的分頁
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 如果因為某些原因取不到分頁（例如在某些不支援的介面點開），則不處理
    if (!tab) return;

    // 本地化網頁介面
    function localizeHtmlPage() {
        const objects = document.querySelectorAll('[data-i18n]');
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            const valStrH = obj.getAttribute('data-i18n');
            const message = chrome.i18n.getMessage(valStrH);
            if (message) {
                obj.textContent = message;
            }
        }
    }
    localizeHtmlPage();

    const toggleSwitch = document.getElementById('toggle-switch');
    const minInput = document.getElementById('min-sec');
    const maxInput = document.getElementById('max-sec');
    const saveBtn = document.getElementById('save-btn');
    const saveMsg = document.getElementById('save-msg');

    // 載入初始設定
    chrome.runtime.sendMessage({ action: "get_status", tabId: tab.id }, (response) => {
        if (response) {
            // 預設將 UI 上的核取框勾選 (Checked)
            // 這樣使用者只要點開 popup，就可以直接點「儲存設定」來啟動，不需手動去切換開關。
            toggleSwitch.checked = true;
            minInput.value = response.min;
            maxInput.value = response.max;
        }
    });

    // 載入啟動重開設定
    const autoReopenSwitch = document.getElementById('auto-reopen-switch');
    chrome.storage.local.get(['autoReopenOnStartup'], (result) => {
        if (autoReopenSwitch) {
            autoReopenSwitch.checked = result.autoReopenOnStartup || false;
        }
    });

    if (autoReopenSwitch) {
        autoReopenSwitch.addEventListener('change', (e) => {
            chrome.storage.local.set({ autoReopenOnStartup: e.target.checked });
        });
    }

    const blockInvalidKeys = (e) => {
        if (['e', 'E', '+', '-', '.'].includes(e.key)) {
            e.preventDefault();
        }
    };
    minInput.addEventListener('keydown', blockInvalidKeys);
    maxInput.addEventListener('keydown', blockInvalidKeys);

    // 驗證輸入格式與範圍的輔助函式
    const validateInputs = () => {
        if (minInput.validity.badInput || maxInput.validity.badInput) {
            alert(chrome.i18n.getMessage("alertBadInput"));
            return null;
        }

        let minStr = minInput.value.trim();
        let maxStr = maxInput.value.trim();
        
        // 欄位留空時自動套用預設值
        if (minStr === "") {
            minInput.value = "30";
            minStr = "30";
        }
        if (maxStr === "") {
            maxInput.value = "35";
            maxStr = "35";
        }

        const intRegex = /^[1-9]\d*$/;
        if (!intRegex.test(minStr) || !intRegex.test(maxStr)) {
            alert(chrome.i18n.getMessage("alertBadInput"));
            return null;
        }
        const min = parseInt(minStr, 10);
        const max = parseInt(maxStr, 10);
        if (min < 1 || min > 86400 || max < 1 || max > 86400) {
            alert(chrome.i18n.getMessage("alertOutOfBounds"));
            return null;
        }
        if (max < min) {
            alert(chrome.i18n.getMessage("alertMinMaxError"));
            return null;
        }
        return { min, max };
    };

    // 處理開關切換事件
    toggleSwitch.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        if (!isEnabled) {
            // 關閉時不需要驗證，直接送出關閉指令
            chrome.runtime.sendMessage({ 
                action: "update_tab_settings", 
                tabId: tab.id, 
                enabled: false,
                min: 30,
                max: 35
            });
            return;
        }

        const validation = validateInputs();
        if (!validation) {
            e.target.checked = false; // 恢復關閉狀態
            return;
        }

        const { min, max } = validation;

        chrome.runtime.sendMessage({ 
            action: "update_tab_settings", 
            tabId: tab.id, 
            enabled: true,
            min: min,
            max: max,
            url: tab.url,
            title: tab.title
        }, () => {
            // 強制重讀以開始循環
            chrome.tabs.reload(tab.id, { bypassCache: true });
        });
    });

    // 處理儲存設定按鈕點擊事件
    saveBtn.addEventListener('click', () => {
        const validation = validateInputs();
        if (!validation) {
            return;
        }

        const { min, max } = validation;
        const isEnabled = toggleSwitch.checked;

        chrome.runtime.sendMessage({ 
            action: "update_tab_settings", 
            tabId: tab.id, 
            enabled: isEnabled,
            min: min,
            max: max,
            url: tab.url,
            title: tab.title
        }, () => {
            // 顯示儲存成功訊息
            saveMsg.classList.remove('msg-hidden');
            saveMsg.classList.add('msg-visible');
            setTimeout(() => {
                saveMsg.classList.remove('msg-visible');
                saveMsg.classList.add('msg-hidden');
            }, 2000);
            
            // 如果當前是啟用狀態，我們強制重讀以立即套用新的秒數設定
            if (isEnabled) {
                chrome.tabs.reload(tab.id, { bypassCache: true });
            }
        });
    });
});
