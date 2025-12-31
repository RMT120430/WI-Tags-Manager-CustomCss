import { eventSource, event_types } from '../../../../script.js';
import { world_names } from '../../../world-info.js';

const STORAGE_KEY = 'worldbook_tags_v1';

// === 資料層 ===
const TagStorage = {
    load() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            console.error('[WB Tags] 載入失敗:', e);
            return {};
        }
    },
    
    save(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
        originalOptions: [] // 保存原始的選項列表
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
        // 尋找「選擇編輯」按鈕所在的容器
        const container = document.querySelector('#WorldInfo .justifyLeft');
        return container;
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
                const tag = prompt('輸入新標籤：');
                if (tag && tag.trim()) {
                    TagStorage.addTag(wb, tag.trim());
                    this.renderManageList(searchQuery);
                }
            });

            item.appendChild(name);
            item.appendChild(tagsContainer);
            item.appendChild(addBtn);
            container.appendChild(item);
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
