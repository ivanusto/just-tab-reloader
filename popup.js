// 預設的隨機區間（秒），需與 background.js 的預設值一致
// isRestrictedUrl / validateInterval 來自 utils.js（於 popup.html 中先行載入）。
const DEFAULT_MIN = 30;
const DEFAULT_MAX = 35;

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

    // 受限頁面無法注入 content script，自動重讀無法運作。
    // 停用所有控制項並顯示提示，避免使用者誤以為已啟用。
    if (isRestrictedUrl(tab.url)) {
        const note = document.getElementById('restricted-msg');
        if (note) note.classList.remove('restricted-hidden');
        toggleSwitch.disabled = true;
        minInput.disabled = true;
        maxInput.disabled = true;
        saveBtn.disabled = true;
        const autoReopen = document.getElementById('auto-reopen-switch');
        if (autoReopen) autoReopen.disabled = true;
        return;
    }

    // 載入初始設定
    chrome.runtime.sendMessage({ action: "get_status", tabId: tab.id }, (response) => {
        if (chrome.runtime.lastError || !response) return;

        minInput.value = response.min;
        maxInput.value = response.max;

        if (response.enabled) {
            toggleSwitch.checked = true;
        } else {
            // 點擊擴充功能按鈕開啟分頁彈窗時，預設開啟自動重讀
            toggleSwitch.checked = true;
            const validation = validateInputs();
            const min = validation ? validation.min : response.min;
            const max = validation ? validation.max : response.max;

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

    // 鍵盤輸入事件：禁止非法字元，並支援 Enter 鍵快速儲存
    const handleInputKeyDown = (e) => {
        if (['e', 'E', '+', '-', '.'].includes(e.key)) {
            e.preventDefault();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            saveBtn.click();
        }
    };
    minInput.addEventListener('keydown', handleInputKeyDown);
    maxInput.addEventListener('keydown', handleInputKeyDown);

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
            minStr = String(DEFAULT_MIN);
            minInput.value = minStr;
        }
        if (maxStr === "") {
            maxStr = String(DEFAULT_MAX);
            maxInput.value = maxStr;
        }

        // 核心驗證邏輯與 background 共用（utils.js 的 validateInterval）
        const result = validateInterval(minStr, maxStr);
        if (result.error === 'bad') {
            alert(chrome.i18n.getMessage("alertBadInput"));
            return null;
        }
        if (result.error === 'bounds') {
            alert(chrome.i18n.getMessage("alertOutOfBounds"));
            return null;
        }
        if (result.error === 'minmax') {
            alert(chrome.i18n.getMessage("alertMinMaxError"));
            return null;
        }
        return { min: result.min, max: result.max };
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
                min: DEFAULT_MIN,
                max: DEFAULT_MAX
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
