import { eventSource, event_types } from '../../../../script.js';
import { world_names } from '../../../world-info.js';

// 用於 localStorage 遷移的舊 key
const OLD_STORAGE_KEY = 'worldbook_tags_v1';
// SillyTavern extension settings 的唯一識別符
const MODULE_NAME = 'worldbook_tags_manager';

// 預設設定
const defaultSettings = Object.freeze({
    tags: {} // 結構：{ worldbookName: ['tag1', 'tag2'] }
});

// 獲取 extension settings
function getSettings() {
    const context = SillyTavern.getContext();
    const { extensionSettings } = context;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        try {
            const oldData = localStorage.getItem(OLD_STORAGE_KEY);
            if (oldData) {
                const parsed = JSON.parse(oldData);
                extensionSettings[MODULE_NAME].tags = parsed;
                console.log('[WB Tags] 已從 localStorage 遷移資料');
            }
        } catch (e) {
            console.warn('[WB Tags] localStorage 遷移失敗:', e);
        }
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
        }
    }

    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const context = SillyTavern.getContext();
    context.saveSettingsDebounced();
}

// === 資料層 ===
const TagStorage = {
    load() {
        try {
            return getSettings().tags || {};
        } catch (e) {
            console.error('[WB Tags] 載入失敗:', e);
            return {};
        }
    },

    save(data) {
        try {
            getSettings().tags = data;
            saveSettings();
        } catch (e) {
            console.error('[WB Tags] 儲存失敗:', e);
        }
    },

    getTags(worldbookName) {
        const data = this.load();
        return data[worldbookName] || [];
    },

    setTags(worldbookName, tags) {
        const data = this.load();
        data[worldbookName] = tags;
        this.save(data);
    },

    addTag(worldbookName, tag) {
        const tags = this.getTags(worldbookName);
        if (!tags.includes(tag)) {
            tags.push(tag);
            this.setTags(worldbookName, tags);
        }
    },

    removeTag(worldbookName, tag) {
        const tags = this.getTags(worldbookName).filter(t => t !== tag);
        this.setTags(worldbookName, tags);
    },

    getAllTags() {
        const data = this.load();
        const allTags = new Set();
        Object.values(data).forEach(tags => {
            tags.forEach(t => allTags.add(t));
        });
        return Array.from(allTags).sort();
    }
};

// === UI 層 ===
const UI = {
    state: {
        activeFilters: new Set(),
        originalOptions: [],
        selectedWorldbooks: new Set(),
        initialized: false
    },

    init() {
        // 嘗試初始化，如果失敗（DOM還沒準備好），會透過 setTimeout 重試
        this.attemptInitialization(0);
    },

    attemptInitialization(retryCount) {
        const selector = document.querySelector('#world_editor_select');
        const hasOptions = selector && selector.options.length > 0;
        const container = this.findButtonContainer();

        // 只有當下拉選單存在且有資料，或者重試超過10次(10秒)才停止
        if (hasOptions && container) {
            console.log('[WB Tags] 偵測到世界書列表，開始初始化 UI');
            this.saveOriginalOptions(); // 確保這時候存到的是真的資料
            this.injectButtons();
            this.state.initialized = true;
        } else {
            if (retryCount < 20) {
                // 每 500ms 檢查一次，直到 SillyTavern 載入完成
                setTimeout(() => this.attemptInitialization(retryCount + 1), 500);
            } else {
                console.warn('[WB Tags] 初始化超時：無法找到世界書列表');
                // 即使超時也嘗試注入按鈕，可能是列表真的為空
                this.injectButtons();
            }
        }
    },

    getWorldbookList() {
        // 優先從 DOM 獲取，因為 world_names 變數更新可能會有延遲
        if (this.state.originalOptions.length > 0) {
            return this.state.originalOptions.map(opt => opt.value);
        }
        return world_names || [];
    },

    saveOriginalOptions() {
        const selector = document.querySelector('#world_editor_select');
        if (selector && selector.options.length > 0) {
            this.state.originalOptions = Array.from(selector.options).map(opt => ({
                value: opt.value,
                text: opt.text
            }));
            console.log(`[WB Tags] 已備份 ${this.state.originalOptions.length} 個原始選項`);
        }
    },

    findButtonContainer() {
        const createBtn = document.querySelector('#world_create_button');
        return createBtn ? createBtn.parentElement : null;
    },

    injectButtons() {
        const container = this.findButtonContainer();
        if (!container) return;

        if (document.getElementById('wb-tag-filter-btn')) return;

        const filterBtn = document.createElement('div');
        filterBtn.id = 'wb-tag-filter-btn';
        filterBtn.className = 'menu_button';
        filterBtn.title = '標籤篩選';
        filterBtn.innerHTML = '<i class="fa-solid fa-filter fa-fw"></i>';
        filterBtn.addEventListener('click', () => this.openFilterModal());

        const manageBtn = document.createElement('div');
        manageBtn.id = 'wb-tag-manage-btn';
        manageBtn.className = 'menu_button';
        manageBtn.title = '標籤管理';
        manageBtn.innerHTML = '<i class="fa-solid fa-tags fa-fw"></i>';
        manageBtn.addEventListener('click', () => this.openManageModal());

        container.appendChild(filterBtn);
        container.appendChild(manageBtn);
    },

    // === 篩選功能 ===
    openFilterModal() {
        const old = document.getElementById('wb-filter-modal');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'wb-filter-modal';
        overlay.className = 'wb-tag-overlay';

        // 每次打開前，重新確認一下原始選項，以防使用者新增了世界書
        if (this.state.activeFilters.size === 0) {
            this.saveOriginalOptions();
        }

        const allTags = TagStorage.getAllTags();
        let tagsHtml = allTags.length === 0 ? '<div class="wb-tag-empty">尚無標籤</div>' : '';
        
        allTags.forEach(tag => {
            const isActive = this.state.activeFilters.has(tag);
            tagsHtml += `<div class="wb-tag-chip ${isActive ? 'active' : ''}" data-tag="${tag}">${tag}</div>`;
        });

        overlay.innerHTML = `
            <div class="wb-tag-modal">
                <div class="wb-tag-header"><h3>標籤篩選</h3><button class="wb-tag-close">&times;</button></div>
                <div class="wb-tag-body">
                    <div class="wb-filter-hint">選擇標籤來篩選世界書</div>
                    <div class="wb-tag-chips">${tagsHtml}</div>
                    <div class="wb-tag-actions">
                        <button class="wb-btn-secondary" id="wb-clear-filter">清除篩選</button>
                        <button class="wb-btn-primary" id="wb-apply-filter">套用</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        overlay.querySelector('.wb-tag-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelectorAll('.wb-tag-chip').forEach(chip => {
            chip.addEventListener('click', () => chip.classList.toggle('active'));
        });

        overlay.querySelector('#wb-clear-filter').addEventListener('click', () => {
            this.state.activeFilters.clear();
            this.applyFilter();
            overlay.remove();
        });

        overlay.querySelector('#wb-apply-filter').addEventListener('click', () => {
            const selectedTags = Array.from(overlay.querySelectorAll('.wb-tag-chip.active')).map(chip => chip.dataset.tag);
            this.state.activeFilters = new Set(selectedTags);
            this.applyFilter();
            overlay.remove();
        });
    },

    applyFilter() {
        const selector = document.querySelector('#world_editor_select');
        if (!selector) return;

        // 如果原始選項是空的，嘗試重新抓取
        if (!this.state.originalOptions || this.state.originalOptions.length === 0) {
            this.saveOriginalOptions();
        }

        const currentSelection = selector.value;
        let optionsToRender = [];

        // 1. 決定要顯示哪些選項
        if (this.state.activeFilters.size === 0) {
            // 顯示全部
            optionsToRender = this.state.originalOptions;
            document.getElementById('wb-tag-filter-btn')?.classList.remove('wb-active');
        } else {
            // 執行篩選
            const filteredValues = this.state.originalOptions.map(opt => opt.value).filter(wb => {
                const tags = TagStorage.getTags(wb);
                return Array.from(this.state.activeFilters).some(tag => tags.includes(tag));
            });
            
            // 映射回完整的選項物件
            optionsToRender = this.state.originalOptions.filter(opt => filteredValues.includes(opt.value));
            document.getElementById('wb-tag-filter-btn')?.classList.add('wb-active');
        }

        // 2. 重建 DOM
        selector.innerHTML = '';
        if (optionsToRender.length === 0) {
            const opt = document.createElement('option');
            opt.text = "無符合的項目";
            opt.value = "";
            selector.appendChild(opt);
        } else {
            optionsToRender.forEach(optData => {
                const option = document.createElement('option');
                option.value = optData.value;
                option.textContent = optData.text;
                selector.appendChild(option);
            });
        }

        // 3. 智慧選取邏輯 (關鍵修復)
        const isCurrentStillAvailable = optionsToRender.some(opt => opt.value === currentSelection);
        let finalValue = "";

        if (isCurrentStillAvailable) {
            finalValue = currentSelection;
        } else if (optionsToRender.length > 0) {
            finalValue = optionsToRender[0].value;
        }

        selector.value = finalValue;

        // 4. 安全觸發事件 (關鍵修復：使用 setTimeout 確保 DOM 渲染完成)
        // 這是解決列表不顯示的核心
        setTimeout(() => {
            console.log(`[WB Tags] 觸發變更，選取值: "${finalValue}"`);
            // 先觸發原生事件
            selector.dispatchEvent(new Event('change', { bubbles: true }));
            // 再觸發 jQuery 事件 (SillyTavern 主要聽這個)
            $(selector).trigger('change');
        }, 50);
    },

    // === 管理功能 (保持不變，略作縮減以節省篇幅) ===
    openManageModal() {
        const old = document.getElementById('wb-manage-modal');
        if (old) old.remove();
        this.state.selectedWorldbooks.clear();

        const overlay = document.createElement('div');
        overlay.id = 'wb-manage-modal';
        overlay.className = 'wb-tag-overlay';

        overlay.innerHTML = `
            <div class="wb-tag-modal wb-tag-modal-large">
                <div class="wb-tag-header"><h3>標籤管理</h3><button class="wb-tag-close">&times;</button></div>
                <div class="wb-tag-body">
                    <input type="text" class="wb-tag-search" placeholder="🔍 搜尋世界書..." id="wb-manage-search">
                    <div class="wb-bulk-toolbar" id="wb-bulk-toolbar" style="display: none;">
                        <span id="wb-bulk-count">已選擇 0 項</span>
                        <div class="wb-bulk-actions">
                            <button class="wb-btn-small" id="wb-select-all">全選</button>
                            <button class="wb-btn-small" id="wb-deselect-all">取消</button>
                            <input type="text" class="wb-bulk-tag-input" id="wb-bulk-tag-input" placeholder="標籤名..." />
                            <button class="wb-btn-small wb-btn-primary-small" id="wb-bulk-add-tag"><i class="fa-solid fa-plus"></i></button>
                            <button class="wb-btn-small wb-btn-danger-small" id="wb-bulk-remove-tag"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="wb-manage-list" id="wb-manage-list"></div>
                    <div class="wb-tag-actions"><button class="wb-btn-primary" id="wb-manage-done">完成</button></div>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        
        // 綁定基本事件
        overlay.querySelector('.wb-tag-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#wb-manage-done').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        
        // 搜尋
        overlay.querySelector('#wb-manage-search').addEventListener('input', (e) => this.renderManageList(e.target.value.toLowerCase()));

        // 批次操作綁定
        overlay.querySelector('#wb-select-all').addEventListener('click', () => this.selectAllWorldbooks());
        overlay.querySelector('#wb-deselect-all').addEventListener('click', () => this.deselectAllWorldbooks());
        overlay.querySelector('#wb-bulk-add-tag').addEventListener('click', () => this.bulkAddTag());
        overlay.querySelector('#wb-bulk-remove-tag').addEventListener('click', () => this.bulkRemoveTag());
        
        // Enter 鍵支援
        overlay.querySelector('#wb-bulk-tag-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.bulkAddTag();
        });

        this.enableDragging(overlay.querySelector('.wb-tag-modal'));
        this.renderManageList();
    },

    enableDragging(modal) {
        const header = modal.querySelector('.wb-tag-header');
        let isDragging = false, startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.wb-tag-close')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = modal.offsetLeft;
            initialTop = modal.offsetTop;
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            modal.style.left = `${initialLeft + dx}px`;
            modal.style.top = `${initialTop + dy}px`;
            modal.style.transform = 'none';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            header.style.cursor = 'grab';
        });
    },

    renderManageList(searchQuery = '') {
        const container = document.getElementById('wb-manage-list');
        if (!container) return;

        // 這裡我們使用原始選項列表來確保搜尋的是正確的資料
        const sourceList = this.state.originalOptions.length > 0 
            ? this.state.originalOptions.map(o => o.value) 
            : (world_names || []);

        const filtered = searchQuery
            ? sourceList.filter(wb => wb.toLowerCase().includes(searchQuery))
            : sourceList;

        container.innerHTML = filtered.length === 0 ? '<div class="wb-tag-empty">找不到世界書</div>' : '';

        filtered.forEach(wb => {
            const item = document.createElement('div');
            item.className = 'wb-manage-item';
            
            const isSelected = this.state.selectedWorldbooks.has(wb);
            const tags = TagStorage.getTags(wb);
            
            let tagsHtml = '';
            tags.forEach(tag => {
                tagsHtml += `<span class="wb-tag-mini">${tag} <span class="wb-tag-remove" data-wb="${wb}" data-tag="${tag}">&times;</span></span>`;
            });

            item.innerHTML = `
                <input type="checkbox" class="wb-checkbox" ${isSelected ? 'checked' : ''}>
                <div class="wb-manage-item-name">${wb}</div>
                <div class="wb-manage-item-tags">${tagsHtml}</div>
                <button class="wb-tag-add-mini"><i class="fa-solid fa-plus"></i></button>
            `;

            // Checkbox event
            item.querySelector('.wb-checkbox').addEventListener('change', (e) => {
                if (e.target.checked) this.state.selectedWorldbooks.add(wb);
                else this.state.selectedWorldbooks.delete(wb);
                this.updateBulkToolbar();
            });

            // Remove tag event
            item.querySelectorAll('.wb-tag-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    TagStorage.removeTag(e.target.dataset.wb, e.target.dataset.tag);
                    this.renderManageList(searchQuery);
                });
            });

            // Add tag event
            item.querySelector('.wb-tag-add-mini').addEventListener('click', (e) => {
                const tagsContainer = item.querySelector('.wb-manage-item-tags');
                if (tagsContainer.querySelector('input')) return;
                
                const input = document.createElement('input');
                input.className = 'wb-tag-inline-input';
                input.placeholder = 'Tag...';
                tagsContainer.appendChild(input);
                input.focus();

                const submit = () => {
                    if (input.value.trim()) {
                        TagStorage.addTag(wb, input.value.trim());
                        this.renderManageList(searchQuery);
                    } else input.remove();
                };

                input.addEventListener('blur', submit);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') submit();
                    if (ev.key === 'Escape') input.remove();
                });
            });

            container.appendChild(item);
        });
    },

    updateBulkToolbar() {
        const toolbar = document.getElementById('wb-bulk-toolbar');
        const count = document.getElementById('wb-bulk-count');
        if (toolbar && count) {
            const num = this.state.selectedWorldbooks.size;
            toolbar.style.display = num > 0 ? 'flex' : 'none';
            count.textContent = `已選 ${num} 項`;
        }
    },

    selectAllWorldbooks() {
        const searchQuery = document.getElementById('wb-manage-search')?.value.toLowerCase() || '';
        const sourceList = this.state.originalOptions.length > 0 
            ? this.state.originalOptions.map(o => o.value) 
            : (world_names || []);
            
        const filtered = searchQuery ? sourceList.filter(wb => wb.toLowerCase().includes(searchQuery)) : sourceList;
        filtered.forEach(wb => this.state.selectedWorldbooks.add(wb));
        this.renderManageList(searchQuery);
        this.updateBulkToolbar();
    },

    deselectAllWorldbooks() {
        this.state.selectedWorldbooks.clear();
        this.renderManageList(document.getElementById('wb-manage-search')?.value.toLowerCase());
        this.updateBulkToolbar();
    },

    bulkAddTag() {
        const input = document.getElementById('wb-bulk-tag-input');
        const tag = input?.value.trim();
        if (tag && this.state.selectedWorldbooks.size > 0) {
            this.state.selectedWorldbooks.forEach(wb => TagStorage.addTag(wb, tag));
            input.value = '';
            this.renderManageList(document.getElementById('wb-manage-search')?.value.toLowerCase());
        }
    },

    bulkRemoveTag() {
        if (this.state.selectedWorldbooks.size === 0) return;
        
        const selectedWbs = Array.from(this.state.selectedWorldbooks);
        let commonTags = new Set(TagStorage.getTags(selectedWbs[0]));
        for (let i = 1; i < selectedWbs.length; i++) {
            const tags = new Set(TagStorage.getTags(selectedWbs[i]));
            commonTags = new Set([...commonTags].filter(x => tags.has(x)));
        }

        if (commonTags.size === 0) return alert('所選項目無共同標籤');
        this.showBulkRemoveDialog(Array.from(commonTags));
    },

    showBulkRemoveDialog(commonTags) {
        // 簡化版對話框，邏輯同原版，省略 CSS/HTML 細節以保持程式碼整潔
        const overlay = document.createElement('div');
        overlay.className = 'wb-tag-overlay';
        overlay.style.zIndex = '100001';
        
        const tagsHtml = commonTags.map(t => `<div class="wb-tag-chip" data-tag="${t}">${t}</div>`).join('');
        overlay.innerHTML = `
            <div class="wb-tag-modal">
                <div class="wb-tag-header"><h3>刪除共同標籤</h3></div>
                <div class="wb-tag-body">
                    <div class="wb-tag-chips">${tagsHtml}</div>
                    <div class="wb-tag-actions">
                        <button class="wb-btn-secondary" id="wb-cancel-bulk">取消</button>
                        <button class="wb-btn-danger" id="wb-confirm-bulk">刪除</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const selectedToRemove = new Set();
        overlay.querySelectorAll('.wb-tag-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                const t = chip.dataset.tag;
                if (chip.classList.contains('active')) selectedToRemove.add(t);
                else selectedToRemove.delete(t);
            });
        });

        overlay.querySelector('#wb-cancel-bulk').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#wb-confirm-bulk').addEventListener('click', () => {
            if (selectedToRemove.size > 0) {
                this.state.selectedWorldbooks.forEach(wb => {
                    selectedToRemove.forEach(tag => TagStorage.removeTag(wb, tag));
                });
                this.renderManageList(document.getElementById('wb-manage-search')?.value.toLowerCase());
            }
            overlay.remove();
        });
    }
};

// === 初始化 ===
const init = () => {
    console.log('[WB Tags] 開始初始化...');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => UI.init());
    } else {
        UI.init();
    }
};

// 監聽 SillyTavern 的事件，當世界書列表更新時，我們也要更新備份
eventSource.on(event_types.WORLDINFO_UPDATED, () => {
    // 給 SillyTavern 一點時間更新 DOM
    setTimeout(() => {
        // 只有在沒有啟用篩選的情況下，才更新原始列表備份
        if (UI.state.activeFilters.size === 0) {
            UI.saveOriginalOptions();
        }
    }, 500);
});

init();
