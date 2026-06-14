// 儲存在記憶體中的狀態
// 這些變數會在背景腳本存活期間保持，並搭配 chrome.storage.local 進行持久化，
// 在 Manifest V3 中 Service Worker 會定期休眠，因此需要確保每次使用時從 storage 取回資料。

// 載入共用純函式（utils.js）：randomDelayMs / isUrlMatch / validateInterval 等。
// Chrome 的 service worker 以 importScripts 載入；Firefox 事件頁沒有 importScripts，
// 改由 manifest 的 background.scripts 陣列先行載入 utils.js，故以條件判斷略過。
if (typeof importScripts === 'function') {
    importScripts('utils.js');
}

// 預設的隨機區間（秒）
const DEFAULT_MIN = 30;
const DEFAULT_MAX = 35;

// --- Promise 包裝函式 ---
// 統一以 callback 包成 Promise，確保 Chrome 與 Firefox 的 chrome.* API 行為一致，
// 不依賴各瀏覽器是否原生回傳 Promise，並讓下方邏輯能以 async/await 撰寫。
const storageGet = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const storageSet = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));
const tabsQuery = (query) => new Promise((resolve) => chrome.tabs.query(query, resolve));
const tabsGet = (tabId) => new Promise((resolve) =>
    chrome.tabs.get(tabId, (tab) => resolve(chrome.runtime.lastError ? null : tab)));
const tabsCreate = (props) => new Promise((resolve) =>
    chrome.tabs.create(props, (tab) => resolve(chrome.runtime.lastError ? null : tab)));

// --- 寫入序列化（互斥鎖）---
// chrome.storage 的「讀取→修改→寫入」是非同步的，在 get 與 set 之間存在 await。
// Service Worker 中多個處理器（check_reload、更新設定、分頁關閉、watchdog…）可能交錯，
// 造成 A 讀 → B 讀 → A 寫 → B 寫（B 覆蓋 A 的變更）的競態。
// withLock 將所有會修改狀態的區段串成單一序列，確保同一時間只有一個臨界區在執行。
let writeChain = Promise.resolve();
function withLock(task) {
    const run = writeChain.then(() => task());
    // 即使單次任務拋錯也不讓整條鏈中斷
    writeChain = run.catch(() => {});
    return run;
}

// 產生分頁專屬的 UUID
function generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 更新擴充功能圖示上的數字標記
function updateBadge(activeTabs) {
    const count = Object.keys(activeTabs || {}).length;
    const text = count > 0 ? count.toString() : "";
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: "#28a745" }); // 綠色背景
}

// 啟動或 Service Worker 喚醒時從 storage 讀取狀態，清理超過30天未使用的 UUID
withLock(async () => {
    const result = await storageGet(['activeTabs', 'activeUuids']);
    const activeUuids = result.activeUuids || {};
    const activeTabs = result.activeTabs || {};
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    let changed = false;

    for (const uuid in activeUuids) {
        const item = activeUuids[uuid];
        if (!item.lastActive || (now - item.lastActive > thirtyDaysMs)) {
            delete activeUuids[uuid];
            changed = true;
        }
    }

    if (changed) {
        await storageSet({ activeUuids: activeUuids });
    }
    updateBadge(activeTabs);
});

// 確保 Watchdog 定時器已建立 (每 1 分鐘檢查一次是否有卡住的分頁)
chrome.alarms.get("reloader-watchdog", (alarm) => {
    if (!alarm) {
        chrome.alarms.create("reloader-watchdog", { periodInMinutes: 1 });
    }
});

// 來自內容腳本的詢問：我這個分頁需要自動重讀嗎？
async function handleCheckReload(request, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { enabled: false };

    const requestUuid = request.uuid;
    return withLock(async () => {
        const result = await storageGet(['activeTabs', 'activeUuids']);
        const activeTabs = result.activeTabs || {};
        const activeUuids = result.activeUuids || {};

        // 1. 如果傳遞了 uuid 且此 uuid 存在於設定中
        if (requestUuid && activeUuids[requestUuid]) {
            const settings = activeUuids[requestUuid];
            // 更新最後活動時間與目前的網址、標題
            settings.lastActive = Date.now();
            if (sender.tab?.url) settings.url = sender.tab.url;
            if (sender.tab?.title) settings.title = sender.tab.title;

            // 將當前的 tabId 關聯到這個 UUID
            activeTabs[tabId] = { uuid: requestUuid, min: settings.min, max: settings.max };

            await storageSet({ activeTabs: activeTabs, activeUuids: activeUuids });
            updateBadge(activeTabs);

            return { enabled: true, delay: randomDelayMs(settings.min, settings.max), uuid: requestUuid };
        }

        // 2. 如果沒有 uuid，但 current tabId 有紀錄 (例如剛啟用且網頁剛重整，此時還沒寫入 sessionStorage)
        const tabInfo = activeTabs[tabId];
        if (tabInfo) {
            const uuid = tabInfo.uuid;
            if (uuid && activeUuids[uuid]) {
                activeUuids[uuid].lastActive = Date.now();
                if (sender.tab?.url) activeUuids[uuid].url = sender.tab.url;
                if (sender.tab?.title) activeUuids[uuid].title = sender.tab.title;
                await storageSet({ activeUuids: activeUuids });
            }
            return { enabled: true, delay: randomDelayMs(tabInfo.min, tabInfo.max), uuid: tabInfo.uuid };
        }

        return { enabled: false };
    });
}

// 來自內容腳本的要求：時間到了，執行強制重讀 (Hard Reload)
async function handleHardReload(sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    const result = await storageGet(['activeTabs']);
    const activeTabs = result.activeTabs || {};
    if (activeTabs[tabId]) {
        // bypassCache: true 即為 Ctrl+F5 效果，強制不使用快取
        chrome.tabs.reload(tabId, { bypassCache: true });
    }
}

// 來自 Popup 的開關或儲存操作（針對單一分頁）
async function handleUpdateSettings(request) {
    const tabId = request.tabId;
    const enabled = request.enabled;
    let min = parseInt(request.min, 10);
    let max = parseInt(request.max, 10);

    // 啟用時做防禦性邊界與格式檢查（與 popup 共用 utils.js 的 validateInterval）
    if (enabled) {
        const v = validateInterval(request.min, request.max);
        if (v.error) {
            return { success: false, error: "Invalid parameter bounds" };
        }
        min = v.min;
        max = v.max;
    }

    return withLock(async () => {
        const result = await storageGet(['activeTabs', 'activeUuids']);
        const activeTabs = result.activeTabs || {};
        const activeUuids = result.activeUuids || {};

        if (enabled) {
            // 檢查該分頁是否已經有 uuid，沒有則新建
            const uuid = activeTabs[tabId]?.uuid || generateUuid();

            activeTabs[tabId] = { uuid: uuid, min: min, max: max };
            activeUuids[uuid] = {
                url: request.url || "",
                title: request.title || "",
                min: min,
                max: max,
                lastActive: Date.now()
            };

            await storageSet({
                activeTabs: activeTabs,
                activeUuids: activeUuids,
                defaultMin: min,
                defaultMax: max
            });
            updateBadge(activeTabs);
            return { success: true };
        }

        // 停用
        const tabInfo = activeTabs[tabId];
        if (tabInfo) {
            delete activeTabs[tabId];
            if (tabInfo.uuid) delete activeUuids[tabInfo.uuid];
        }

        await storageSet({ activeTabs: activeTabs, activeUuids: activeUuids });
        updateBadge(activeTabs);
        // 通知 content.js 停用重讀並清除 UI（忽略 content.js 尚未加載或分頁已關閉時的錯誤）
        chrome.tabs.sendMessage(tabId, { action: "stop_reloader" }).catch(() => {});
        return { success: true };
    });
}

// 來自 Popup 的狀態查詢操作
async function handleGetStatus(request) {
    const tabId = request.tabId;
    const result = await storageGet(['activeTabs', 'defaultMin', 'defaultMax']);
    const activeTabs = result.activeTabs || {};
    const defMin = result.defaultMin !== undefined ? result.defaultMin : DEFAULT_MIN;
    const defMax = result.defaultMax !== undefined ? result.defaultMax : DEFAULT_MAX;

    const tabInfo = activeTabs[tabId];
    if (tabInfo) {
        return { enabled: true, min: tabInfo.min, max: tabInfo.max };
    }
    return { enabled: false, min: defMin, max: defMax };
}

// 處理來自 content script 和 popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "check_reload") {
        handleCheckReload(request, sender).then(sendResponse);
        return true; // 告知 Chrome 會非同步回覆
    } else if (request.action === "do_hard_reload") {
        handleHardReload(sender); // 不需回覆
    } else if (request.action === "update_tab_settings") {
        handleUpdateSettings(request).then(sendResponse);
        return true; // 告知 Chrome 會非同步回覆
    } else if (request.action === "get_status") {
        handleGetStatus(request).then(sendResponse);
        return true; // 告知 Chrome 會非同步回覆
    }
});

// 監聽分頁關閉事件，清除不再需要的儲存狀態
chrome.tabs.onRemoved.addListener((tabId) => withLock(async () => {
    const result = await storageGet(['activeTabs', 'activeUuids', 'autoReopenOnStartup']);
    const activeTabs = result.activeTabs || {};
    const tabInfo = activeTabs[tabId];
    if (!tabInfo) return;

    delete activeTabs[tabId];
    const toSet = { activeTabs: activeTabs };

    // 若使用者未開啟「啟動時自動重開」，關閉分頁後就不再需要保留其設定檔，
    // 直接刪除對應的 uuid，避免 activeUuids 累積到 30 天清理才釋放。
    if (!result.autoReopenOnStartup && tabInfo.uuid) {
        const activeUuids = result.activeUuids || {};
        if (activeUuids[tabInfo.uuid]) {
            delete activeUuids[tabInfo.uuid];
            toSet.activeUuids = activeUuids;
        }
    }

    await storageSet(toSet);
    updateBadge(activeTabs);
}));

// Watchdog：檢查是否有卡住的分頁並嘗試救援
function runWatchdog() {
    return withLock(async () => {
        const result = await storageGet(['activeTabs', 'activeUuids']);
        const activeTabs = result.activeTabs || {};
        const activeUuids = result.activeUuids || {};
        const now = Date.now();
        let changed = false;

        for (const tabIdStr of Object.keys(activeTabs)) {
            const tabId = parseInt(tabIdStr, 10);
            const info = activeTabs[tabIdStr];
            const settings = activeUuids[info.uuid];

            if (!settings) {
                // 該 tabId 沒有對應的設定檔，直接清理
                delete activeTabs[tabIdStr];
                changed = true;
                continue;
            }

            // 若最後活動時間距離現在未超過 安全緩衝時間 (max + 60 秒，最少 90 秒)，則略過
            const buffer = Math.max(settings.max + 60, 90) * 1000;
            if (now - settings.lastActive <= buffer) continue;

            const tab = await tabsGet(tabId);
            if (!tab) {
                // 分頁不存在，將其從活躍名單中移除
                delete activeTabs[tabIdStr];
                changed = true;
            } else if (tab.discarded) {
                // 若分頁處於休眠 (discarded) 狀態，則不進行重新整理，但保留在列表中，
                // 並更新最後活動時間以防止 watchdog 下一分鐘重複檢查。
                settings.lastActive = now;
                changed = true;
            } else {
                // 分頁存在且未休眠，執行強制重整以重啟循環
                chrome.tabs.reload(tabId, { bypassCache: true });
                // 預先將 lastActive 設為現在，避免在下一分鐘網頁載入完成前重複觸發
                settings.lastActive = now;
                changed = true;
            }
        }

        if (changed) {
            await storageSet({ activeTabs: activeTabs, activeUuids: activeUuids });
            updateBadge(activeTabs);
        }
    });
}

// 監聽 Watchdog 警報
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "reloader-watchdog") {
        runWatchdog();
    }
});

// 監聽瀏覽器啟動事件
chrome.runtime.onStartup.addListener(() => withLock(async () => {
    const result = await storageGet(['autoReopenOnStartup', 'activeUuids']);
    const autoReopen = result.autoReopenOnStartup || false;
    const activeUuids = result.activeUuids || {};

    // 獲取所有現有分頁，以防瀏覽器已經還原了會話 (session restore)
    const existingTabs = await tabsQuery({});
    const newActiveTabs = {};

    for (const uuid in activeUuids) {
        const settings = activeUuids[uuid];
        if (!settings.url) continue;

        // 檢查是否已有相同 URL 的分頁存在（代表瀏覽器已還原該分頁）
        const matchingTab = existingTabs.find(t =>
            isUrlMatch(t.url, settings.url) ||
            isUrlMatch(t.pendingUrl, settings.url)
        );

        if (matchingTab) {
            // 該分頁已存在（瀏覽器已還原），直接將其 ID 關聯，不需要重新開啟新分頁，
            // 這樣可以避免重複開啟相同分頁 (4+4 = 8 問題)
            newActiveTabs[matchingTab.id] = { uuid: uuid, min: settings.min, max: settings.max };
        } else if (autoReopen) {
            // 沒有找到對應的現有分頁，且使用者開啟了自動重開，則開啟新分頁
            const newTab = await tabsCreate({ url: settings.url, active: false });
            if (newTab) {
                newActiveTabs[newTab.id] = { uuid: uuid, min: settings.min, max: settings.max };
            }
        }
    }

    await storageSet({ activeTabs: newActiveTabs });
    updateBadge(newActiveTabs);
}));
