// 儲存在記憶體中的狀態
// 這些變數會在背景腳本存活期間保持，並搭配 chrome.storage.local 進行持久化，
// 在 Manifest V3 中 Service Worker 會定期休眠，因此需要確保每次使用時從 storage 取回資料。

// 更新擴充功能圖示上的數字標記
function updateBadge(activeTabs) {
    const count = Object.keys(activeTabs || {}).length;
    const text = count > 0 ? count.toString() : "";
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: "#28a745" }); // 綠色背景
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

// 啟動或 Service Worker 喚醒時從 storage 讀取狀態，清理超過30天未使用的 UUID
chrome.storage.local.get(['activeTabs', 'activeUuids'], (result) => {
    let activeUuids = result.activeUuids || {};
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
        chrome.storage.local.set({ activeUuids: activeUuids });
    }
    updateBadge(activeTabs);
});

// 確保 Watchdog 定時器已建立 (每 1 分鐘檢查一次是否有卡住的分頁)
chrome.alarms.get("reloader-watchdog", (alarm) => {
    if (!alarm) {
        chrome.alarms.create("reloader-watchdog", { periodInMinutes: 1 });
    }
});

// 處理來自 content script 和 popup 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "check_reload") {
        // 來自內容腳本的詢問：我這個分頁需要自動重讀嗎？
        const tabId = sender.tab?.id;
        const requestUuid = request.uuid;
        
        if (tabId) {
            chrome.storage.local.get(['activeTabs', 'activeUuids'], (result) => {
                const activeTabs = result.activeTabs || {};
                const activeUuids = result.activeUuids || {};
                
                // 1. 如果傳遞了 uuid 且此 uuid 存在於設定中
                if (requestUuid && activeUuids[requestUuid]) {
                    const settings = activeUuids[requestUuid];
                    // 更新最後活動時間
                    activeUuids[requestUuid].lastActive = Date.now();
                    // 更新目前的網址與標題
                    if (sender.tab?.url) activeUuids[requestUuid].url = sender.tab.url;
                    if (sender.tab?.title) activeUuids[requestUuid].title = sender.tab.title;
                    
                    // 將當前的 tabId 關聯到這個 UUID
                    activeTabs[tabId] = { uuid: requestUuid, min: settings.min, max: settings.max };
                    
                    chrome.storage.local.set({ activeTabs: activeTabs, activeUuids: activeUuids }, () => {
                        updateBadge(activeTabs);
                    });
                    
                    const delaySec = Math.floor(Math.random() * (settings.max - settings.min + 1)) + settings.min;
                    sendResponse({ enabled: true, delay: delaySec * 1000, uuid: requestUuid });
                    return;
                }
                
                // 2. 如果沒有 uuid，但 current tabId 有紀錄 (例如剛啟用且網頁剛重整，此時還沒寫入 sessionStorage)
                const tabIdStr = String(tabId);
                const targetId = activeTabs[tabId] ? tabId : (activeTabs[tabIdStr] ? tabIdStr : null);
                if (targetId && activeTabs[targetId]) {
                    const settings = activeTabs[targetId];
                    const uuid = settings.uuid;
                    if (uuid && activeUuids[uuid]) {
                        activeUuids[uuid].lastActive = Date.now();
                        if (sender.tab?.url) activeUuids[uuid].url = sender.tab.url;
                        if (sender.tab?.title) activeUuids[uuid].title = sender.tab.title;
                        chrome.storage.local.set({ activeUuids: activeUuids });
                    }
                    const delaySec = Math.floor(Math.random() * (settings.max - settings.min + 1)) + settings.min;
                    sendResponse({ enabled: true, delay: delaySec * 1000, uuid: settings.uuid });
                } else {
                    sendResponse({ enabled: false });
                }
            });
            return true; // 告知 Chrome 會非同步回覆
        }
    } else if (request.action === "do_hard_reload") {
        // 來自內容腳本的要求：時間到了，執行強制重讀 (Hard Reload)
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.storage.local.get(['activeTabs'], (result) => {
                const activeTabs = result.activeTabs || {};
                const targetId = activeTabs[tabId] ? tabId : String(tabId);
                if (activeTabs[targetId]) {
                    // bypassCache: true 即為 Ctrl+F5 效果，強制不使用快取
                    chrome.tabs.reload(tabId, { bypassCache: true });
                }
            });
        }
    } else if (request.action === "update_tab_settings") {
        // 來自 Popup 的開關或儲存操作（針對單一分頁）
        const tabId = request.tabId;
        const enabled = request.enabled;
        const min = parseInt(request.min, 10);
        const max = parseInt(request.max, 10);
        
        if (enabled) {
            // 防禦性邊界與格式檢查
            if (isNaN(min) || isNaN(max) || min < 1 || min > 86400 || max < 1 || max > 86400 || max < min) {
                sendResponse({ success: false, error: "Invalid parameter bounds" });
                return true;
            }
        }
        
        chrome.storage.local.get(['activeTabs', 'activeUuids', 'defaultMin', 'defaultMax'], (result) => {
            const activeTabs = result.activeTabs || {};
            const activeUuids = result.activeUuids || {};
            
            if (enabled) {
                // 檢查該分頁是否已經有 uuid
                let uuid = activeTabs[tabId]?.uuid || activeTabs[String(tabId)]?.uuid;
                if (!uuid) {
                    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                        uuid = crypto.randomUUID();
                    } else {
                        uuid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    }
                }
                
                activeTabs[tabId] = { uuid: uuid, min: min, max: max };
                activeUuids[uuid] = { 
                    url: request.url || "", 
                    title: request.title || "", 
                    min: min, 
                    max: max, 
                    lastActive: Date.now() 
                };
                
                chrome.storage.local.set({ 
                    activeTabs: activeTabs,
                    activeUuids: activeUuids,
                    defaultMin: min, 
                    defaultMax: max 
                }, () => {
                    updateBadge(activeTabs);
                    sendResponse({ success: true });
                });
            } else {
                // 停用
                const tabIdStr = String(tabId);
                const targetId = activeTabs[tabId] ? tabId : (activeTabs[tabIdStr] ? tabIdStr : null);
                let uuid = null;
                
                if (targetId) {
                    uuid = activeTabs[targetId].uuid;
                    delete activeTabs[targetId];
                }
                if (uuid) {
                    delete activeUuids[uuid];
                }
                
                chrome.storage.local.set({ 
                    activeTabs: activeTabs,
                    activeUuids: activeUuids
                }, () => {
                    updateBadge(activeTabs);
                    // 通知 content.js 停用重讀並清除 UI
                    chrome.tabs.sendMessage(tabId, { action: "stop_reloader" }).catch(err => {
                        // 忽略 content.js 尚未加載或分頁已關閉時的錯誤
                    });
                    sendResponse({ success: true });
                });
            }
        });
        return true; // 告知 Chrome 會非同步回覆
    } else if (request.action === "get_status") {
        // 來自 Popup 的狀態查詢操作
        const tabId = request.tabId;
        chrome.storage.local.get(['activeTabs', 'defaultMin', 'defaultMax'], (result) => {
            const activeTabs = result.activeTabs || {};
            const defMin = result.defaultMin !== undefined ? result.defaultMin : 30;
            const defMax = result.defaultMax !== undefined ? result.defaultMax : 35;
            
            const tabIdStr = String(tabId);
            const targetId = activeTabs[tabId] ? tabId : (activeTabs[tabIdStr] ? tabIdStr : null);
            if (targetId && activeTabs[targetId]) {
                sendResponse({ enabled: true, min: activeTabs[targetId].min, max: activeTabs[targetId].max });
            } else {
                sendResponse({ enabled: false, min: defMin, max: defMax });
            }
        });
        return true; // 告知 Chrome 會非同步回覆
    }
});

// 監聽分頁關閉事件，清除不再需要的儲存狀態
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get(['activeTabs'], (result) => {
        const activeTabs = result.activeTabs || {};
        const tabIdStr = String(tabId);
        let changed = false;
        
        if (activeTabs[tabIdStr] || activeTabs[tabId]) {
            delete activeTabs[tabIdStr];
            delete activeTabs[tabId];
            changed = true;
        }
        
        if (changed) {
            chrome.storage.local.set({ activeTabs: activeTabs }, () => {
                updateBadge(activeTabs);
            });
        }
    });
});

// 監聽 Watchdog 警報
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "reloader-watchdog") {
        chrome.storage.local.get(['activeTabs', 'activeUuids'], (result) => {
            const activeTabs = result.activeTabs || {};
            const activeUuids = result.activeUuids || {};
            const now = Date.now();
            let changed = false;
            
            const tabIds = Object.keys(activeTabs);
            if (tabIds.length === 0) return;
            
            tabIds.forEach((tabIdStr) => {
                const tabId = parseInt(tabIdStr, 10);
                const info = activeTabs[tabIdStr];
                const settings = activeUuids[info.uuid];
                
                if (settings) {
                    // 若最後活動時間距離現在超過 安全緩衝時間 (max + 60 秒，最少 90 秒)
                    const buffer = Math.max(settings.max + 60, 90) * 1000;
                    if (now - settings.lastActive > buffer) {
                        console.log(`[Watchdog] 偵測到分頁 ${tabId} 卡住 (最後活動時間: ${new Date(settings.lastActive).toISOString()})。正在重新載入...`);
                        
                        // 檢查分頁是否還在
                        chrome.tabs.get(tabId, (tab) => {
                            if (chrome.runtime.lastError || !tab) {
                                // 分頁不存在，將其從活躍名單中移除
                                delete activeTabs[tabIdStr];
                                chrome.storage.local.set({ activeTabs: activeTabs }, () => {
                                    updateBadge(activeTabs);
                                });
                            } else if (tab.discarded) {
                                // 若分頁處於休眠 (discarded) 狀態，則不進行重新整理，但保留在列表中，
                                // 並更新最後活動時間以防止 watchdog 下一分鐘重複檢查。
                                settings.lastActive = now;
                                chrome.storage.local.set({ activeUuids: activeUuids });
                            } else {
                                // 分頁存在且未休眠，執行強制重整以重啟循環
                                chrome.tabs.reload(tabId, { bypassCache: true });
                                // 預先將 lastActive 設為現在，避免在下一分鐘網頁載入完成前重複觸發
                                settings.lastActive = now;
                                chrome.storage.local.set({ activeUuids: activeUuids });
                            }
                        });
                    }
                } else {
                    // 該 tabId 沒有對應的設定檔，直接清理
                    delete activeTabs[tabIdStr];
                    changed = true;
                }
            });
            
            if (changed) {
                chrome.storage.local.set({ activeTabs: activeTabs }, () => {
                    updateBadge(activeTabs);
                });
            }
        });
    }
});

// 監聽瀏覽器啟動事件
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get(['autoReopenOnStartup', 'activeUuids'], (result) => {
        const autoReopen = result.autoReopenOnStartup || false;
        const activeUuids = result.activeUuids || {};
        
        // 獲取所有現有分頁，以防瀏覽器已經還原了會話 (session restore)
        chrome.tabs.query({}, (existingTabs) => {
            const newActiveTabs = {};
            const promises = [];
            
            for (const uuid in activeUuids) {
                const settings = activeUuids[uuid];
                if (settings.url) {
                    // 檢查是否已有相同 URL 的分頁存在（代表瀏覽器已還原該分頁）
                    const matchingTab = existingTabs.find(t => 
                        isUrlMatch(t.url, settings.url) || 
                        isUrlMatch(t.pendingUrl, settings.url)
                    );
                    
                    if (matchingTab) {
                        // 該分頁已存在（瀏覽器已還原），我們直接將其 ID 關聯，不需要重新開啟新分頁
                        // 這樣可以避免重複開啟相同分頁 (4+4 = 8 問題)
                        newActiveTabs[matchingTab.id] = { uuid: uuid, min: settings.min, max: settings.max };
                    } else if (autoReopen) {
                        // 如果沒有找到對應的現有分頁，且使用者開啟了自動重開，則需要開啟新分頁
                        const promise = new Promise((resolve) => {
                            chrome.tabs.create({ url: settings.url, active: false }, (newTab) => {
                                if (newTab) {
                                    newActiveTabs[newTab.id] = { uuid: uuid, min: settings.min, max: settings.max };
                                }
                                resolve();
                            });
                        });
                        promises.push(promise);
                    }
                }
            }
            
            Promise.all(promises).then(() => {
                chrome.storage.local.set({ activeTabs: newActiveTabs }, () => {
                    updateBadge(newActiveTabs);
                });
            });
        });
    });
});
