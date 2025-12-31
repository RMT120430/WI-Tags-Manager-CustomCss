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

    // 初始化設定（如果不存在）
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);

        // 從舊的 localStorage 遷移資料（如果存在）
        try {
            const oldData = localStorage.getItem(OLD_STORAGE_KEY);
            if (oldData) {
                const parsed = JSON.parse(oldData);
                extensionSettings[MODULE_NAME].tags = parsed;
                console.log('[WB Tags] 已從 localStorage 遷移資料');
                // 遷移後可選擇性刪除舊資料
                // localStorage.removeItem(OLD_STORAGE_KEY);
            }
        } catch (e) {
            console.warn('[WB Tags] localStorage 遷移失敗:', e);
        }
    }

    // 確保所有預設 key 都存在
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
        }
    }

    return extensionSettings[MODULE_NAME];
}

// 儲存設定
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
        activeFilters: new Set(), // 當前啟用的標籤篩選
        originalOptions: [], // 保存原始的選項列表
        selectedWorldbooks: new Set() // 批次操作：選中的世界書
    },

    init() {
        this.injectButtons();
        this.saveOriginalOptions();
    },

    getWorldbookList() {
        return world_names || [];
    },

    // 儲存原始的下拉選單選項
    saveOriginalOptions() {
        const selector = document.querySelector('#world_editor_select');
        if (selector) {
            this.state.originalOptions = Array.from(selector.options).map(opt => ({
                value: opt.value,
                text: opt.text
            }));
        }
    },

    // 找到按鈕容器
findButtonContainer() {
    // 找到「新增」按鈕,取它的父容器
    const createBtn = document.querySelector('#world_create_button');
    return createBtn ? createBtn.parentElement : null;
},

    injectButtons() {
        const container = this.findButtonContainer();
        if (!container) {
            console.warn('[WB Tags] 找不到按鈕容器');
            return;
        }

        // 檢查是否已經注入
        if (document.getElementById('wb-tag-filter-btn')) {
            return;
        }

        // 建立篩選按鈕
        const filterBtn = document.createElement('div');
        filterBtn.id = 'wb-tag-filter-btn';
        filterBtn.className = 'menu_button';
        filterBtn.title = '標籤篩選';
        filterBtn.innerHTML = '<i class="fa-solid fa-filter fa-fw"></i>';
        filterBtn.addEventListener('click', () => this.openFilterModal());

        // 建立管理按鈕
        const manageBtn = document.createElement('div');
        manageBtn.id = 'wb-tag-manage-btn';
        manageBtn.className = 'menu_button';
        manageBtn.title = '標籤管理';
        manageBtn.innerHTML = '<i class="fa-solid fa-tags fa-fw"></i>';
        manageBtn.addEventListener('click', () => this.openManageModal());

        // 插入按鈕
        container.appendChild(filterBtn);
        container.appendChild(manageBtn);

        console.log('[WB Tags] 按鈕注入成功');
    },

    // === 篩選功能 ===
    openFilterModal() {
        // 移除舊的
        const old = document.getElementById('wb-filter-modal');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'wb-filter-modal';
        overlay.className = 'wb-tag-overlay';

        const allTags = TagStorage.getAllTags();

        let tagsHtml = '';
        if (allTags.length === 0) {
            tagsHtml = '<div class="wb-tag-empty">尚無標籤</div>';
        } else {
            allTags.forEach(tag => {
                const isActive = this.state.activeFilters.has(tag);
                tagsHtml += `
                    <div class="wb-tag-chip ${isActive ? 'active' : ''}" data-tag="${tag}">
                        ${tag}
                    </div>
                `;
            });
        }

        overlay.innerHTML = `
            <div class="wb-tag-modal">
                <div class="wb-tag-header">
                    <h3>標籤篩選</h3>
                    <button class="wb-tag-close">&times;</button>
                </div>
                <div class="wb-tag-body">
                    <div class="wb-filter-hint">選擇標籤來篩選世界書（可多選）</div>
                    <div class="wb-tag-chips">
                        ${tagsHtml}
                    </div>
                    <div class="wb-tag-actions">
                        <button class="wb-btn-secondary" id="wb-clear-filter">清除篩選</button>
                        <button class="wb-btn-primary" id="wb-apply-filter">套用</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 綁定事件
        overlay.querySelector('.wb-tag-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // 標籤點擊
        overlay.querySelectorAll('.wb-tag-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
            });
        });

        // 清除篩選
        overlay.querySelector('#wb-clear-filter').addEventListener('click', () => {
            this.state.activeFilters.clear();
            this.applyFilter();
            overlay.remove();
        });

        // 套用篩選
        overlay.querySelector('#wb-apply-filter').addEventListener('click', () => {
            const selectedTags = Array.from(overlay.querySelectorAll('.wb-tag-chip.active'))
                .map(chip => chip.dataset.tag);
            
            this.state.activeFilters = new Set(selectedTags);
            this.applyFilter();
            overlay.remove();
        });
    },

    applyFilter() {
        const selector = document.querySelector('#world_editor_select');
        if (!selector) return;

        // 如果沒有篩選，恢復全部
        if (this.state.activeFilters.size === 0) {
            // 恢復原始選項
            selector.innerHTML = '';
            this.state.originalOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                selector.appendChild(option);
            });

            // 更新篩選按鈕狀態
            const filterBtn = document.getElementById('wb-tag-filter-btn');
            if (filterBtn) {
                filterBtn.classList.remove('wb-active');
            }
            return;
        }

        // 篩選世界書
        const filtered = this.getWorldbookList().filter(wb => {
            const tags = TagStorage.getTags(wb);
            // 只要有任一篩選標籤就顯示
            return Array.from(this.state.activeFilters).some(tag => tags.includes(tag));
        });

        // 更新下拉選單
        selector.innerHTML = '';
        filtered.forEach(wb => {
            const option = document.createElement('option');
            option.value = wb;
            option.textContent = wb;
            selector.appendChild(option);
        });

        // 更新篩選按鈕狀態（顯示為啟用）
        const filterBtn = document.getElementById('wb-tag-filter-btn');
        if (filterBtn) {
            filterBtn.classList.add('wb-active');
        }
    },

    // === 管理功能 ===
    openManageModal() {
        // 移除舊的
        const old = document.getElementById('wb-manage-modal');
        if (old) old.remove();

        // 重置選中狀態
        this.state.selectedWorldbooks.clear();

        const overlay = document.createElement('div');
        overlay.id = 'wb-manage-modal';
        overlay.className = 'wb-tag-overlay';

        overlay.innerHTML = `
            <div class="wb-tag-modal wb-tag-modal-large">
                <div class="wb-tag-header">
                    <h3>標籤管理</h3>
                    <button class="wb-tag-close">&times;</button>
                </div>
                <div class="wb-tag-body">
                    <input type="text" class="wb-tag-search" placeholder="🔍 搜尋世界書..." id="wb-manage-search">

                    <!-- 批次操作工具列 -->
                    <div class="wb-bulk-toolbar" id="wb-bulk-toolbar" style="display: none;">
                        <div class="wb-bulk-info">
                            <span id="wb-bulk-count">已選擇 0 項</span>
                        </div>
                        <div class="wb-bulk-actions">
                            <button class="wb-btn-small" id="wb-select-all" title="全選">
                                <i class="fa-solid fa-check-double"></i> 全選
                            </button>
                            <button class="wb-btn-small" id="wb-deselect-all" title="取消全選">
                                <i class="fa-solid fa-times"></i> 取消
                            </button>
                            <button class="wb-btn-small wb-btn-primary-small" id="wb-bulk-add-tag" title="批次新增標籤">
                                <i class="fa-solid fa-plus"></i> 新增標籤
                            </button>
                            <button class="wb-btn-small wb-btn-danger-small" id="wb-bulk-remove-tag" title="批次刪除標籤">
                                <i class="fa-solid fa-trash"></i> 刪除標籤
                            </button>
                        </div>
                    </div>

                    <div class="wb-manage-list" id="wb-manage-list"></div>
                    <div class="wb-tag-actions">
                        <button class="wb-btn-primary" id="wb-manage-done">完成</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 綁定事件
        overlay.querySelector('.wb-tag-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#wb-manage-done').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // 搜尋功能
        overlay.querySelector('#wb-manage-search').addEventListener('input', (e) => {
            this.renderManageList(e.target.value.toLowerCase());
        });

        // 批次操作按鈕
        overlay.querySelector('#wb-select-all').addEventListener('click', () => this.selectAllWorldbooks());
        overlay.querySelector('#wb-deselect-all').addEventListener('click', () => this.deselectAllWorldbooks());
        overlay.querySelector('#wb-bulk-add-tag').addEventListener('click', () => this.bulkAddTag());
        overlay.querySelector('#wb-bulk-remove-tag').addEventListener('click', () => this.bulkRemoveTag());

        // 初始渲染
        this.renderManageList();
    },

    renderManageList(searchQuery = '') {
        const container = document.getElementById('wb-manage-list');
        if (!container) return;

        const worldbooks = this.getWorldbookList();
        const filtered = searchQuery
            ? worldbooks.filter(wb => wb.toLowerCase().includes(searchQuery))
            : worldbooks;

        if (filtered.length === 0) {
            container.innerHTML = '<div class="wb-tag-empty">找不到世界書</div>';
            return;
        }

        container.innerHTML = '';

        filtered.forEach(wb => {
            const item = document.createElement('div');
            item.className = 'wb-manage-item';

            // 新增複選框
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'wb-checkbox';
            checkbox.checked = this.state.selectedWorldbooks.has(wb);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.state.selectedWorldbooks.add(wb);
                } else {
                    this.state.selectedWorldbooks.delete(wb);
                }
                this.updateBulkToolbar();
            });

            const name = document.createElement('div');
            name.className = 'wb-manage-item-name';
            name.textContent = wb;

            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'wb-manage-item-tags';

            // 顯示現有標籤
            const tags = TagStorage.getTags(wb);
            tags.forEach(tag => {
                const chip = document.createElement('span');
                chip.className = 'wb-tag-mini';
                chip.innerHTML = `${tag} <span class="wb-tag-remove">&times;</span>`;
                chip.querySelector('.wb-tag-remove').addEventListener('click', () => {
                    TagStorage.removeTag(wb, tag);
                    this.renderManageList(searchQuery);
                });
                tagsContainer.appendChild(chip);
            });

            // 新增標籤按鈕
            const addBtn = document.createElement('button');
            addBtn.className = 'wb-tag-add-mini';
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
            addBtn.addEventListener('click', () => {
                // 檢查是否已經有輸入框
                if (tagsContainer.querySelector('.wb-tag-inline-input')) return;

                // 創建內嵌輸入框
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'wb-tag-inline-input';
                input.placeholder = '輸入標籤...';

                // 提交標籤的函數
                const submitTag = () => {
                    const tag = input.value.trim();
                    if (tag) {
                        TagStorage.addTag(wb, tag);
                        this.renderManageList(searchQuery);
                    } else {
                        input.remove();
                    }
                };

                // Enter 鍵提交
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        submitTag();
                    } else if (e.key === 'Escape') {
                        input.remove();
                    }
                });

                // 失去焦點時提交
                input.addEventListener('blur', submitTag);

                // 新增輸入框並自動聚焦
                tagsContainer.appendChild(input);
                input.focus();
            });

            item.appendChild(checkbox);
            item.appendChild(name);
            item.appendChild(tagsContainer);
            item.appendChild(addBtn);
            container.appendChild(item);
        });
    },

    // 更新批次操作工具列顯示狀態
    updateBulkToolbar() {
        const toolbar = document.getElementById('wb-bulk-toolbar');
        const count = document.getElementById('wb-bulk-count');

        if (!toolbar || !count) return;

        const selectedCount = this.state.selectedWorldbooks.size;

        if (selectedCount > 0) {
            toolbar.style.display = 'flex';
            count.textContent = `已選擇 ${selectedCount} 項`;
        } else {
            toolbar.style.display = 'none';
        }
    },

    // 全選
    selectAllWorldbooks() {
        const searchQuery = document.getElementById('wb-manage-search')?.value.toLowerCase() || '';
        const worldbooks = this.getWorldbookList();
        const filtered = searchQuery
            ? worldbooks.filter(wb => wb.toLowerCase().includes(searchQuery))
            : worldbooks;

        filtered.forEach(wb => this.state.selectedWorldbooks.add(wb));
        this.renderManageList(searchQuery);
    },

    // 取消全選
    deselectAllWorldbooks() {
        this.state.selectedWorldbooks.clear();
        const searchQuery = document.getElementById('wb-manage-search')?.value.toLowerCase() || '';
        this.renderManageList(searchQuery);
    },

    // 批次新增標籤
    bulkAddTag() {
        if (this.state.selectedWorldbooks.size === 0) {
            return;
        }

        const tag = prompt('請輸入要新增的標籤：');
        if (!tag || !tag.trim()) return;

        const trimmedTag = tag.trim();
        this.state.selectedWorldbooks.forEach(wb => {
            TagStorage.addTag(wb, trimmedTag);
        });

        const searchQuery = document.getElementById('wb-manage-search')?.value.toLowerCase() || '';
        this.renderManageList(searchQuery);
    },

    // 批次刪除標籤
    bulkRemoveTag() {
        if (this.state.selectedWorldbooks.size === 0) {
            return;
        }

        // 獲取所有選中世界書的標籤交集（共有標籤）
        const selectedWbs = Array.from(this.state.selectedWorldbooks);
        if (selectedWbs.length === 0) return;

        // 找出所有選中世界書共有的標籤
        let commonTags = new Set(TagStorage.getTags(selectedWbs[0]));
        for (let i = 1; i < selectedWbs.length; i++) {
            const tags = new Set(TagStorage.getTags(selectedWbs[i]));
            commonTags = new Set([...commonTags].filter(tag => tags.has(tag)));
        }

        if (commonTags.size === 0) {
            alert('所選世界書沒有共同的標籤');
            return;
        }

        // 顯示標籤選擇對話框
        this.showBulkRemoveDialog(Array.from(commonTags));
    },

    // 顯示批次刪除標籤對話框
    showBulkRemoveDialog(commonTags) {
        const overlay = document.createElement('div');
        overlay.className = 'wb-tag-overlay';
        overlay.style.zIndex = '100001'; // 確保在管理對話框之上

        let tagsHtml = commonTags.map(tag => `
            <div class="wb-tag-chip" data-tag="${tag}">
                ${tag}
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="wb-tag-modal">
                <div class="wb-tag-header">
                    <h3>批次刪除標籤</h3>
                    <button class="wb-tag-close">&times;</button>
                </div>
                <div class="wb-tag-body">
                    <div class="wb-filter-hint">選擇要從所選世界書中刪除的標籤（可多選）</div>
                    <div class="wb-tag-chips">
                        ${tagsHtml}
                    </div>
                    <div class="wb-tag-actions">
                        <button class="wb-btn-secondary" id="wb-cancel-bulk-remove">取消</button>
                        <button class="wb-btn-danger" id="wb-confirm-bulk-remove">刪除</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 標籤點擊
        const selectedTags = new Set();
        overlay.querySelectorAll('.wb-tag-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                const tag = chip.dataset.tag;
                if (chip.classList.contains('active')) {
                    selectedTags.add(tag);
                } else {
                    selectedTags.delete(tag);
                }
            });
        });

        // 取消
        overlay.querySelector('#wb-cancel-bulk-remove').addEventListener('click', () => {
            overlay.remove();
        });

        // 確認刪除
        overlay.querySelector('#wb-confirm-bulk-remove').addEventListener('click', () => {
            if (selectedTags.size === 0) {
                alert('請至少選擇一個標籤');
                return;
            }

            // 從所有選中的世界書中刪除選中的標籤
            this.state.selectedWorldbooks.forEach(wb => {
                selectedTags.forEach(tag => {
                    TagStorage.removeTag(wb, tag);
                });
            });

            overlay.remove();
            const searchQuery = document.getElementById('wb-manage-search')?.value.toLowerCase() || '';
            this.renderManageList(searchQuery);
        });

        // 關閉按鈕
        overlay.querySelector('.wb-tag-close').addEventListener('click', () => {
            overlay.remove();
        });

        // 點擊遮罩關閉
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }
};

// === 初始化 ===
const init = () => {
    console.log('[WB Tags] 開始初始化');
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => UI.init(), 1000);
        });
    } else {
        setTimeout(() => UI.init(), 1000);
    }
};

// 監聽世界書更新
eventSource.on(event_types.WORLDINFO_UPDATED, () => {
    UI.saveOriginalOptions();
});

init();
