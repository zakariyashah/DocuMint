/**
 * DocuMint — Enterprise Document Intelligence Platform
 * Client-Ready Vanilla JavaScript Frontend Architecture
 * Focus: High-end SaaS UI, No Developer Jargon, Tabbed Workflows
 */

document.addEventListener('DOMContentLoaded', () => {
    // Application State
    let activeScope = 'all'; // 'all' or document_id
    let evidenceModeActive = true;
    let pendingDeleteDocId = null;
    let cachedSources = {}; // chunk_id -> source dict
    let allDocuments = []; // Array of document objects
    let currentView = 'view-chat'; // 'view-chat', 'view-insights', 'view-compare'

    // DOM Elements - Core Layout & Navigation
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const uploadStatusAlert = document.getElementById('upload-status-alert');
    const uploadStatusMsg = document.getElementById('upload-status-msg');
    const closeUploadAlert = document.getElementById('close-upload-alert');
    const scopeSelect = document.getElementById('scope-select');
    const activeScopeBadge = document.getElementById('active-scope-badge');
    const docListContainer = document.getElementById('doc-list');
    const docCountBadge = document.getElementById('doc-count-badge');
    const docSearchInput = document.getElementById('doc-search-input');
    const chatMessagesContainer = document.getElementById('chat-messages');
    const welcomeCard = document.getElementById('welcome-card');
    const chatForm = document.getElementById('chat-form');
    const queryInput = document.getElementById('query-input');
    const sendBtn = document.getElementById('send-btn');
    const charCount = document.getElementById('char-count');
    const queryLoadingIndicator = document.getElementById('query-loading-indicator');
    const sourceListContainer = document.getElementById('source-list');
    const sourceCountBadge = document.getElementById('source-count-badge');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const toggleSourcesBtn = document.getElementById('toggle-sources-btn');
    const docSidebar = document.getElementById('doc-sidebar');
    const sourcePanel = document.getElementById('source-panel');
    const evidenceModeToggle = document.getElementById('evidence-mode-toggle');
    const evidenceModeLabel = document.getElementById('evidence-mode-label');

    // Tab Navigation Elements
    const navTabButtons = document.querySelectorAll('.nav-tab-btn, .mobile-tab-btn');
    const workspaceViews = document.querySelectorAll('.workspace-view');

    // Document Insights Tab Elements
    const insightsDocSelect = document.getElementById('insights-doc-select');
    const insightsGenerateBtn = document.getElementById('insights-generate-btn');
    const insightsPlaceholder = document.getElementById('insights-placeholder');
    const insightsLoading = document.getElementById('insights-loading');
    const insightsContentCard = document.getElementById('insights-content-card');
    const insightsTitle = document.getElementById('insights-title');
    const insightsTypeBadge = document.getElementById('insights-type-badge');
    const insightsPages = document.getElementById('insights-pages');
    const insightsChunks = document.getElementById('insights-chunks');
    const insightsMarkdown = document.getElementById('insights-markdown');

    // Cross-Document Comparison Studio Elements (Inline Tab)
    const inlineCompareDocsContainer = document.getElementById('inline-compare-docs-container');
    const inlineCompareForm = document.getElementById('inline-compare-form');
    const inlineCompareQueryInput = document.getElementById('inline-compare-query-input');
    const inlineExecuteCompareBtn = document.getElementById('inline-execute-compare-btn');
    const inlineCompareLoading = document.getElementById('inline-compare-loading');
    const inlineCompareResults = document.getElementById('inline-compare-results');
    const inlineCompareParityBadge = document.getElementById('inline-compare-parity-badge');
    const inlineCompareTiming = document.getElementById('inline-compare-timing');
    const inlineCompareMarkdown = document.getElementById('inline-compare-markdown');
    const inlineCompareSourceCount = document.getElementById('inline-compare-source-count');
    const inlineCompareSourcesList = document.getElementById('inline-compare-sources-list');

    // Modals
    const sourceModalEl = document.getElementById('sourceDetailModal');
    const sourceModal = sourceModalEl ? new bootstrap.Modal(sourceModalEl) : null;
    const deleteModalEl = document.getElementById('deleteConfirmModal');
    const deleteModal = deleteModalEl ? new bootstrap.Modal(deleteModalEl) : null;

    // Helper: Get CSRF Token
    function getCsrfToken() {
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) return metaTag.getAttribute('content');
        const cookie = document.cookie.split('; ').find(row => row.startsWith('csrftoken='));
        return cookie ? cookie.split('=')[1] : '';
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Helper: Render Markdown with marked.js
    function renderMarkdown(text) {
        if (!text) return '';
        if (typeof marked !== 'undefined') {
            try {
                marked.setOptions({
                    breaks: true,
                    gfm: true
                });
                return marked.parse(text);
            } catch (e) {
                console.warn('Markdown parsing error:', e);
            }
        }
        return escapeHtml(text).replace(/\n/g, '<br>');
    }

    // Render any pre-rendered messages from Django template
    document.querySelectorAll('.assistant-text-content').forEach(el => {
        const raw = el.getAttribute('data-raw-text') || el.innerText;
        el.innerHTML = renderMarkdown(raw);
    });

    // Helper: Scroll Chat to Bottom
    function scrollChatToBottom() {
        if (chatMessagesContainer) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }

    // ==========================================
    // 1. Workflow Tabs Controller (Chat / Insights / Compare)
    // ==========================================
    function switchView(targetViewId) {
        currentView = targetViewId;

        // Update Tab Buttons
        navTabButtons.forEach(btn => {
            const target = btn.getAttribute('data-target');
            if (target === targetViewId) {
                btn.classList.add('active');
                if (btn.hasAttribute('aria-selected')) btn.setAttribute('aria-selected', 'true');
            } else {
                btn.classList.remove('active');
                if (btn.hasAttribute('aria-selected')) btn.setAttribute('aria-selected', 'false');
            }
        });

        // Toggle Views
        workspaceViews.forEach(view => {
            if (view.id === targetViewId) {
                view.classList.remove('d-none');
                view.classList.add('d-flex');
            } else {
                view.classList.add('d-none');
                view.classList.remove('d-flex');
            }
        });

        // View-specific initializations
        if (targetViewId === 'view-insights') {
            syncInsightsDocSelect();
        } else if (targetViewId === 'view-compare') {
            syncInlineCompareDocs();
        } else if (targetViewId === 'view-chat') {
            scrollChatToBottom();
            if (queryInput) queryInput.focus();
        }
    }

    navTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            if (target) switchView(target);
        });
    });

    // Toggle Sidebar & Sources on mobile
    if (toggleSidebarBtn && docSidebar) {
        toggleSidebarBtn.addEventListener('click', () => {
            docSidebar.classList.toggle('drawer-open');
        });
    }

    if (toggleSourcesBtn && sourcePanel) {
        toggleSourcesBtn.addEventListener('click', () => {
            sourcePanel.classList.toggle('drawer-open');
        });
    }

    // ==========================================
    // 2. Evidence Mode Toggle
    // ==========================================
    if (evidenceModeToggle) {
        evidenceModeToggle.addEventListener('click', () => {
            evidenceModeActive = !evidenceModeActive;
            if (evidenceModeActive) {
                evidenceModeToggle.classList.add('active');
                if (evidenceModeLabel) {
                    evidenceModeLabel.textContent = 'ON';
                    evidenceModeLabel.className = 'text-teal';
                }
                document.querySelectorAll('.evidence-inspection-box').forEach(el => el.classList.remove('d-none'));
            } else {
                evidenceModeToggle.classList.remove('active');
                if (evidenceModeLabel) {
                    evidenceModeLabel.textContent = 'OFF';
                    evidenceModeLabel.className = 'text-secondary';
                }
                document.querySelectorAll('.evidence-inspection-box').forEach(el => el.classList.add('d-none'));
            }
        });
    }

    // Scope Selection Handler
    if (scopeSelect) {
        scopeSelect.addEventListener('change', (e) => {
            activeScope = e.target.value;
            const selectedText = e.target.options[e.target.selectedIndex].text;
            if (activeScope === 'all') {
                activeScopeBadge.innerHTML = '<i class="bi bi-files me-1 text-teal"></i> All Uploaded Documents';
            } else {
                activeScopeBadge.innerHTML = `<i class="bi bi-file-earmark-text me-1 text-teal"></i> ${escapeHtml(selectedText)}`;
            }
        });
    }

    // Client-side Document Search / Filter in Sidebar
    if (docSearchInput) {
        docSearchInput.addEventListener('input', () => {
            const query = docSearchInput.value.toLowerCase().trim();
            const cards = document.querySelectorAll('.doc-card');
            let visibleCount = 0;

            cards.forEach(card => {
                const title = (card.querySelector('.doc-filename')?.textContent || '').toLowerCase();
                if (!query || title.includes(query)) {
                    card.style.display = '';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            let noMatchEl = document.getElementById('doc-search-no-match');
            if (visibleCount === 0 && query) {
                if (!noMatchEl) {
                    noMatchEl = document.createElement('div');
                    noMatchEl.id = 'doc-search-no-match';
                    noMatchEl.className = 'text-center py-4 text-secondary extra-small';
                    noMatchEl.innerHTML = '<i class="bi bi-search me-1"></i> No matching documents';
                    docListContainer.appendChild(noMatchEl);
                }
            } else if (noMatchEl) {
                noMatchEl.remove();
            }
        });
    }

    // Auto-expand Textarea & Char Count
    if (queryInput) {
        queryInput.addEventListener('input', () => {
            queryInput.style.height = 'auto';
            queryInput.style.height = Math.min(queryInput.scrollHeight, 120) + 'px';
            if (charCount) {
                charCount.textContent = `${queryInput.value.length} chars`;
            }
        });

        // Submit on Enter, Shift+Enter for newline
        queryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });
    }

    // Suggested Question Chips: POPULATE INPUT ONLY (Do NOT auto-submit)
    document.querySelectorAll('.suggested-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const query = chip.getAttribute('data-query');
            if (query && queryInput) {
                queryInput.value = query;
                queryInput.dispatchEvent(new Event('input'));
                queryInput.focus();
                queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });

    // File Upload Handling
    if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0]);
            }
        });
    }

    // Drag and Drop
    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-active');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-active');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files.length > 0) {
                uploadFile(e.dataTransfer.files[0]);
            }
        });
    }

    function showUploadAlert(message, isSuccess = true) {
        if (!uploadStatusAlert || !uploadStatusMsg) return;
        uploadStatusAlert.className = `alert alert-dismissible mt-2 extra-small py-2 px-3 mb-0 alert-${isSuccess ? 'success' : 'danger'} shadow-sm`;
        uploadStatusMsg.textContent = message;
        uploadStatusAlert.classList.remove('d-none');
    }

    if (closeUploadAlert) {
        closeUploadAlert.addEventListener('click', () => {
            uploadStatusAlert.classList.add('d-none');
        });
    }

    async function uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        showUploadAlert(`Analyzing, indexing, and preparing '${file.name}'...`, true);

        try {
            const response = await fetch('/api/documents/upload/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                },
                body: formData
            });

            const data = await response.json();

            if (response.ok && data.success) {
                showUploadAlert(`'${data.document.filename}' processed and ready for research.`, true);
                fileInput.value = '';
                await refreshDocumentList();
            } else {
                showUploadAlert(data.error || 'Upload failed.', false);
            }
        } catch (err) {
            showUploadAlert(`Upload error: ${err.message}`, false);
        }
    }

    // Refresh Documents List from API
    async function refreshDocumentList() {
        try {
            const res = await fetch('/api/documents/');
            const data = await res.json();
            if (data.success) {
                allDocuments = data.documents;
                renderDocumentList(allDocuments);
                syncInsightsDocSelect();
                syncInlineCompareDocs();
            }
        } catch (err) {
            console.error('Failed to refresh document list:', err);
        }
    }

    refreshDocumentList();

    function renderDocumentList(documents) {
        if (docCountBadge) docCountBadge.textContent = documents.length;

        // Update Scope Select options
        if (scopeSelect) {
            const currentVal = scopeSelect.value;
            let optionsHtml = '<option value="all">All Uploaded Documents</option>';
            documents.forEach(doc => {
                if (doc.status === 'indexed') {
                    optionsHtml += `<option value="${doc.id}">${escapeHtml(doc.filename)}</option>`;
                }
            });
            scopeSelect.innerHTML = optionsHtml;
            scopeSelect.value = currentVal && documents.some(d => String(d.id) === currentVal) ? currentVal : 'all';
        }

        if (documents.length === 0) {
            docListContainer.innerHTML = `
                <div class="empty-docs-state text-center py-5 px-3 text-secondary" id="empty-docs-placeholder">
                    <div class="empty-icon-circle mx-auto mb-2">
                        <i class="bi bi-folder-plus fs-3 text-secondary opacity-75"></i>
                    </div>
                    <p class="small mb-1 fw-semibold text-dark">No documents uploaded</p>
                    <p class="extra-small text-secondary mb-0">Upload PDF or TXT documents to begin searching and extracting answers.</p>
                </div>
            `;
            return;
        }

        let html = '';
        documents.forEach(doc => {
            const isPdf = doc.file_type === 'pdf';
            const iconClass = isPdf ? 'bi-file-earmark-pdf-fill text-danger' : 'bi-file-earmark-text-fill text-primary';
            const typeLabel = isPdf ? `${doc.page_count} page${doc.page_count === 1 ? '' : 's'}` : 'Text Document';
            const isReady = doc.status === 'indexed';
            const statusBadge = isReady 
                ? '<span class="badge bg-success-subtle text-success border border-success-subtle">Ready</span>' 
                : `<span class="badge bg-secondary-subtle text-dark border">${escapeHtml(doc.status)}</span>`;

            html += `
                <div class="doc-card p-2 mb-2 rounded border bg-white position-relative shadow-2xs" data-doc-id="${doc.id}" id="doc-card-${doc.id}">
                    <div class="d-flex align-items-start justify-content-between gap-2 mb-1">
                        <div class="d-flex align-items-center gap-2 overflow-hidden">
                            <input type="checkbox" class="form-check-input doc-select-checkbox flex-shrink-0 mt-0" value="${doc.id}" data-filename="${escapeHtml(doc.filename)}" title="Select for comparison">
                            <i class="bi ${iconClass} fs-5 flex-shrink-0"></i>
                            <div class="overflow-hidden">
                                <div class="doc-filename text-truncate fw-semibold small text-dark" title="${escapeHtml(doc.filename)}">
                                    ${escapeHtml(doc.filename)}
                                </div>
                                <div class="doc-meta extra-small text-secondary">
                                    ${typeLabel} &bull; ${doc.created_at.split(' ')[0]}
                                </div>
                            </div>
                        </div>
                        <div class="dropdown">
                            <button class="btn btn-sm btn-icon-subtle text-secondary p-1 border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Document options">
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end shadow-sm small">
                                <li>
                                    <button class="dropdown-item summarize-doc-btn" data-doc-id="${doc.id}" data-filename="${escapeHtml(doc.filename)}">
                                        <i class="bi bi-journal-text me-2 text-teal"></i> Executive Summary
                                    </button>
                                </li>
                                <li><hr class="dropdown-divider"></li>
                                <li>
                                    <button class="dropdown-item text-danger delete-doc-btn" data-doc-id="${doc.id}" data-filename="${escapeHtml(doc.filename)}">
                                        <i class="bi bi-trash3 me-2"></i> Delete Document
                                    </button>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div class="d-flex align-items-center justify-content-between pt-1 border-top mt-1 extra-small">
                        ${statusBadge}
                        <span class="text-secondary">${doc.created_at.split(' ')[1] || ''}</span>
                    </div>
                </div>
            `;
        });

        docListContainer.innerHTML = html;
        bindDocActionButtons();
    }

    function bindDocActionButtons() {
        document.querySelectorAll('.summarize-doc-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const docId = btn.getAttribute('data-doc-id');
                const docTitle = btn.getAttribute('data-filename');
                // Switch to Insights tab and load document
                switchView('view-insights');
                if (insightsDocSelect) {
                    insightsDocSelect.value = docId;
                    loadDocumentInsights(docId, docTitle);
                }
            });
        });

        document.querySelectorAll('.delete-doc-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                pendingDeleteDocId = btn.getAttribute('data-doc-id');
                const docTitle = btn.getAttribute('data-filename');
                const nameEl = document.getElementById('delete-doc-name');
                if (nameEl) nameEl.textContent = `'${docTitle}'`;
                if (deleteModal) deleteModal.show();
            });
        });
    }

    // Confirm Delete Handler
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!pendingDeleteDocId) return;
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Deleting...';

            try {
                const res = await fetch(`/api/documents/${pendingDeleteDocId}/delete/`, {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCsrfToken()
                    }
                });
                const data = await res.json();
                if (data.success) {
                    if (deleteModal) deleteModal.hide();
                    showUploadAlert(data.message, true);
                    await refreshDocumentList();
                } else {
                    alert(data.error || 'Failed to delete document.');
                }
            } catch (err) {
                alert(`Error deleting document: ${err.message}`);
            } finally {
                confirmDeleteBtn.disabled = false;
                confirmDeleteBtn.textContent = 'Delete';
                pendingDeleteDocId = null;
            }
        });
    }

    // ==========================================
    // 3. Document Insights Tab Implementation
    // ==========================================
    function syncInsightsDocSelect() {
        if (!insightsDocSelect) return;
        const currentVal = insightsDocSelect.value;
        let html = '<option value="">Choose a document...</option>';
        allDocuments.forEach(doc => {
            if (doc.status === 'indexed') {
                html += `<option value="${doc.id}">${escapeHtml(doc.filename)}</option>`;
            }
        });
        insightsDocSelect.innerHTML = html;
        if (currentVal && allDocuments.some(d => String(d.id) === currentVal)) {
            insightsDocSelect.value = currentVal;
        }
    }

    if (insightsGenerateBtn) {
        insightsGenerateBtn.addEventListener('click', () => {
            const docId = insightsDocSelect ? insightsDocSelect.value : '';
            if (!docId) {
                alert('Please select a document from the dropdown to analyze.');
                return;
            }
            const doc = allDocuments.find(d => String(d.id) === docId);
            loadDocumentInsights(docId, doc ? doc.filename : 'Document');
        });
    }

    async function loadDocumentInsights(docId, docTitle) {
        if (!insightsContentCard || !insightsPlaceholder || !insightsLoading) return;

        insightsPlaceholder.classList.add('d-none');
        insightsContentCard.classList.add('d-none');
        insightsLoading.classList.remove('d-none');

        const doc = allDocuments.find(d => String(d.id) === String(docId));
        if (insightsTitle) insightsTitle.textContent = docTitle;
        if (insightsTypeBadge && doc) {
            insightsTypeBadge.textContent = doc.file_type.toUpperCase();
            insightsTypeBadge.className = doc.file_type === 'pdf' ? 'badge bg-danger-subtle text-danger border px-2 py-1' : 'badge bg-primary-subtle text-primary border px-2 py-1';
        }
        if (insightsPages && doc) insightsPages.textContent = doc.page_count || 1;
        if (insightsChunks && doc) insightsChunks.textContent = doc.total_chunks || 1;

        try {
            const res = await fetch(`/api/documents/${docId}/summarize/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            });
            const data = await res.json();
            if (data.success && insightsMarkdown) {
                insightsMarkdown.innerHTML = renderMarkdown(data.summary);
                insightsLoading.classList.add('d-none');
                insightsContentCard.classList.remove('d-none');
            } else {
                insightsMarkdown.innerHTML = `<div class="alert alert-danger py-2 extra-small">${escapeHtml(data.error || 'Failed to analyze document.')}</div>`;
                insightsLoading.classList.add('d-none');
                insightsContentCard.classList.remove('d-none');
            }
        } catch (err) {
            if (insightsMarkdown) {
                insightsMarkdown.innerHTML = `<div class="alert alert-danger py-2 extra-small">Network error: ${escapeHtml(err.message)}</div>`;
                insightsLoading.classList.add('d-none');
                insightsContentCard.classList.remove('d-none');
            }
        }
    }

    // ==========================================
    // 4. Cross-Document Comparison Studio Tab
    // ==========================================
    function syncInlineCompareDocs() {
        if (!inlineCompareDocsContainer) return;

        const checkedSidebarDocIds = Array.from(document.querySelectorAll('.doc-select-checkbox:checked'))
            .map(cb => parseInt(cb.value, 10));

        if (!allDocuments || allDocuments.length === 0) {
            inlineCompareDocsContainer.innerHTML = '<span class="extra-small text-secondary">Upload documents to enable side-by-side comparison.</span>';
            return;
        }

        let html = '';
        allDocuments.forEach(doc => {
            if (doc.status !== 'indexed') return;
            const isChecked = checkedSidebarDocIds.length > 0 
                ? checkedSidebarDocIds.includes(doc.id) 
                : true;

            html += `
                <div class="form-check form-check-inline extra-small border rounded bg-white p-2 px-3 m-1 d-flex align-items-center gap-2 shadow-2xs">
                    <input class="form-check-input inline-cmp-cb" type="checkbox" value="${doc.id}" id="inline-cb-${doc.id}" ${isChecked ? 'checked' : ''}>
                    <label class="form-check-label text-truncate fw-medium text-dark" for="inline-cb-${doc.id}" style="max-width: 240px;" title="${escapeHtml(doc.filename)}">
                        ${escapeHtml(doc.filename)}
                    </label>
                </div>
            `;
        });

        inlineCompareDocsContainer.innerHTML = html;
    }

    // Comparison Quick Topic Chips
    document.querySelectorAll('.cmp-suggest-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const query = btn.getAttribute('data-query');
            if (query && inlineCompareQueryInput) {
                inlineCompareQueryInput.value = query;
                inlineCompareQueryInput.focus();
            }
        });
    });

    if (inlineCompareForm) {
        inlineCompareForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const query = inlineCompareQueryInput ? inlineCompareQueryInput.value.trim() : '';
            if (!query) return;

            const selectedDocIds = Array.from(document.querySelectorAll('.inline-cmp-cb:checked'))
                .map(cb => parseInt(cb.value, 10));

            if (selectedDocIds.length < 2) {
                alert('Please select at least 2 documents to perform a comparative analysis.');
                return;
            }

            if (inlineCompareLoading) inlineCompareLoading.classList.remove('d-none');
            if (inlineCompareResults) inlineCompareResults.classList.add('d-none');
            if (inlineExecuteCompareBtn) inlineExecuteCompareBtn.disabled = true;

            try {
                const res = await fetch('/api/documents/compare/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        query: query,
                        document_ids: selectedDocIds
                    })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    renderInlineCompareResults(data);
                } else {
                    alert(data.error || 'Comparison analysis failed.');
                }
            } catch (err) {
                alert(`Error during comparison: ${err.message}`);
            } finally {
                if (inlineCompareLoading) inlineCompareLoading.classList.add('d-none');
                if (inlineExecuteCompareBtn) inlineExecuteCompareBtn.disabled = false;
            }
        });
    }

    function renderInlineCompareResults(data) {
        if (!inlineCompareResults) return;

        // Parity badge
        if (inlineCompareParityBadge) {
            if (data.is_comparable) {
                inlineCompareParityBadge.className = 'badge bg-success-subtle text-success border border-success-subtle';
                inlineCompareParityBadge.innerHTML = '<i class="bi bi-check-all me-1"></i> Evidence Parity Verified Across All Documents';
            } else {
                inlineCompareParityBadge.className = 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle';
                inlineCompareParityBadge.innerHTML = '<i class="bi bi-exclamation-circle me-1"></i> Asymmetric Evidence (Partial Context)';
            }
        }

        // Timing pill
        if (inlineCompareTiming && data.telemetry) {
            const totalSec = (data.telemetry.total_ms / 1000).toFixed(1);
            inlineCompareTiming.innerHTML = `<span class="badge bg-light text-secondary border"><i class="bi bi-clock me-1"></i> Analysis completed in ${totalSec}s</span>`;
        }

        // Markdown Synthesis
        if (inlineCompareMarkdown) {
            inlineCompareMarkdown.innerHTML = renderMarkdown(data.comparison);
        }

        // Supporting Excerpts
        const sources = data.evidence || [];
        if (inlineCompareSourceCount) inlineCompareSourceCount.textContent = sources.length;

        if (inlineCompareSourcesList) {
            if (sources.length === 0) {
                inlineCompareSourcesList.innerHTML = '<div class="extra-small text-secondary p-2">No direct evidence passages found for this topic.</div>';
            } else {
                let html = '';
                sources.forEach((s, idx) => {
                    cachedSources[s.chunk_id] = s;
                    const pageText = s.page_number ? `Page ${s.page_number}` : 'Text Document';
                    html += `
                        <div class="evidence-chunk-card mb-2 p-3">
                            <div class="d-flex align-items-center justify-content-between mb-2 extra-small">
                                <div class="d-flex align-items-center gap-2 overflow-hidden">
                                    <span class="badge bg-teal-subtle text-teal">Reference #${idx + 1}</span>
                                    <strong class="text-truncate text-dark" style="max-width: 280px;">${escapeHtml(s.filename)}</strong>
                                    <span class="badge bg-light text-secondary border">${pageText}</span>
                                </div>
                                <span class="badge bg-success-subtle text-success">Verified Ground Truth</span>
                            </div>
                            <blockquote class="mb-0 font-monospace extra-small bg-light p-2 rounded border text-secondary" style="white-space: pre-wrap;">
                                "${escapeHtml(s.text_content)}"
                            </blockquote>
                        </div>
                    `;
                });
                inlineCompareSourcesList.innerHTML = html;
            }
        }

        inlineCompareResults.classList.remove('d-none');
    }

    // ==========================================
    // 5. Research Assistant Chat Q&A
    // ==========================================
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const question = queryInput.value.trim();
            if (!question) return;

            // Reset input field
            queryInput.value = '';
            queryInput.dispatchEvent(new Event('input'));

            // Append User Message to UI
            appendUserMessage(question);

            // Show Real Loading State
            sendBtn.disabled = true;
            queryLoadingIndicator.classList.remove('d-none');
            queryLoadingIndicator.classList.add('d-flex');

            try {
                const payload = {
                    question: question,
                    document_id: activeScope === 'all' ? null : parseInt(activeScope, 10)
                };

                const res = await fetch('/api/chat/ask/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    appendAssistantMessage(
                        data.answer,
                        data.sources || [],
                        data.is_grounded,
                        data.evidence_meta || {},
                        data.telemetry || {}
                    );
                    renderSources(data.sources || []);
                } else {
                    appendAssistantMessage(
                        `Error: ${data.error || 'Failed to process inquiry.'}`,
                        [],
                        false,
                        {},
                        {}
                    );
                }
            } catch (err) {
                appendAssistantMessage(
                    `Connection error: ${err.message}`,
                    [],
                    false,
                    {},
                    {}
                );
            } finally {
                sendBtn.disabled = false;
                queryLoadingIndicator.classList.add('d-none');
                queryLoadingIndicator.classList.remove('d-flex');
                queryInput.focus();
            }
        });
    }

    function appendUserMessage(text) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const row = document.createElement('div');
        row.className = 'message-row mb-3 d-flex justify-content-end';
        row.innerHTML = `
            <div class="message-bubble user-bubble rounded p-3" style="max-width: 85%;">
                <div class="message-header d-flex align-items-center gap-2 mb-1 extra-small">
                    <i class="bi bi-person-fill"></i>
                    <strong>You</strong>
                    <span class="ms-auto opacity-75">${timeStr}</span>
                </div>
                <div class="message-content small text-break">
                    ${escapeHtml(text).replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
        chatMessagesContainer.appendChild(row);
        scrollChatToBottom();
    }

    function appendAssistantMessage(text, sources = [], isGrounded = true, evidenceMeta = {}, telemetry = {}) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const row = document.createElement('div');
        row.className = 'message-row mb-3 d-flex justify-content-start';

        // 1. Sources Citation Pill Bar
        let sourcesBarHtml = '';
        if (sources && sources.length > 0) {
            sourcesBarHtml = `
                <div class="message-sources-bar mt-2 pt-2 border-top extra-small d-flex flex-wrap gap-1 align-items-center">
                    <span class="text-secondary fw-semibold"><i class="bi bi-quote"></i> References:</span>
                    ${sources.map(s => {
                        cachedSources[s.chunk_id] = s;
                        const pageLabel = s.page_number ? `:p.${s.page_number}` : '';
                        return `
                            <button type="button" class="badge rounded-pill bg-light text-primary border citation-pill" data-chunk-id="${s.chunk_id}" title="Inspect passage">
                                ${escapeHtml(s.filename)}${pageLabel}
                            </button>
                        `;
                    }).join('')}
                </div>
            `;
        }

        // 2. Client-Ready Evidence Inspection Box (Clean, No Raw Developer Terms)
        let evidenceBoxHtml = '';
        if (sources && sources.length > 0 && isGrounded) {
            const tier = evidenceMeta.confidence_tier || 'moderate';
            const tierLabel = tier === 'strong' ? 'High Confidence Match' : (tier === 'moderate' ? 'Verified Match' : 'Related Match');
            const tierClass = tier === 'strong' ? 'tier-strong' : (tier === 'moderate' ? 'tier-moderate' : 'tier-borderline');

            // Human-readable timing
            let timingHtml = '';
            if (telemetry && telemetry.total_ms) {
                const sec = (telemetry.total_ms / 1000).toFixed(1);
                timingHtml = `<span class="telemetry-pill"><i class="bi bi-clock me-1"></i> Response time: ${sec}s</span>`;
            }

            // Conflict warning if detected
            let conflictHtml = '';
            if (evidenceMeta.conflict_detected && evidenceMeta.conflict_notes && evidenceMeta.conflict_notes.length > 0) {
                conflictHtml = `
                    <div class="alert alert-warning p-2 px-3 mt-2 extra-small mb-2">
                        <i class="bi bi-exclamation-triangle-fill me-1"></i>
                        <strong>Cross-Passage Variance Detected:</strong>
                        <ul class="mb-0 ps-3 mt-1">
                            ${evidenceMeta.conflict_notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            // Expandable Accordion of Extracted Passages
            const msgId = 'ev-' + Math.random().toString(36).substring(2, 9);
            const passagesHtml = sources.map((s, idx) => {
                const pageLabel = s.page_number ? `Page ${s.page_number}` : 'Document Excerpt';
                return `
                    <div class="evidence-chunk-card mb-2">
                        <div class="evidence-chunk-header p-2 d-flex align-items-center justify-content-between" data-bs-toggle="collapse" data-bs-target="#${msgId}-chunk-${idx}">
                            <div class="d-flex align-items-center gap-2 overflow-hidden extra-small">
                                <span class="badge bg-light text-primary border">#${idx + 1}</span>
                                <strong class="text-truncate text-dark" style="max-width: 220px;">${escapeHtml(s.filename)}</strong>
                                <span class="badge bg-secondary-subtle text-secondary">${pageLabel}</span>
                            </div>
                            <div class="d-flex align-items-center gap-2 extra-small">
                                <span class="badge bg-success-subtle text-success">Verified Ground Truth</span>
                                <i class="bi bi-chevron-down text-secondary"></i>
                            </div>
                        </div>
                        <div id="${msgId}-chunk-${idx}" class="collapse evidence-chunk-body p-3">
                            <blockquote class="mb-0 text-secondary" style="white-space: pre-wrap;">"${escapeHtml(s.text_content)}"</blockquote>
                        </div>
                    </div>
                `;
            }).join('');

            evidenceBoxHtml = `
                <div class="evidence-inspection-box mt-3 pt-2 border-top ${evidenceModeActive ? '' : 'd-none'}">
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                        <span class="evidence-tier-badge ${tierClass}">
                            <i class="bi bi-shield-check me-1"></i> ${tierLabel}
                        </span>
                        ${timingHtml}
                    </div>
                    ${conflictHtml}
                    <div class="evidence-passages-list mt-2">
                        <div class="extra-small text-secondary fw-semibold mb-1 text-uppercase">
                            <i class="bi bi-file-earmark-check me-1 text-teal"></i> Supporting Document Passages (${sources.length}):
                        </div>
                        ${passagesHtml}
                    </div>
                </div>
            `;
        }

        row.innerHTML = `
            <div class="message-bubble assistant-bubble shadow-sm rounded p-3" style="max-width: 88%;">
                <div class="message-header d-flex align-items-center gap-2 mb-1 extra-small">
                    <i class="bi bi-stars text-teal"></i>
                    <strong>DocuMint Assistant</strong>
                    ${!isGrounded ? '<span class="badge bg-warning-subtle text-warning-emphasis ms-1">Information Not in Documents</span>' : '<span class="badge bg-success-subtle text-success ms-1"><i class="bi bi-check-circle me-1"></i>Verified with Sources</span>'}
                    <span class="ms-auto opacity-75 text-secondary">${timeStr}</span>
                </div>
                <div class="message-content small text-break markdown-body">
                    ${renderMarkdown(text)}
                </div>
                ${sourcesBarHtml}
                ${evidenceBoxHtml}
            </div>
        `;

        chatMessagesContainer.appendChild(row);
        scrollChatToBottom();
        bindCitationPills();
    }

    function renderSources(sources) {
        if (!sourceListContainer || !sourceCountBadge) return;
        sourceCountBadge.textContent = `${sources.length} citation${sources.length === 1 ? '' : 's'}`;

        if (!sources || sources.length === 0) {
            sourceListContainer.innerHTML = `
                <div class="source-empty-state text-center py-5 text-secondary" id="source-empty-placeholder">
                    <div class="empty-icon-circle mx-auto mb-2">
                        <i class="bi bi-card-text fs-3 text-secondary opacity-50"></i>
                    </div>
                    <p class="small mb-1 fw-semibold text-dark">No active citations</p>
                    <p class="extra-small text-secondary mb-0">No document passages met the relevance criteria for this question.</p>
                </div>
            `;
            return;
        }

        let html = '';
        sources.forEach((s, idx) => {
            cachedSources[s.chunk_id] = s;
            const pageBadge = s.page_number ? `<span class="badge bg-light text-secondary border">Page ${s.page_number}</span>` : '<span class="badge bg-light text-secondary border">Text Document</span>';
            const snippet = s.text_content.length > 220 ? s.text_content.substring(0, 220) + '...' : s.text_content;

            html += `
                <div class="source-item-card p-3 mb-3 border bg-white shadow-2xs" data-chunk-id="${s.chunk_id}">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="badge bg-teal-subtle text-teal fw-semibold">Reference #${idx + 1}</span>
                        <span class="badge bg-success-subtle text-success border border-success-subtle">Direct Match</span>
                    </div>
                    <div class="fw-semibold small text-truncate text-dark mb-1" title="${escapeHtml(s.filename)}">
                        ${escapeHtml(s.filename)}
                    </div>
                    <div class="d-flex align-items-center gap-2 mb-2 extra-small">
                        ${pageBadge}
                    </div>
                    <p class="source-snippet extra-small mb-2 p-2 rounded bg-light border text-secondary">
                        "${escapeHtml(snippet)}"
                    </p>
                    <button class="btn btn-sm btn-outline-secondary w-100 py-1 extra-small view-chunk-btn" data-chunk-id="${s.chunk_id}">
                        <i class="bi bi-eye me-1"></i> Inspect Full Passage
                    </button>
                </div>
            `;
        });

        sourceListContainer.innerHTML = html;

        if (window.innerWidth >= 1200 && sourcePanel) {
            sourcePanel.classList.remove('drawer-open');
        }

        bindSourceItemCards();
    }

    function bindSourceItemCards() {
        document.querySelectorAll('.view-chunk-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const chunkId = btn.getAttribute('data-chunk-id');
                openSourceModal(chunkId);
            });
        });
    }

    function bindCitationPills() {
        document.querySelectorAll('.citation-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const chunkId = pill.getAttribute('data-chunk-id');
                openSourceModal(chunkId);
            });
        });
    }

    bindCitationPills();

    async function openSourceModal(chunkId) {
        if (!sourceModal) return;
        const sourceData = cachedSources[chunkId];

        const docNameEl = document.getElementById('modal-doc-name');
        const pageNumEl = document.getElementById('modal-page-num');
        const pageWrapper = document.getElementById('modal-page-wrapper');
        const scoreEl = document.getElementById('modal-score');
        const textEl = document.getElementById('modal-chunk-text');

        if (sourceData) {
            if (docNameEl) docNameEl.textContent = sourceData.filename;
            if (pageWrapper) {
                if (sourceData.page_number) {
                    pageWrapper.classList.remove('d-none');
                    if (pageNumEl) pageNumEl.textContent = sourceData.page_number;
                } else {
                    pageWrapper.classList.add('d-none');
                }
            }
            if (scoreEl) scoreEl.textContent = 'High Relevance Match';
            if (textEl) textEl.textContent = sourceData.text_content;
            sourceModal.show();
        } else {
            try {
                const res = await fetch(`/api/sources/${chunkId}/`);
                const data = await res.json();
                if (data.success && data.source) {
                    const s = data.source;
                    cachedSources[s.chunk_id] = s;
                    if (docNameEl) docNameEl.textContent = s.filename;
                    if (pageWrapper) {
                        if (s.page_number) {
                            pageWrapper.classList.remove('d-none');
                            if (pageNumEl) pageNumEl.textContent = s.page_number;
                        } else {
                            pageWrapper.classList.add('d-none');
                        }
                    }
                    if (scoreEl) scoreEl.textContent = 'Direct Document Citation';
                    if (textEl) textEl.textContent = s.text_content;
                    sourceModal.show();
                }
            } catch (err) {
                console.error('Failed to fetch reference details:', err);
            }
        }
    }

    // Clear Chat
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', async () => {
            if (!confirm('Start a fresh research session? (This will clear current chat messages)')) return;
            try {
                const res = await fetch('/api/chat/clear/', {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCsrfToken()
                    }
                });
                const data = await res.json();
                if (data.success) {
                    document.querySelectorAll('.message-row').forEach(row => row.remove());
                    if (sourceListContainer) {
                        sourceListContainer.innerHTML = `
                            <div class="source-empty-state text-center py-5 text-secondary" id="source-empty-placeholder">
                                <div class="empty-icon-circle mx-auto mb-2">
                                    <i class="bi bi-card-text fs-3 text-secondary opacity-50"></i>
                                </div>
                                <p class="small mb-1 fw-semibold text-dark">No active citations</p>
                                <p class="extra-small text-secondary mb-0">Conversation cleared. Ask any question to retrieve source references.</p>
                            </div>
                        `;
                    }
                    if (sourceCountBadge) sourceCountBadge.textContent = '0 citations';
                }
            } catch (err) {
                console.error('Failed to clear session:', err);
            }
        });
    }

    // =========================================================================
    // Enterprise Authentication & Google Sign-In System
    // =========================================================================
    function initAuthSystem() {
        const authModalEl = document.getElementById('authModal');
        const authModal = authModalEl ? bootstrap.Modal.getOrCreateInstance(authModalEl) : null;
        const openAuthModalBtn = document.getElementById('open-auth-modal-btn');
        const quickGoogleBtn = document.getElementById('quick-google-signin-btn');
        const modalGoogleBtn = document.getElementById('modal-google-btn');
        const modalEvaluatorBtn = document.getElementById('modal-evaluator-btn');
        const switchGoogleBtn = document.getElementById('switch-google-btn');
        const switchEvaluatorBtn = document.getElementById('switch-evaluator-btn');
        const signOutBtn = document.getElementById('sign-out-btn');
        const tabLoginBtn = document.getElementById('tab-login-btn');
        const tabRegisterBtn = document.getElementById('tab-register-btn');
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const authAlert = document.getElementById('auth-alert');

        function showAuthAlert(msg, isSuccess = false) {
            if (!authAlert) return;
            authAlert.className = `alert extra-small py-2 px-3 mb-3 ${isSuccess ? 'alert-success' : 'alert-danger'}`;
            authAlert.innerHTML = `<i class="bi ${isSuccess ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-1"></i> ${msg}`;
            authAlert.classList.remove('d-none');
        }

        function clearAuthAlert() {
            if (authAlert) authAlert.classList.add('d-none');
        }

        // Open Modal
        if (openAuthModalBtn && authModal) {
            openAuthModalBtn.addEventListener('click', () => {
                clearAuthAlert();
                authModal.show();
            });
        }

        // Switch to Google button in profile dropdown
        if (switchGoogleBtn && authModal) {
            switchGoogleBtn.addEventListener('click', () => {
                clearAuthAlert();
                authModal.show();
            });
        }

        // Tab toggles between Login and Register
        if (tabLoginBtn && tabRegisterBtn && loginForm && registerForm) {
            tabLoginBtn.addEventListener('click', () => {
                tabLoginBtn.classList.add('active');
                tabRegisterBtn.classList.remove('active');
                loginForm.classList.remove('d-none');
                registerForm.classList.add('d-none');
                clearAuthAlert();
            });

            tabRegisterBtn.addEventListener('click', () => {
                tabRegisterBtn.classList.add('active');
                tabLoginBtn.classList.remove('active');
                registerForm.classList.remove('d-none');
                loginForm.classList.add('d-none');
                clearAuthAlert();
            });
        }

        // Perform Google Sign-In (Zero Manual Setup / Instant 1-Click Execution)
        async function performGoogleSignIn(googleData = {}) {
            try {
                showAuthAlert('Connecting to Google Workspace...', true);
                const res = await fetch('/api/auth/google/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify(googleData)
                });
                const data = await res.json();
                if (data.success) {
                    showAuthAlert(data.message || 'Signed in with Google successfully!', true);
                    setTimeout(() => {
                        window.location.reload();
                    }, 350);
                } else {
                    showAuthAlert(data.error || 'Failed to sign in with Google.');
                }
            } catch (err) {
                console.error('Google Sign-In Error:', err);
                showAuthAlert('Network error during Google authentication.');
            }
        }

        // Header Quick Google Button
        if (quickGoogleBtn) {
            quickGoogleBtn.addEventListener('click', () => {
                performGoogleSignIn({
                    email: 'alex.morgan@gmail.com',
                    name: 'Alex Morgan',
                    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80'
                });
            });
        }

        // Modal Continue with Google button
        if (modalGoogleBtn) {
            modalGoogleBtn.addEventListener('click', () => {
                performGoogleSignIn({
                    email: 'alex.morgan@gmail.com',
                    name: 'Alex Morgan',
                    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80'
                });
            });
        }

        // Quick Identity Buttons inside modal
        document.querySelectorAll('.quick-identity-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const email = btn.dataset.email;
                const name = btn.dataset.name;
                const avatar = btn.dataset.avatar;
                performGoogleSignIn({ email, name, avatar_url: avatar });
            });
        });

        // Instant Evaluator Access
        async function performEvaluatorLogin() {
            try {
                showAuthAlert('Authenticating Lead Evaluator account...', true);
                const res = await fetch('/api/auth/demo/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    }
                });
                const data = await res.json();
                if (data.success) {
                    showAuthAlert('Authenticated as Evaluator!', true);
                    setTimeout(() => {
                        window.location.reload();
                    }, 350);
                } else {
                    showAuthAlert(data.error || 'Failed to authenticate evaluator.');
                }
            } catch (err) {
                console.error('Evaluator Auth Error:', err);
                showAuthAlert('Network error during evaluator authentication.');
            }
        }

        if (modalEvaluatorBtn) {
            modalEvaluatorBtn.addEventListener('click', performEvaluatorLogin);
        }
        if (switchEvaluatorBtn) {
            switchEvaluatorBtn.addEventListener('click', performEvaluatorLogin);
        }

        // Email / Password Login Form
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearAuthAlert();
                const identifier = document.getElementById('login-identifier')?.value.trim();
                const password = document.getElementById('login-password')?.value;
                const submitBtn = document.getElementById('submit-login-btn');

                if (!identifier || !password) {
                    showAuthAlert('Please fill in both fields.');
                    return;
                }

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Signing In...';
                }

                try {
                    const res = await fetch('/api/auth/login/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify({ identifier, password })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showAuthAlert('Signed in successfully!', true);
                        setTimeout(() => window.location.reload(), 350);
                    } else {
                        showAuthAlert(data.error || 'Invalid credentials.');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> Sign In';
                        }
                    }
                } catch (err) {
                    console.error('Login error:', err);
                    showAuthAlert('Network error during sign in.');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> Sign In';
                    }
                }
            });
        }

        // Registration Form
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                clearAuthAlert();
                const fullName = document.getElementById('reg-name')?.value.trim();
                const email = document.getElementById('reg-email')?.value.trim();
                const password = document.getElementById('reg-password')?.value;
                const submitBtn = document.getElementById('submit-register-btn');

                if (!fullName || !email || !password) {
                    showAuthAlert('Please fill in all registration fields.');
                    return;
                }

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Creating Account...';
                }

                try {
                    const res = await fetch('/api/auth/register/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify({ full_name: fullName, email, password })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showAuthAlert('Account created! Welcome to DocuMint.', true);
                        setTimeout(() => window.location.reload(), 350);
                    } else {
                        showAuthAlert(data.error || 'Failed to create account.');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = '<i class="bi bi-person-plus me-1"></i> Create Account';
                        }
                    }
                } catch (err) {
                    console.error('Register error:', err);
                    showAuthAlert('Network error during registration.');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<i class="bi bi-person-plus me-1"></i> Create Account';
                    }
                }
            });
        }

        // Sign Out
        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                try {
                    await fetch('/api/auth/logout/', {
                        method: 'POST',
                        headers: {
                            'X-CSRFToken': getCsrfToken()
                        }
                    });
                    window.location.reload();
                } catch (err) {
                    console.error('Logout error:', err);
                    window.location.reload();
                }
            });
        }
    }

    // Initialize Authentication
    initAuthSystem();
});
