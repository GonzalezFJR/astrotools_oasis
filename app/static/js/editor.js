/* ============================================
   ASTROEDITOR — Main JavaScript
   Phase 1: Project management + image upload/classification
   ============================================ */

(() => {
    'use strict';

    // ── State ───────────────────────────────────
    let currentProject = null;
    let selectedFrameType = '';     // '' = auto-detect

    const API = '/editor/api';

    // ── DOM refs ────────────────────────────────
    const $splash = document.getElementById('editorSplash');
    const $workspace = document.getElementById('editorWorkspace');
    const $projectsList = document.getElementById('projectsList');
    const $createForm = document.getElementById('createProjectForm');

    // Toast
    const $toast = document.getElementById('editorToast');
    const $toastBody = document.getElementById('editorToastBody');
    let toastInstance = null;

    // ── Helpers ─────────────────────────────────
    function showToast(msg, type = 'success') {
        $toast.className = `toast align-items-center border-0 toast-${type}`;
        $toastBody.textContent = msg;
        if (!toastInstance) toastInstance = new bootstrap.Toast($toast, { delay: 3000 });
        toastInstance.show();
    }

    async function api(path, opts = {}) {
        const url = `${API}${path}`;
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...opts.headers },
            ...opts,
        });
        return res.json();
    }

    function fmtValue(v) {
        if (v === null || v === undefined || v === '') return '—';
        if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toFixed(2);
        return String(v);
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }); }
        catch { return iso; }
    }

    // ── Splash: load projects ───────────────────
    async function loadProjectsList() {
        try {
            const projects = await api('/projects');
            if (!projects.length) {
                $projectsList.innerHTML = '<p class="text-secondary text-center py-3">No hay proyectos guardados.</p>';
                return;
            }
            $projectsList.innerHTML = projects.map(p => `
                <div class="project-list-item" data-id="${p.id}">
                    <div class="proj-info">
                        <div class="proj-name">${escHtml(p.name)}</div>
                        <div class="proj-meta">${fmtDate(p.created)} · ${p.image_count} imágenes</div>
                    </div>
                    <div class="proj-actions">
                        <button class="btn btn-sm btn-outline-accent btn-open-project" data-id="${p.id}" title="Abrir">
                            <i class="bi bi-folder2-open"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger btn-delete-project" data-id="${p.id}" data-name="${escAttr(p.name)}" title="Eliminar">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');

            // Bind open
            $projectsList.querySelectorAll('.btn-open-project').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openProject(btn.dataset.id);
                });
            });
            // Bind row click
            $projectsList.querySelectorAll('.project-list-item').forEach(row => {
                row.addEventListener('click', () => openProject(row.dataset.id));
            });
            // Bind delete
            $projectsList.querySelectorAll('.btn-delete-project').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    promptDeleteProject(btn.dataset.id, btn.dataset.name);
                });
            });
        } catch (err) {
            $projectsList.innerHTML = '<p class="text-danger">Error al cargar proyectos.</p>';
        }
    }

    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escAttr(s) { return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

    // ── Create project ──────────────────────────
    $createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('projName').value.trim();
        if (!name) return;

        const body = {
            name,
            date: document.getElementById('projDate').value,
            object_name: document.getElementById('projObject').value,
            telescope: document.getElementById('projTelescope').value,
            observer: document.getElementById('projObserver').value,
            location: document.getElementById('projLocation').value,
            notes: document.getElementById('projNotes').value,
        };

        try {
            const project = await api('/projects', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            showToast(`Proyecto "${name}" creado`);
            $createForm.reset();
            openProject(project.id);
        } catch (err) {
            showToast('Error al crear el proyecto', 'error');
        }
    });

    // ── Delete project ──────────────────────────
    let pendingDeleteId = null;
    const deleteModal = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteProjectModal'));

    function promptDeleteProject(id, name) {
        pendingDeleteId = id;
        document.getElementById('deleteProjectName').textContent = name;
        deleteModal().show();
    }

    document.getElementById('btnConfirmDelete').addEventListener('click', async () => {
        if (!pendingDeleteId) return;
        await api(`/projects/${pendingDeleteId}`, { method: 'DELETE' });
        showToast('Proyecto eliminado');
        deleteModal().hide();
        pendingDeleteId = null;
        if (currentProject && currentProject.id === pendingDeleteId) {
            closeProject();
        }
        loadProjectsList();
    });

    // ── Open / close project ────────────────────
    async function openProject(id) {
        try {
            const project = await api(`/projects/${id}`);
            if (project.error) { showToast(project.error, 'error'); return; }
            currentProject = project;
            $splash.style.display = 'none';
            $workspace.style.display = 'flex';
            populateWorkspace();
            switchTab('tab-project');
        } catch (err) {
            showToast('Error al abrir el proyecto', 'error');
        }
    }

    function closeProject() {
        currentProject = null;
        guidedTutorial = null;
        activeTutorialSteps = GENERIC_STEPS;
        if (tutorialActive) endTutorial();
        $workspace.style.display = 'none';
        $splash.style.display = '';
        loadProjectsList();
        loadTutorialsList();
    }

    document.getElementById('btnCloseProject').addEventListener('click', closeProject);

    // ── Save project ────────────────────────────
    document.getElementById('btnSaveProject').addEventListener('click', async () => {
        if (!currentProject) return;
        const res = await api(`/projects/${currentProject.id}/save`, { method: 'POST' });
        if (res.saved) showToast('Proyecto guardado');
        else showToast('Error al guardar', 'error');
    });

    // ── Populate workspace with project data ────
    function populateWorkspace() {
        if (!currentProject) return;
        const p = currentProject;
        const m = p.metadata || {};

        // Sidebar
        document.getElementById('sideProjectName').textContent = p.name || '—';
        document.getElementById('sideProjectObject').textContent = m.object_name || '—';

        // Project tab fields
        document.getElementById('editProjName').value = p.name || '';
        document.getElementById('editProjDate').value = m.date || '';
        document.getElementById('editProjObject').value = m.object_name || '';
        document.getElementById('editProjTelescope').value = m.telescope || '';
        document.getElementById('editProjObserver').value = m.observer || '';
        document.getElementById('editProjLocation').value = m.location || '';
        document.getElementById('editProjNotes').value = m.notes || '';

        updateStats();
        updateImageTables();
        updateTabEnabledState();
        updateProjectSummaryTable();
        updateProcessingLog();
        updateCalibrationUI();
        updateAlignmentUI();
        updateStackingUI();
        updateProcessingUI();
        updateColorUI();
        updatePreviewUI();
        updateExportUI();
        updateLiveEditUI();
        updatePipelineProgress();
        updateUndoRedoButtons();
    }

    // ── Update project metadata ─────────────────
    document.getElementById('btnUpdateProject').addEventListener('click', async () => {
        if (!currentProject) return;
        const body = {
            name: document.getElementById('editProjName').value.trim() || currentProject.name,
            metadata: {
                date: document.getElementById('editProjDate').value,
                object_name: document.getElementById('editProjObject').value,
                telescope: document.getElementById('editProjTelescope').value,
                observer: document.getElementById('editProjObserver').value,
                location: document.getElementById('editProjLocation').value,
                notes: document.getElementById('editProjNotes').value,
            },
        };
        const updated = await api(`/projects/${currentProject.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        if (!updated.error) {
            currentProject = updated;
            populateWorkspace();
            showToast('Metadatos actualizados');
        }
    });

    // ── Stats ───────────────────────────────────
    function updateStats() {
        if (!currentProject) return;
        const imgs = currentProject.images || {};
        document.getElementById('statLights').textContent = (imgs.light || []).length;
        document.getElementById('statDarks').textContent = (imgs.dark || []).length;
        document.getElementById('statFlats').textContent = (imgs.flat || []).length;
        document.getElementById('statBias').textContent = (imgs.bias || []).length;
        document.getElementById('statUnclassified').textContent = (imgs.unclassified || []).length;
    }

    // ── Tab switching ───────────────────────────
    const tabButtons = document.querySelectorAll('.etab');
    const tabPanes = document.querySelectorAll('.editor-tab-pane');

    function switchTab(tabId) {
        tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
        tabPanes.forEach(pane => pane.classList.toggle('active', pane.id === tabId));
        updateSidebarHelp(tabId);
    }

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            switchTab(btn.dataset.tab);
        });
    });

    function updateTabEnabledState() {
        const hasLights = currentProject && (currentProject.images.light || []).length > 0;
        tabButtons.forEach(btn => {
            if (btn.dataset.needs === 'light') {
                btn.classList.toggle('disabled', !hasLights);
            }
        });
    }

    // ── Sidebar context help ────────────────────
    const HELP_TEXTS = {
        'tab-project': 'Revisa y edita los metadatos de tu proyecto. Aquí ves el resumen general de todas las imágenes cargadas.',
        'tab-images': 'Sube imágenes y clasifícalas por tipo (light, dark, flat, bias). El sistema intentará auto-detectar el tipo basándose en el nombre y en los metadatos del archivo.',
        'tab-calibration': 'Crea los master frames de calibración y aplícalos a tus lights para eliminar ruido térmico, viñeteo y artefactos del sensor.',
        'tab-alignment': 'Alinea todos los frames para que las estrellas coincidan. El sistema detecta estrellas automáticamente.',
        'tab-stacking': 'Combina los lights alineados en una sola imagen por canal, aumentando la señal y reduciendo el ruido.',
        'tab-processing': 'Ajusta el histograma, recorta, rota y aplica curvas para revelar los detalles de tu imagen.',
        'tab-color': 'Asigna colores a los canales y crea tu imagen final en color con la paleta que prefieras.',
        'tab-liveedit': 'Editor visual en tiempo real. Todos los ajustes (brillo, contraste, stretch, enfoque, ruido…) se procesan en tu navegador sin enviar nada al servidor.',
        'tab-preview': 'Vista rápida no destructiva de cualquier light. Útil para comprobar la calidad antes de procesar.',
        'tab-export': 'Descarga tu imagen procesada en FITS, TIFF, PNG o JPG.',
    };

    function updateSidebarHelp(tabId) {
        const helpEl = document.getElementById('sidebarHelp');
        helpEl.innerHTML = `<p class="text-secondary small">${HELP_TEXTS[tabId] || ''}</p>`;
    }

    // ── Frame type selector ─────────────────────
    document.querySelectorAll('.ftype-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ftype-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedFrameType = btn.dataset.type;
        });
    });

    // ── Upload dropzone ─────────────────────────
    const $dropzone = document.getElementById('uploadDropzone');
    const $fileInput = document.getElementById('fileInput');

    $dropzone.addEventListener('click', () => $fileInput.click());

    $dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        $dropzone.classList.add('dragover');
    });

    $dropzone.addEventListener('dragleave', () => {
        $dropzone.classList.remove('dragover');
    });

    $dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        $dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFileUpload(e.dataTransfer.files);
        }
    });

    $fileInput.addEventListener('change', () => {
        if ($fileInput.files.length) {
            handleFileUpload($fileInput.files);
        }
    });

    async function handleFileUpload(fileList) {
        if (!currentProject) return;
        const files = Array.from(fileList);
        const validExts = ['.fits', '.fit', '.fts', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.cr2', '.cr3'];

        const validFiles = files.filter(f => {
            const ext = '.' + f.name.split('.').pop().toLowerCase();
            return validExts.includes(ext);
        });

        if (!validFiles.length) {
            showToast('Ningún archivo con formato soportado', 'error');
            return;
        }

        const $progress = document.getElementById('uploadProgress');
        const $progressText = document.getElementById('uploadProgressText');
        const $progressBar = document.getElementById('uploadProgressBar');
        $progress.style.display = 'block';
        $progressBar.style.width = '0%';

        let uploaded = 0;
        const total = validFiles.length;
        const batchSize = 3; // Upload in small batches

        for (let i = 0; i < validFiles.length; i += batchSize) {
            const batch = validFiles.slice(i, i + batchSize);
            const formData = new FormData();
            formData.append('frame_type', selectedFrameType);
            batch.forEach(f => formData.append('files', f));

            try {
                const res = await fetch(`${API}/projects/${currentProject.id}/images`, {
                    method: 'POST',
                    body: formData,
                });
                const data = await res.json();

                // Merge uploaded images into current project state
                if (data.uploaded) {
                    data.uploaded.forEach(img => {
                        if (!currentProject.images[img.frame_type]) {
                            currentProject.images[img.frame_type] = [];
                        }
                        currentProject.images[img.frame_type].push(img);
                    });
                }
                if (data.errors && data.errors.length) {
                    data.errors.forEach(err => showToast(`Error: ${err.filename} — ${err.error}`, 'error'));
                }
            } catch (err) {
                showToast(`Error subiendo lote ${Math.floor(i / batchSize) + 1}`, 'error');
            }

            uploaded += batch.length;
            const pct = Math.round((uploaded / total) * 100);
            $progressBar.style.width = pct + '%';
            $progressText.textContent = `Subiendo ${uploaded}/${total}...`;
        }

        $progressText.textContent = `${total} archivos subidos`;
        setTimeout(() => { $progress.style.display = 'none'; }, 2000);

        // Refresh
        updateStats();
        updateImageTables();
        updateTabEnabledState();
        updateProjectSummaryTable();
        $fileInput.value = '';
        showToast(`${total} imagen(es) subida(s)`);
    }

    // ── Image tables ────────────────────────────
    function updateImageTables() {
        if (!currentProject) return;
        const types = ['light', 'dark', 'flat', 'bias', 'unclassified'];

        types.forEach(type => {
            const images = currentProject.images[type] || [];
            const tbody = document.getElementById(`table-${type}`);
            const empty = document.getElementById(`empty-${type}`);
            const badge = document.getElementById(`badge-${type}`);

            badge.textContent = images.length;

            if (!images.length) {
                tbody.innerHTML = '';
                empty.style.display = '';
                return;
            }
            empty.style.display = 'none';

            tbody.innerHTML = images.map(img => {
                const m = img.metadata || {};
                const um = img.user_metadata || {};
                const thumbUrl = img.thumbnail
                    ? `${API}/projects/${currentProject.id}/thumbnails/${img.thumbnail.replace('thumbnails/', '')}`
                    : null;

                const thumbHtml = thumbUrl
                    ? `<img src="${thumbUrl}" class="image-thumb" alt="thumb">`
                    : `<div class="image-thumb-placeholder"><i class="bi bi-image"></i></div>`;

                let cols = `
                    <td class="col-thumb">${thumbHtml}</td>
                    <td title="${escAttr(img.filename)}">${escHtml(img.filename)}</td>
                    <td>${fmtValue(m.format)}</td>
                    <td>${m.width && m.height ? `${m.width}×${m.height}` : '—'}</td>
                `;

                if (type !== 'bias') {
                    cols += `<td>${fmtValue(um.exposure ?? m.exposure)}${m.exposure ? 's' : ''}</td>`;
                }
                if (type === 'light' || type === 'flat') {
                    cols += `<td>${fmtValue(um.filter ?? m.filter)}</td>`;
                }
                if (type !== 'unclassified') {
                    cols += `<td>${fmtValue(um.gain ?? m.gain)}</td>`;
                }
                if (type === 'light' || type === 'bias') {
                    const bx = um.binning_x ?? m.binning_x;
                    const by = um.binning_y ?? m.binning_y;
                    cols += `<td>${bx && by ? `${bx}×${by}` : '—'}</td>`;
                }

                cols += `
                    <td class="col-actions">
                        <button class="btn btn-sm btn-outline-secondary btn-img-detail" data-id="${img.id}" data-type="${type}" title="Detalles">
                            <i class="bi bi-info-circle"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger btn-img-delete" data-id="${img.id}" title="Eliminar">
                            <i class="bi bi-trash3"></i>
                        </button>
                    </td>
                `;

                return `<tr data-image-id="${img.id}">${cols}</tr>`;
            }).join('');

            // Bind detail buttons
            tbody.querySelectorAll('.btn-img-detail').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showImageDetail(btn.dataset.id, btn.dataset.type);
                });
            });

            // Bind row click to detail
            tbody.querySelectorAll('tr').forEach(row => {
                row.addEventListener('click', () => {
                    const imgId = row.dataset.imageId;
                    showImageDetail(imgId, type);
                });
            });

            // Bind delete buttons
            tbody.querySelectorAll('.btn-img-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await deleteImage(btn.dataset.id);
                });
            });
        });
    }

    // ── Image detail modal ──────────────────────
    let detailModalInstance = null;
    let currentDetailImageId = null;

    function showImageDetail(imageId, frameType) {
        const images = currentProject.images[frameType] || [];
        const img = images.find(i => i.id === imageId);
        if (!img) return;

        currentDetailImageId = imageId;
        const m = img.metadata || {};
        const um = img.user_metadata || {};

        document.getElementById('imageDetailTitle').textContent = img.filename;

        // Thumbnail
        const thumbEl = document.getElementById('imageDetailThumb');
        if (img.thumbnail) {
            thumbEl.src = `${API}/projects/${currentProject.id}/thumbnails/${img.thumbnail.replace('thumbnails/', '')}`;
            thumbEl.style.display = '';
        } else {
            thumbEl.style.display = 'none';
        }

        // Metadata table
        const metaRows = [
            ['Tipo', frameType],
            ['Formato', m.format],
            ['Dimensiones', m.width && m.height ? `${m.width} × ${m.height} px` : null],
            ['Exposición', m.exposure ? `${m.exposure}s` : null],
            ['Ganancia', m.gain],
            ['Binning', m.binning_x && m.binning_y ? `${m.binning_x}×${m.binning_y}` : null],
            ['Filtro', m.filter],
            ['Temperatura', m.temperature ? `${m.temperature}°C` : null],
            ['Fecha obs.', m.date_obs],
            ['Objeto', m.object],
            ['Telescopio', m.telescope],
            ['Instrumento', m.instrument],
            ['Observador', m.observer],
            ['Bits/pixel', m.bitpix || m.bits_per_sample],
            ['Media', m.data_mean != null ? m.data_mean.toFixed(1) : null],
            ['Mediana', m.data_median != null ? m.data_median.toFixed(1) : null],
            ['Mínimo', m.data_min != null ? m.data_min.toFixed(1) : null],
            ['Máximo', m.data_max != null ? m.data_max.toFixed(1) : null],
        ].filter(([, v]) => v != null && v !== '' && v !== undefined);

        document.getElementById('imageDetailMeta').innerHTML = metaRows.map(([k, v]) =>
            `<tr><td>${k}</td><td>${escHtml(String(v))}</td></tr>`
        ).join('');

        // Reclassify select
        document.getElementById('imageDetailReclassify').value = frameType;

        if (!detailModalInstance) {
            detailModalInstance = new bootstrap.Modal(document.getElementById('imageDetailModal'));
        }
        detailModalInstance.show();
    }

    // Reclassify
    document.getElementById('btnReclassify').addEventListener('click', async () => {
        if (!currentDetailImageId || !currentProject) return;
        const newType = document.getElementById('imageDetailReclassify').value;
        const res = await api(`/projects/${currentProject.id}/images/${currentDetailImageId}/reclassify`, {
            method: 'PATCH',
            body: JSON.stringify({ new_type: newType }),
        });
        if (!res.error) {
            // Refresh project state
            currentProject = await api(`/projects/${currentProject.id}`);
            updateStats();
            updateImageTables();
            updateTabEnabledState();
            updateProjectSummaryTable();
            detailModalInstance.hide();
            showToast(`Imagen reclasificada como ${newType}`);
        } else {
            showToast(res.error, 'error');
        }
    });

    // Delete from modal
    document.getElementById('btnDeleteImage').addEventListener('click', async () => {
        if (!currentDetailImageId) return;
        await deleteImage(currentDetailImageId);
        detailModalInstance.hide();
    });

    async function deleteImage(imageId) {
        if (!currentProject) return;
        const res = await api(`/projects/${currentProject.id}/images/${imageId}`, { method: 'DELETE' });
        if (res.deleted) {
            // Remove from local state
            for (const type of Object.keys(currentProject.images)) {
                currentProject.images[type] = currentProject.images[type].filter(i => i.id !== imageId);
            }
            updateStats();
            updateImageTables();
            updateTabEnabledState();
            updateProjectSummaryTable();
            showToast('Imagen eliminada');
        }
    }

    // ── Project summary table ───────────────────
    function updateProjectSummaryTable() {
        if (!currentProject) return;
        const container = document.getElementById('projectSummaryTable');
        const imgs = currentProject.images || {};
        const types = ['light', 'dark', 'flat', 'bias', 'unclassified'];
        const labels = { light: 'Lights', dark: 'Darks', flat: 'Flats', bias: 'Bias', unclassified: 'Sin clasificar' };
        const icons = { light: 'bi-sun', dark: 'bi-moon', flat: 'bi-brightness-high', bias: 'bi-lightning', unclassified: 'bi-question-circle' };

        const totalImages = types.reduce((s, t) => s + (imgs[t] || []).length, 0);
        if (!totalImages) {
            container.innerHTML = '<p class="text-secondary">Carga imágenes en la pestaña <strong>Imágenes</strong> para ver el resumen aquí.</p>';
            return;
        }

        let html = '<table class="summary-table"><thead><tr><th>Tipo</th><th>Cantidad</th><th>Filtros</th><th>Exposiciones</th></tr></thead><tbody>';

        types.forEach(type => {
            const list = imgs[type] || [];
            if (!list.length) return;
            const filters = [...new Set(list.map(i => i.metadata?.filter || i.user_metadata?.filter).filter(Boolean))];
            const exposures = [...new Set(list.map(i => i.metadata?.exposure || i.user_metadata?.exposure).filter(Boolean))];

            html += `<tr>
                <td><i class="bi ${icons[type]} me-1"></i>${labels[type]}</td>
                <td>${list.length}</td>
                <td>${filters.length ? filters.join(', ') : '—'}</td>
                <td>${exposures.length ? exposures.map(e => e + 's').join(', ') : '—'}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ── Processing log (visual timeline) ────────
    function classifyLogEntry(desc) {
        const d = (desc || '').toLowerCase();
        if (d.includes('subida') || d.includes('cargad') || d.includes('upload') || d.includes('imagen')) return { cls: 'tl-upload', icon: 'bi-cloud-arrow-up' };
        if (d.includes('master') || d.includes('calibra') || d.includes('bias') || d.includes('dark') || d.includes('flat')) return { cls: 'tl-calib', icon: 'bi-sliders' };
        if (d.includes('alinea') || d.includes('align') || d.includes('estrella')) return { cls: 'tl-align', icon: 'bi-bullseye' };
        if (d.includes('apila') || d.includes('stack') || d.includes('combin')) return { cls: 'tl-stack', icon: 'bi-layers' };
        if (d.includes('stretch') || d.includes('recort') || d.includes('rot') || d.includes('flip') || d.includes('crop') || d.includes('histogr')) return { cls: 'tl-process', icon: 'bi-magic' };
        if (d.includes('color') || d.includes('rgb') || d.includes('paleta') || d.includes('composici') || d.includes('export')) return { cls: 'tl-export', icon: 'bi-palette' };
        return { cls: '', icon: 'bi-circle' };
    }

    function fmtTime(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    }

    function updateProcessingLog() {
        if (!currentProject) return;
        const log = currentProject.processing_log || [];
        const el = document.getElementById('processingLogContent');
        if (!log.length) {
            el.innerHTML = '<p class="text-secondary small mb-0">Aún no se han realizado operaciones de procesado.</p>';
            return;
        }
        el.innerHTML = log.map(entry => {
            const c = classifyLogEntry(entry.description);
            return `<div class="tl-item">
                <div class="tl-dot ${c.cls}"><i class="bi ${c.icon}"></i></div>
                <div class="tl-content"><strong>${escHtml(entry.description)}</strong><span class="tl-time">${fmtTime(entry.timestamp)}</span></div>
            </div>`;
        }).join('');
        el.scrollTop = el.scrollHeight;
    }

    // ── Init ────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        loadProjectsList();
        initCalibration();
        initAlignment();
        initStacking();
        initProcessing();
        initColor();
        initPreview();
        initExport();
        initUndoRedo();
        initTutorial();
        initComparator();
        initLiveEdit();
    });

    // ═══════════════════════════════════════════════
    //  CALIBRATION
    // ═══════════════════════════════════════════════

    function initCalibration() {
        // Master Bias
        document.getElementById('btnCreateMasterBias').addEventListener('click', async () => {
            await createMaster('bias');
        });
        // Master Dark
        document.getElementById('btnCreateMasterDark').addEventListener('click', async () => {
            await createMaster('dark');
        });
        // Master Flat
        document.getElementById('btnCreateMasterFlat').addEventListener('click', async () => {
            await createMaster('flat');
        });
        // Calibrate Lights
        document.getElementById('btnCalibrateLights').addEventListener('click', async () => {
            await runCalibrateLights();
        });
    }

    async function createMaster(type) {
        if (!currentProject) return;
        const methodEl = document.getElementById(`cal${cap(type)}Method`);
        const sigmaEl = document.getElementById(`cal${cap(type)}Sigma`);
        const spinnerEl = document.getElementById(`cal${cap(type)}Spinner`);
        const resultEl = document.getElementById(`cal${cap(type)}Result`);

        const method = methodEl.value;
        const sigma = parseFloat(sigmaEl.value) || 3.0;
        const subtractBias = type !== 'bias' ? document.getElementById(`cal${cap(type)}SubBias`)?.checked ?? true : false;

        spinnerEl.style.display = 'flex';
        resultEl.style.display = 'none';

        try {
            const endpoint = `/projects/${currentProject.id}/calibration/master-${type}`;
            const body = { method, sigma, subtract_bias: subtractBias };
            const result = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });

            if (result.error) {
                showToast(result.error, 'error');
                spinnerEl.style.display = 'none';
                return;
            }

            // Show result
            const thumbUrl = result.thumbnail
                ? `${API}/projects/${currentProject.id}/thumbnails/${result.thumbnail.replace('thumbnails/', '')}`
                : null;
            const thumbHtml = thumbUrl ? `<img src="${thumbUrl}" class="cal-result-thumb me-3">` : '';

            resultEl.innerHTML = `
                <div class="d-flex align-items-start">
                    ${thumbHtml}
                    <div>
                        <div class="cal-result-header"><i class="bi bi-check-circle-fill"></i> Master ${cap(type)} creado</div>
                        <div class="cal-result-stats">
                            <div class="cal-stat"><span class="cal-stat-label">Método</span><span class="cal-stat-value">${method}</span></div>
                            <div class="cal-stat"><span class="cal-stat-label">Frames</span><span class="cal-stat-value">${result.n_combined}</span></div>
                            <div class="cal-stat"><span class="cal-stat-label">Media</span><span class="cal-stat-value">${result.stats?.mean?.toFixed(1) ?? '—'}</span></div>
                            <div class="cal-stat"><span class="cal-stat-label">Mediana</span><span class="cal-stat-value">${result.stats?.median?.toFixed(1) ?? '—'}</span></div>
                            <div class="cal-stat"><span class="cal-stat-label">σ</span><span class="cal-stat-value">${result.stats?.std?.toFixed(1) ?? '—'}</span></div>
                        </div>
                    </div>
                </div>
            `;
            resultEl.style.display = '';

            // Refresh project state
            currentProject = await api(`/projects/${currentProject.id}`);
            updateCalibrationStatus();
            updateProcessingLog();
            showToast(`Master ${type} creado correctamente`);
        } catch (err) {
            showToast(`Error al crear master ${type}`, 'error');
        } finally {
            spinnerEl.style.display = 'none';
        }
    }

    function cap(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    async function runCalibrateLights() {
        if (!currentProject) return;

        const spinnerEl = document.getElementById('calLightsSpinner');
        const resultEl = document.getElementById('calLightsResult');

        const useDark = document.getElementById('calUseDark').checked;
        const useFlat = document.getElementById('calUseFlat').checked;
        const hotPixel = document.getElementById('calHotPixel').checked;
        const hotSigma = parseFloat(document.getElementById('calHotPixelSigma').value) || 5.0;

        spinnerEl.style.display = 'flex';
        resultEl.style.display = 'none';

        try {
            const result = await api(`/projects/${currentProject.id}/calibration/calibrate-lights`, {
                method: 'POST',
                body: JSON.stringify({
                    use_dark: useDark,
                    use_flat: useFlat,
                    hot_pixel_correction: hotPixel,
                    hot_pixel_sigma: hotSigma,
                }),
            });

            if (result.error) {
                showToast(result.error, 'error');
                spinnerEl.style.display = 'none';
                return;
            }

            resultEl.innerHTML = `
                <div class="cal-result-header"><i class="bi bi-check-circle-fill"></i> ${result.calibrated} lights calibrados</div>
                <div class="small text-secondary">
                    Dark: ${useDark ? 'sí' : 'no'} · Flat: ${useFlat ? 'sí' : 'no'} · Hot pixels: ${hotPixel ? `sí (σ=${hotSigma})` : 'no'}
                </div>
            `;
            resultEl.style.display = '';

            // Refresh project
            currentProject = await api(`/projects/${currentProject.id}`);
            updateCalibrationStatus();
            updateCalibrationLightsTable();
            updateProcessingLog();
            showToast(`${result.calibrated} lights calibrados`);
        } catch (err) {
            showToast('Error al calibrar lights', 'error');
        } finally {
            spinnerEl.style.display = 'none';
        }
    }

    function updateCalibrationUI() {
        if (!currentProject) return;
        updateCalibrationCounts();
        updateCalibrationStatus();
        updateCalibrationLightsTable();
    }

    function updateCalibrationCounts() {
        if (!currentProject) return;
        const imgs = currentProject.images || {};

        const biasCount = (imgs.bias || []).length;
        const darkCount = (imgs.dark || []).length;
        const flatCount = (imgs.flat || []).length;

        document.getElementById('calBiasCount').textContent = `${biasCount} frame${biasCount !== 1 ? 's' : ''}`;
        document.getElementById('calDarkCount').textContent = `${darkCount} frame${darkCount !== 1 ? 's' : ''}`;
        document.getElementById('calFlatCount').textContent = `${flatCount} frame${flatCount !== 1 ? 's' : ''}`;

        document.getElementById('btnCreateMasterBias').disabled = biasCount < 1;
        document.getElementById('btnCreateMasterDark').disabled = darkCount < 1;
        document.getElementById('btnCreateMasterFlat').disabled = flatCount < 1;
    }

    function updateCalibrationStatus() {
        if (!currentProject) return;
        const masters = currentProject.masters || {};
        const calLights = currentProject.calibrated_lights || [];

        const items = [
            { el: 'calStatusBias', detail: 'calStatusBiasDetail', key: 'master_bias', label: 'bias' },
            { el: 'calStatusDark', detail: 'calStatusDarkDetail', key: 'master_dark', label: 'dark' },
            { el: 'calStatusFlat', detail: 'calStatusFlatDetail', key: 'master_flat', label: 'flat' },
        ];

        items.forEach(({ el, detail, key }) => {
            const itemEl = document.getElementById(el);
            const detailEl = document.getElementById(detail);
            const master = masters[key];

            if (master) {
                itemEl.classList.add('done');
                itemEl.querySelector('.cal-status-icon').className = 'cal-status-icon done';
                detailEl.textContent = `${master.method} · ${master.n_combined} frames`;
            } else {
                itemEl.classList.remove('done');
                itemEl.querySelector('.cal-status-icon').className = 'cal-status-icon pending';
                detailEl.textContent = 'Sin crear';
            }
        });

        // Lights status
        const lightsItem = document.getElementById('calStatusLights');
        const lightsDetail = document.getElementById('calStatusLightsDetail');
        if (calLights.length > 0) {
            lightsItem.classList.add('done');
            lightsItem.querySelector('.cal-status-icon').className = 'cal-status-icon done';
            lightsDetail.textContent = `${calLights.length} calibrados`;
        } else {
            lightsItem.classList.remove('done');
            lightsItem.querySelector('.cal-status-icon').className = 'cal-status-icon pending';
            lightsDetail.textContent = 'Sin calibrar';
        }
    }

    function updateCalibrationLightsTable() {
        if (!currentProject) return;
        const calLights = currentProject.calibrated_lights || [];
        const card = document.getElementById('calLightsTableCard');
        const tbody = document.getElementById('calLightsTable');
        const badge = document.getElementById('calLightsBadge');

        if (!calLights.length) {
            card.style.display = 'none';
            return;
        }
        card.style.display = '';
        badge.textContent = calLights.length;

        tbody.innerHTML = calLights.map(img => {
            const m = img.metadata || {};
            const thumbUrl = img.thumbnail
                ? `${API}/projects/${currentProject.id}/thumbnails/${img.thumbnail.replace('thumbnails/', '')}`
                : null;
            const thumbHtml = thumbUrl
                ? `<img src="${thumbUrl}" class="image-thumb" alt="thumb">`
                : `<div class="image-thumb-placeholder"><i class="bi bi-image"></i></div>`;

            return `<tr>
                <td class="col-thumb">${thumbHtml}</td>
                <td>${escHtml(img.filename)}</td>
                <td>${fmtValue(m.filter)}</td>
                <td>${m.exposure ? m.exposure + 's' : '—'}</td>
                <td>${img.dark_applied ? '<i class="bi bi-check-lg text-success"></i>' : '<i class="bi bi-x-lg text-muted"></i>'}</td>
                <td>${img.flat_applied ? '<i class="bi bi-check-lg text-success"></i>' : '<i class="bi bi-x-lg text-muted"></i>'}</td>
                <td>${img.hot_pixel_corrected ? '<i class="bi bi-check-lg text-success"></i>' : '<i class="bi bi-x-lg text-muted"></i>'}</td>
                <td>${m.data_mean != null ? m.data_mean.toFixed(0) : '—'}</td>
            </tr>`;
        }).join('');
    }

    // ═══════════════════════════════════════════════
    //  ALIGNMENT
    // ═══════════════════════════════════════════════

    function initAlignment() {
        document.getElementById('btnAlignFrames').addEventListener('click', async () => {
            await runAlignment();
        });
    }

    async function runAlignment() {
        if (!currentProject) return;

        const spinner = document.getElementById('alignSpinner');
        const method = document.getElementById('alignMethod').value;
        const sigma = parseFloat(document.getElementById('alignSigma').value) || 5.0;
        const discardRms = parseFloat(document.getElementById('alignDiscardRms').value) || 0;
        const useCalibrated = document.getElementById('alignUseCalibrated').checked;

        spinner.style.display = 'flex';
        document.getElementById('alignResultsCard').style.display = 'none';
        document.getElementById('alignTableCard').style.display = 'none';
        document.getElementById('alignDiscardedCard').style.display = 'none';

        try {
            const result = await api(`/projects/${currentProject.id}/alignment/align`, {
                method: 'POST',
                body: JSON.stringify({
                    method,
                    use_calibrated: useCalibrated,
                    threshold_sigma: sigma,
                    discard_rms_threshold: discardRms,
                }),
            });

            if (result.error) {
                showToast(result.error, 'error');
                spinner.style.display = 'none';
                return;
            }

            // Refresh project
            currentProject = await api(`/projects/${currentProject.id}`);

            // Show results
            showAlignmentResults(result);
            updateProcessingLog();
            showToast(`${result.aligned} frames alineados`);
        } catch (err) {
            showToast('Error al alinear frames', 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    function showAlignmentResults(result) {
        // Stats
        const methodLabels = { translation: 'Traslación', similarity: 'Similitud', affine: 'Afín' };
        document.getElementById('alignStatAligned').textContent = result.aligned;
        document.getElementById('alignStatDiscarded').textContent = result.discarded;
        document.getElementById('alignStatMethod').textContent = methodLabels[result.method] || result.method;

        // Find reference name
        const refImg = (result.images || []).find(i => i.is_reference);
        document.getElementById('alignStatRef').textContent = refImg ? refImg.filename.replace(/^aligned_[a-f0-9]+_/, '') : '—';

        document.getElementById('alignResultsCard').style.display = '';

        // Aligned table
        const tbody = document.getElementById('alignTable');
        const badge = document.getElementById('alignBadge');
        const images = result.images || [];

        badge.textContent = images.length;

        if (images.length) {
            document.getElementById('alignTableCard').style.display = '';
            tbody.innerHTML = images.map(img => {
                const m = img.metadata || {};
                const thumbUrl = img.thumbnail
                    ? `${API}/projects/${currentProject.id}/thumbnails/${img.thumbnail.replace('thumbnails/', '')}`
                    : null;
                const thumbHtml = thumbUrl
                    ? `<img src="${thumbUrl}" class="image-thumb" alt="thumb">`
                    : `<div class="image-thumb-placeholder"><i class="bi bi-image"></i></div>`;

                const refBadge = img.is_reference
                    ? '<span class="ref-badge is-ref">REF</span>'
                    : '<span class="ref-badge not-ref">—</span>';

                const rmsClass = img.rms < 1 ? 'rms-good' : img.rms < 3 ? 'rms-ok' : 'rms-bad';
                const origName = img.filename.replace(/^aligned_[a-f0-9]+_/, '');

                return `<tr>
                    <td class="col-thumb">${thumbHtml}</td>
                    <td title="${escAttr(origName)}">${escHtml(origName)}</td>
                    <td>${refBadge}</td>
                    <td>${img.n_stars ?? '—'}</td>
                    <td>${img.n_matches ?? (img.is_reference ? '—' : '—')}</td>
                    <td class="${rmsClass}">${img.rms != null ? img.rms.toFixed(2) : '—'}</td>
                    <td>${img.fwhm != null ? img.fwhm.toFixed(1) : '—'}</td>
                    <td>${img.quality_score != null ? img.quality_score.toFixed(0) : '—'}</td>
                    <td>${fmtValue(m.filter)}</td>
                </tr>`;
            }).join('');
        }

        // Discarded table
        const discarded = result.discarded_details || [];
        const discBadge = document.getElementById('alignDiscardedBadge');
        discBadge.textContent = discarded.length;

        if (discarded.length) {
            document.getElementById('alignDiscardedCard').style.display = '';
            document.getElementById('alignDiscardedTable').innerHTML = discarded.map(d =>
                `<tr><td>${escHtml(d.filename)}</td><td class="text-warning">${escHtml(d.reason)}</td></tr>`
            ).join('');
        }
    }

    function updateAlignmentUI() {
        if (!currentProject) return;
        const aligned = currentProject.aligned_lights || [];
        const discarded = currentProject.alignment_discarded || [];

        if (aligned.length > 0) {
            showAlignmentResults({
                aligned: aligned.length,
                discarded: discarded.length,
                method: currentProject.alignment_params?.method || 'similarity',
                images: aligned,
                discarded_details: discarded,
            });
        }
    }

    // ═══════════════════════════════════════════════
    //  STACKING
    // ═══════════════════════════════════════════════

    function initStacking() {
        document.getElementById('btnStackFrames').addEventListener('click', runStacking);
    }

    async function runStacking() {
        if (!currentProject) return;

        const spinner = document.getElementById('stackSpinner');
        spinner.style.display = 'flex';
        document.getElementById('stackResultsCard').style.display = 'none';

        try {
            const result = await api(`/projects/${currentProject.id}/stacking/stack`, {
                method: 'POST',
                body: JSON.stringify({
                    method: document.getElementById('stackMethod').value,
                    sigma: parseFloat(document.getElementById('stackSigma').value) || 3.0,
                    use_aligned: document.getElementById('stackUseAligned').checked,
                    normalize: document.getElementById('stackNormalize').checked,
                    reject_percent: parseFloat(document.getElementById('stackReject').value) || 0,
                    weight_by_quality: document.getElementById('stackWeighted').checked,
                }),
            });

            if (result.error) {
                showToast(result.error, 'error');
                return;
            }

            currentProject = await api(`/projects/${currentProject.id}`);
            showStackResult(result);
            updateStackHistory();
            updateProcessingLog();
            updateProcessingSourceSelect();
            showToast(`Apilado completado: ${result.used_frames} frames`);
        } catch (err) {
            showToast('Error al apilar frames', 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    function showStackResult(result) {
        const s = result.stats || {};
        const methodNames = { mean: 'Media', median: 'Mediana', sigma_clip: 'Sigma-clip', winsorized: 'Winsorizado', max: 'Máximo', min: 'Mínimo' };

        document.getElementById('stackResFrames').textContent = s.n_frames || result.used_frames || '—';
        document.getElementById('stackResMethod').textContent = methodNames[s.method] || s.method || '—';
        document.getElementById('stackResMean').textContent = s.result_mean != null ? s.result_mean.toFixed(1) : '—';
        document.getElementById('stackResSNR').textContent = s.snr_estimate != null ? s.snr_estimate.toFixed(1) : '—';
        document.getElementById('stackResSize').textContent = s.width && s.height ? `${s.width}×${s.height}` : '—';
        document.getElementById('stackResMedian').textContent = s.result_median != null ? s.result_median.toFixed(1) : '—';
        document.getElementById('stackResStd').textContent = s.result_std != null ? s.result_std.toFixed(1) : '—';
        document.getElementById('stackResMin').textContent = s.result_min != null ? s.result_min.toFixed(1) : '—';
        document.getElementById('stackResMax').textContent = s.result_max != null ? s.result_max.toFixed(1) : '—';

        // Thumbnail
        const thumbBox = document.getElementById('stackThumbBox');
        if (result.thumbnail) {
            const thumbFile = result.thumbnail.replace('thumbnails/', '');
            document.getElementById('stackThumbImg').src = `${API}/projects/${currentProject.id}/thumbnails/${thumbFile}`;
            thumbBox.style.display = '';
        } else {
            thumbBox.style.display = 'none';
        }

        document.getElementById('stackResultsCard').style.display = '';
    }

    function updateStackHistory() {
        if (!currentProject) return;
        const stacks = currentProject.stacked_results || [];
        const card = document.getElementById('stackHistoryCard');
        const badge = document.getElementById('stackHistoryBadge');
        const tbody = document.getElementById('stackHistoryTable');

        badge.textContent = stacks.length;
        if (!stacks.length) { card.style.display = 'none'; return; }

        card.style.display = '';
        const methodNames = { mean: 'Media', median: 'Mediana', sigma_clip: 'Sigma-clip', winsorized: 'Winsorizado', max: 'Máximo', min: 'Mínimo' };

        tbody.innerHTML = stacks.map(st => {
            const s = st.stats || {};
            const thumbUrl = st.thumbnail
                ? `${API}/projects/${currentProject.id}/thumbnails/${st.thumbnail.replace('thumbnails/', '')}`
                : null;
            const thumbHtml = thumbUrl
                ? `<img src="${thumbUrl}" class="image-thumb" alt="thumb">`
                : `<div class="image-thumb-placeholder"><i class="bi bi-image"></i></div>`;

            return `<tr>
                <td class="col-thumb">${thumbHtml}</td>
                <td>${escHtml(st.filename)}</td>
                <td><span class="op-label op-label-stack">${methodNames[s.method] || s.method || '—'}</span></td>
                <td>${s.n_frames || '—'}</td>
                <td>${s.snr_estimate != null ? s.snr_estimate.toFixed(1) : '—'}</td>
                <td>${s.width && s.height ? s.width + '×' + s.height : '—'}</td>
                <td>${fmtDate(st.created)}</td>
                <td><button class="proc-delete-btn" title="Eliminar" onclick="window._deleteStack('${st.id}')"><i class="bi bi-trash"></i></button></td>
            </tr>`;
        }).join('');
    }

    window._deleteStack = async function(stackId) {
        if (!currentProject) return;
        const r = await api(`/projects/${currentProject.id}/stacking/${stackId}`, { method: 'DELETE' });
        if (r.deleted) {
            currentProject = await api(`/projects/${currentProject.id}`);
            updateStackHistory();
            updateProcessingSourceSelect();
            showToast('Apilado eliminado');
        }
    };

    function updateStackingUI() {
        if (!currentProject) return;

        // Update source counts
        document.getElementById('stackStatAligned').textContent = (currentProject.aligned_lights || []).length;
        document.getElementById('stackStatCalibrated').textContent = (currentProject.calibrated_lights || []).length;
        document.getElementById('stackStatLights').textContent = ((currentProject.images || {}).light || []).length;

        // Show latest result if exists
        const stacks = currentProject.stacked_results || [];
        if (stacks.length > 0) {
            const latest = stacks[stacks.length - 1];
            showStackResult({ stats: latest.stats, thumbnail: latest.thumbnail, used_frames: (latest.stats || {}).n_frames });
        }
        updateStackHistory();
    }

    // ═══════════════════════════════════════════════
    //  PROCESSING (crop, rotate, flip, stretch)
    // ═══════════════════════════════════════════════

    let currentHistogram = null;

    function initProcessing() {
        // Source select
        document.getElementById('btnProcLoadHisto').addEventListener('click', loadHistogram);

        // Geometry
        document.getElementById('btnAutoCrop').addEventListener('click', runAutoCrop);
        document.getElementById('btnManualCrop').addEventListener('click', runManualCrop);
        document.getElementById('btnRotate').addEventListener('click', runRotate);
        document.getElementById('btnFlipH').addEventListener('click', () => runFlip('horizontal'));
        document.getElementById('btnFlipV').addEventListener('click', () => runFlip('vertical'));

        // Stretch
        document.getElementById('btnStretchPreview').addEventListener('click', runStretchPreview);
        document.getElementById('btnStretchApply').addEventListener('click', runStretchApply);

        // Dynamic params visibility based on method
        document.getElementById('stretchMethod').addEventListener('change', updateStretchParams);

        // Range display
        document.getElementById('stretchBeta').addEventListener('input', e => {
            document.getElementById('stretchBetaVal').textContent = e.target.value;
        });
        document.getElementById('stretchMidtone').addEventListener('input', e => {
            document.getElementById('stretchMidtoneVal').textContent = e.target.value;
        });
        document.getElementById('stretchScale').addEventListener('input', e => {
            document.getElementById('stretchScaleVal').textContent = e.target.value;
        });
    }

    function updateStretchParams() {
        const method = document.getElementById('stretchMethod').value;
        document.getElementById('stretchBetaGroup').style.display = method === 'asinh' ? '' : 'none';
        document.getElementById('stretchMidtoneGroup').style.display = method === 'midtone' ? '' : 'none';
        document.getElementById('stretchScaleGroup').style.display = method === 'log' ? '' : 'none';
    }

    function _getSelectedSource() {
        const sel = document.getElementById('procSourceSelect');
        const val = sel.value;
        if (!val) return null;
        // Format: "type:id"
        const [sourceType, sourceId] = val.split(':');
        return { source_type: sourceType, source_id: sourceId };
    }

    function _buildStretchParams() {
        const method = document.getElementById('stretchMethod').value;
        const params = {
            black_point: parseFloat(document.getElementById('stretchBP').value) || 0.2,
            white_point: parseFloat(document.getElementById('stretchWP').value) || 99.9,
        };
        if (method === 'asinh') params.beta = parseFloat(document.getElementById('stretchBeta').value) || 10;
        if (method === 'midtone') params.midtone = parseFloat(document.getElementById('stretchMidtone').value) || 0.25;
        if (method === 'log') params.scale = parseFloat(document.getElementById('stretchScale').value) || 1000;
        return params;
    }

    function updateProcessingSourceSelect() {
        if (!currentProject) return;
        const sel = document.getElementById('procSourceSelect');
        const prevVal = sel.value;

        let html = '<option value="" disabled>— Selecciona una imagen —</option>';

        // Stacked results
        const stacks = currentProject.stacked_results || [];
        if (stacks.length) {
            html += '<optgroup label="Apilados">';
            stacks.forEach(s => {
                html += `<option value="stacked:${s.id}">${s.filename}</option>`;
            });
            html += '</optgroup>';
        }

        // Processed results
        const procs = currentProject.processed_results || [];
        if (procs.length) {
            html += '<optgroup label="Procesados">';
            procs.forEach(p => {
                const opLabels = { crop: 'Recorte', auto_crop: 'Auto-recorte', rotate: 'Rotación', flip: 'Volteo',
                    stretch_asinh: 'Asinh', stretch_midtone: 'MTF', stretch_log: 'Log', stretch_sqrt: 'Sqrt',
                    stretch_histogram: 'Hist.Eq.', stretch_linear: 'Lineal', stretch_curves: 'Curvas' };
                const opLabel = opLabels[p.operation] || p.operation;
                html += `<option value="processed:${p.id}">[${opLabel}] ${p.filename}</option>`;
            });
            html += '</optgroup>';
        }

        // Aligned lights
        const aligned = currentProject.aligned_lights || [];
        if (aligned.length) {
            html += '<optgroup label="Alineados">';
            aligned.forEach(a => {
                const name = a.filename.replace(/^aligned_[a-f0-9]+_/, '');
                html += `<option value="aligned:${a.id}">${name}</option>`;
            });
            html += '</optgroup>';
        }

        sel.innerHTML = html;
        // Restore selection if still valid
        if (prevVal && sel.querySelector(`option[value="${prevVal}"]`)) {
            sel.value = prevVal;
        }
    }

    async function loadHistogram() {
        const src = _getSelectedSource();
        if (!src) { showToast('Selecciona una imagen primero', 'error'); return; }

        try {
            const data = await api(`/projects/${currentProject.id}/processing/histogram`, {
                method: 'POST',
                body: JSON.stringify(src),
            });
            if (data.error) { showToast(data.error, 'error'); return; }

            currentHistogram = data;
            drawHistogram(data);
            document.getElementById('procHistoCard').style.display = '';
            document.getElementById('histoMin').textContent = data.data_min.toFixed(1);
            document.getElementById('histoMax').textContent = data.data_max.toFixed(1);
            document.getElementById('histoMean').textContent = data.data_mean.toFixed(1);
            document.getElementById('histoMedian').textContent = data.data_median.toFixed(1);
            document.getElementById('histoStd').textContent = data.data_std.toFixed(1);

            // Show image info
            const info = document.getElementById('procImageInfo');
            info.innerHTML = `Dimensiones: ${data.width}×${data.height} | Rango: [${data.data_min.toFixed(1)}, ${data.data_max.toFixed(1)}]`;
            info.style.display = '';
        } catch (err) {
            showToast('Error al cargar histograma', 'error');
        }
    }

    function drawHistogram(data) {
        const canvas = document.getElementById('procHistoCanvas');
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        const counts = data.counts;
        // Use log scale for better visibility
        const logCounts = counts.map(c => c > 0 ? Math.log10(c) : 0);
        const maxLog = Math.max(...logCounts, 1);

        const barW = W / counts.length;

        // Draw bars
        ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
        for (let i = 0; i < counts.length; i++) {
            const barH = (logCounts[i] / maxLog) * (H - 10);
            ctx.fillRect(i * barW, H - barH, barW, barH);
        }

        // Draw border line
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < counts.length; i++) {
            const barH = (logCounts[i] / maxLog) * (H - 10);
            const x = i * barW + barW / 2;
            const y = H - barH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    async function _runProcOp(endpoint, body, spinnerText) {
        const src = _getSelectedSource();
        if (!src) { showToast('Selecciona una imagen primero', 'error'); return; }

        const spinner = document.getElementById('procSpinner');
        document.getElementById('procSpinnerText').textContent = spinnerText;
        spinner.style.display = 'flex';

        try {
            const result = await api(`/projects/${currentProject.id}/processing/${endpoint}`, {
                method: 'POST',
                body: JSON.stringify({ ...src, ...body }),
            });

            if (result.error) { showToast(result.error, 'error'); return; }

            currentProject = await api(`/projects/${currentProject.id}`);
            updateProcHistory();
            updateProcessingSourceSelect();
            updateProcessingLog();
            showToast(`${spinnerText.replace('...', '')}: completado`);
            return result;
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    async function runAutoCrop() {
        const thresh = parseFloat(document.getElementById('procAutoCropThresh').value) || 1.0;
        await _runProcOp('auto-crop', { threshold_percent: thresh }, 'Auto-recortando...');
    }

    async function runManualCrop() {
        const x = parseInt(document.getElementById('procCropX').value) || 0;
        const y = parseInt(document.getElementById('procCropY').value) || 0;
        const w = parseInt(document.getElementById('procCropW').value);
        const h = parseInt(document.getElementById('procCropH').value);
        if (!w || !h) { showToast('Especifica ancho y alto del recorte', 'error'); return; }
        await _runProcOp('crop', { x, y, width: w, height: h }, 'Recortando...');
    }

    async function runRotate() {
        const angle = parseFloat(document.getElementById('procRotateAngle').value) || 0;
        if (angle === 0) { showToast('Especifica un ángulo distinto de 0', 'error'); return; }
        await _runProcOp('rotate', { angle, auto_crop: true }, 'Rotando...');
    }

    async function runFlip(axis) {
        await _runProcOp('flip', { axis }, 'Volteando...');
    }

    async function runStretchPreview() {
        const src = _getSelectedSource();
        if (!src) { showToast('Selecciona una imagen primero', 'error'); return; }

        const method = document.getElementById('stretchMethod').value;
        const params = _buildStretchParams();

        try {
            const res = await fetch(`${API}/projects/${currentProject.id}/processing/stretch-preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...src, method, params, max_size: 800 }),
            });

            if (!res.ok) { showToast('Error al generar previsualización', 'error'); return; }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const img = document.getElementById('stretchPreviewImg');
            img.src = url;
            document.getElementById('stretchPreviewBox').style.display = '';
        } catch (err) {
            showToast('Error de previsualización', 'error');
        }
    }

    async function runStretchApply() {
        const method = document.getElementById('stretchMethod').value;
        const params = _buildStretchParams();
        await _runProcOp('stretch', { method, params }, 'Aplicando stretch...');
    }

    function updateProcHistory() {
        if (!currentProject) return;
        const procs = currentProject.processed_results || [];
        const card = document.getElementById('procHistoryCard');
        const badge = document.getElementById('procHistoryBadge');
        const tbody = document.getElementById('procHistoryTable');

        badge.textContent = procs.length;
        if (!procs.length) { card.style.display = 'none'; return; }

        card.style.display = '';
        const opLabels = { crop: 'Recorte', auto_crop: 'Auto-recorte', rotate: 'Rotación', flip: 'Volteo',
            stretch_asinh: 'Asinh', stretch_midtone: 'MTF', stretch_log: 'Log', stretch_sqrt: '√',
            stretch_histogram: 'Hist.Eq.', stretch_linear: 'Lineal', stretch_curves: 'Curvas' };
        const opClasses = { crop: 'crop', auto_crop: 'auto_crop', rotate: 'rotate', flip: 'flip' };

        tbody.innerHTML = procs.map(p => {
            const s = p.stats || {};
            const opLabel = opLabels[p.operation] || p.operation;
            const opClass = opClasses[p.operation] || (p.operation.startsWith('stretch') ? 'stretch' : 'stack');
            const thumbUrl = p.thumbnail
                ? `${API}/projects/${currentProject.id}/thumbnails/${p.thumbnail.replace('thumbnails/', '')}`
                : null;
            const thumbHtml = thumbUrl
                ? `<img src="${thumbUrl}" class="image-thumb" alt="thumb">`
                : `<div class="image-thumb-placeholder"><i class="bi bi-image"></i></div>`;

            return `<tr>
                <td class="col-thumb">${thumbHtml}</td>
                <td title="${escAttr(p.filename)}">${escHtml(p.filename)}</td>
                <td><span class="op-label op-label-${opClass}">${opLabel}</span></td>
                <td>${s.width && s.height ? s.width + '×' + s.height : '—'}</td>
                <td>${s.mean != null ? s.mean.toFixed(1) : '—'}</td>
                <td>${fmtDate(p.created)}</td>
                <td><button class="proc-delete-btn" title="Eliminar" onclick="window._deleteProc('${p.id}')"><i class="bi bi-trash"></i></button></td>
            </tr>`;
        }).join('');
    }

    window._deleteProc = async function(procId) {
        if (!currentProject) return;
        const r = await api(`/projects/${currentProject.id}/processing/${procId}`, { method: 'DELETE' });
        if (r.deleted) {
            currentProject = await api(`/projects/${currentProject.id}`);
            updateProcHistory();
            updateProcessingSourceSelect();
            showToast('Resultado eliminado');
        }
    };

    function updateProcessingUI() {
        if (!currentProject) return;
        updateProcessingSourceSelect();
        updateProcHistory();
    }

    // ═══════════════════════════════════════════════
    //  COLOR COMPOSITION
    // ═══════════════════════════════════════════════

    function initColor() {
        document.getElementById('btnComposeColor').addEventListener('click', runComposeColor);
        document.getElementById('colorLumWeight').addEventListener('input', e => {
            document.getElementById('colorLumWeightVal').textContent = parseFloat(e.target.value).toFixed(2);
        });
        document.getElementById('colorSaturation').addEventListener('input', e => {
            document.getElementById('colorSatVal').textContent = parseFloat(e.target.value).toFixed(2);
        });
        document.getElementById('btnColorPreviewFull').addEventListener('click', showColorFullscreen);
    }

    function _buildImageOptions(includeNone = false) {
        if (!currentProject) return '';
        let html = includeNone ? '<option value="">— Ninguno —</option>' : '<option value="" disabled selected>— Selecciona —</option>';

        const stacks = currentProject.stacked_results || [];
        if (stacks.length) {
            html += '<optgroup label="Apilados">';
            stacks.forEach(s => { html += `<option value="stacked:${s.id}">${s.filename}</option>`; });
            html += '</optgroup>';
        }
        const procs = currentProject.processed_results || [];
        if (procs.length) {
            html += '<optgroup label="Procesados">';
            procs.forEach(p => { html += `<option value="processed:${p.id}">${p.filename}</option>`; });
            html += '</optgroup>';
        }
        const colors = currentProject.color_composites || [];
        if (colors.length) {
            html += '<optgroup label="Color">';
            colors.forEach(c => { html += `<option value="color_composite:${c.id}">${c.filename}</option>`; });
            html += '</optgroup>';
        }
        const aligned = currentProject.aligned_lights || [];
        if (aligned.length) {
            html += '<optgroup label="Alineados">';
            aligned.forEach(a => {
                const name = a.filename.replace(/^aligned_[a-f0-9]+_/, '');
                html += `<option value="aligned:${a.id}">${name}</option>`;
            });
            html += '</optgroup>';
        }
        const lights = (currentProject.images && currentProject.images.light) || [];
        if (lights.length) {
            html += '<optgroup label="Lights">';
            lights.forEach(l => { html += `<option value="light:${l.id}">${l.filename}</option>`; });
            html += '</optgroup>';
        }
        return html;
    }

    function updateColorChannelSelects() {
        const opts = _buildImageOptions(false);
        const optsNone = _buildImageOptions(true);
        document.getElementById('colorChR').innerHTML = opts;
        document.getElementById('colorChG').innerHTML = opts;
        document.getElementById('colorChB').innerHTML = opts;
        document.getElementById('colorChL').innerHTML = optsNone;
    }

    function _parseSourceVal(val) {
        if (!val) return null;
        const [t, id] = val.split(':');
        return { source_type: t, source_id: id };
    }

    async function runComposeColor() {
        if (!currentProject) return;

        const rVal = document.getElementById('colorChR').value;
        const gVal = document.getElementById('colorChG').value;
        const bVal = document.getElementById('colorChB').value;

        const channels = {};
        const rSrc = _parseSourceVal(rVal);
        const gSrc = _parseSourceVal(gVal);
        const bSrc = _parseSourceVal(bVal);
        if (rSrc) channels.R = rSrc;
        if (gSrc) channels.G = gSrc;
        if (bSrc) channels.B = bSrc;

        if (Object.keys(channels).length === 0) {
            showToast('Asigna al menos un canal', 'error');
            return;
        }

        const lVal = document.getElementById('colorChL').value;
        const lSrc = _parseSourceVal(lVal);

        const stretch = document.getElementById('colorStretch').value || null;

        const body = {
            channels,
            saturation: parseFloat(document.getElementById('colorSaturation').value) || 1.0,
            auto_balance: document.getElementById('colorAutoBalance').checked,
            luminance_id: lSrc ? lSrc.source_id : null,
            luminance_type: lSrc ? lSrc.source_type : 'stacked',
            luminance_weight: parseFloat(document.getElementById('colorLumWeight').value) || 0.7,
            stretch_method: stretch,
        };

        const spinner = document.getElementById('colorSpinner');
        spinner.style.display = 'flex';
        document.getElementById('colorResultCard').style.display = 'none';

        try {
            const result = await api(`/projects/${currentProject.id}/color/compose`, {
                method: 'POST',
                body: JSON.stringify(body),
            });

            if (result.error) { showToast(result.error, 'error'); return; }

            currentProject = await api(`/projects/${currentProject.id}`);
            showColorResult(result);
            updateColorHistory();
            updateProcessingLog();
            updatePreviewSourceSelect();
            updateExportSourceSelect();
            showToast('Composición de color completada');
        } catch (err) {
            showToast('Error al componer color', 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    function showColorResult(result) {
        const card = document.getElementById('colorResultCard');
        card.style.display = '';

        if (result.thumbnail) {
            const thumbFile = result.thumbnail.replace('thumbnails/', '');
            document.getElementById('colorResultThumb').src =
                `${API}/projects/${currentProject.id}/thumbnails/${thumbFile}`;
        }

        document.getElementById('colorResSize').textContent =
            result.width && result.height ? `${result.width}×${result.height}` : '—';

        const cs = result.channel_stats || {};
        document.getElementById('colorResR').textContent = cs.R ? cs.R.mean.toFixed(3) : '—';
        document.getElementById('colorResG').textContent = cs.G ? cs.G.mean.toFixed(3) : '—';
        document.getElementById('colorResB').textContent = cs.B ? cs.B.mean.toFixed(3) : '—';
    }

    let _lastColorId = null;
    async function showColorFullscreen() {
        if (!currentProject) return;
        const composites = currentProject.color_composites || [];
        const latest = composites[composites.length - 1];
        if (!latest) return;

        const res = await fetch(`${API}/projects/${currentProject.id}/preview/color`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ composite_id: latest.id, max_size: 2000 }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        const overlay = document.createElement('div');
        overlay.className = 'preview-fullscreen-overlay';
        overlay.innerHTML = `<img src="${url}" alt="Color preview">`;
        overlay.addEventListener('click', () => { overlay.remove(); URL.revokeObjectURL(url); });
        document.body.appendChild(overlay);
    }

    function updateColorHistory() {
        if (!currentProject) return;
        const composites = currentProject.color_composites || [];
        const card = document.getElementById('colorHistoryCard');
        const badge = document.getElementById('colorHistoryBadge');
        const tbody = document.getElementById('colorHistoryTable');

        badge.textContent = composites.length;
        if (!composites.length) { card.style.display = 'none'; return; }

        card.style.display = '';
        tbody.innerHTML = composites.map(c => {
            const thumbUrl = c.thumbnail
                ? `${API}/projects/${currentProject.id}/thumbnails/${c.thumbnail.replace('thumbnails/', '')}`
                : null;
            const thumbHtml = thumbUrl
                ? `<img src="${thumbUrl}" class="image-thumb" alt="thumb">`
                : `<div class="image-thumb-placeholder"><i class="bi bi-image"></i></div>`;
            const chs = Object.keys(c.channels || {}).join(', ') + (c.luminance_id ? ' +L' : '');

            return `<tr>
                <td class="col-thumb">${thumbHtml}</td>
                <td>${escHtml(c.filename)}</td>
                <td>${chs}</td>
                <td>${c.width}×${c.height}</td>
                <td>${c.saturation != null ? c.saturation.toFixed(2) : '—'}</td>
                <td>${fmtDate(c.created)}</td>
                <td><button class="proc-delete-btn" title="Eliminar" onclick="window._deleteColor('${c.id}')"><i class="bi bi-trash"></i></button></td>
            </tr>`;
        }).join('');
    }

    window._deleteColor = async function(compId) {
        if (!currentProject) return;
        const r = await api(`/projects/${currentProject.id}/color/${compId}`, { method: 'DELETE' });
        if (r.deleted) {
            currentProject = await api(`/projects/${currentProject.id}`);
            updateColorHistory();
            updatePreviewSourceSelect();
            updateExportSourceSelect();
            showToast('Composición eliminada');
        }
    };

    function updateColorUI() {
        if (!currentProject) return;
        updateColorChannelSelects();
        updateColorHistory();

        const composites = currentProject.color_composites || [];
        if (composites.length > 0) {
            const latest = composites[composites.length - 1];
            showColorResult(latest);
        }
    }

    // ═══════════════════════════════════════════════
    //  PREVIEW
    // ═══════════════════════════════════════════════

    function initPreview() {
        document.getElementById('btnPreviewGenerate').addEventListener('click', generatePreview);
    }

    function updatePreviewSourceSelect() {
        const sel = document.getElementById('previewSourceSelect');
        sel.innerHTML = _buildImageOptions(false);
    }

    async function generatePreview() {
        if (!currentProject) return;
        const val = document.getElementById('previewSourceSelect').value;
        const src = _parseSourceVal(val);
        if (!src) { showToast('Selecciona una imagen', 'error'); return; }

        const spinner = document.getElementById('previewSpinner');
        spinner.style.display = 'flex';
        document.getElementById('previewDisplayCard').style.display = 'none';

        try {
            const isColor = src.source_type === 'color_composite';
            const stretch = document.getElementById('previewStretch').value;
            const maxSize = parseInt(document.getElementById('previewMaxSize').value) || 1200;

            let endpoint, body;
            if (isColor) {
                endpoint = 'preview/color';
                body = { composite_id: src.source_id, max_size: maxSize };
            } else {
                endpoint = 'preview/mono';
                body = {
                    source_id: src.source_id,
                    source_type: src.source_type,
                    stretch_method: stretch,
                    max_size: maxSize,
                };
            }

            const res = await fetch(`${API}/projects/${currentProject.id}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) { showToast('Error al generar vista previa', 'error'); return; }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const img = document.getElementById('previewImage');

            // Revoke previous URL
            if (img._prevUrl) URL.revokeObjectURL(img._prevUrl);
            img.src = url;
            img._prevUrl = url;

            // Click for fullscreen
            img.onclick = () => {
                const overlay = document.createElement('div');
                overlay.className = 'preview-fullscreen-overlay';
                overlay.innerHTML = `<img src="${url}" alt="Fullscreen preview">`;
                overlay.addEventListener('click', () => overlay.remove());
                document.body.appendChild(overlay);
            };

            document.getElementById('previewDisplayCard').style.display = '';
        } catch (err) {
            showToast('Error de previsualización', 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    function updatePreviewUI() {
        if (!currentProject) return;
        updatePreviewSourceSelect();
    }

    // ═══════════════════════════════════════════════
    //  EXPORT
    // ═══════════════════════════════════════════════

    function initExport() {
        document.getElementById('btnExport').addEventListener('click', runExport);
        document.getElementById('exportStretch').addEventListener('change', e => {
            document.getElementById('exportStretchMethodGroup').style.display = e.target.checked ? '' : 'none';
        });
    }

    function updateExportSourceSelect() {
        const sel = document.getElementById('exportSourceSelect');
        sel.innerHTML = _buildImageOptions(false);
    }

    async function runExport() {
        if (!currentProject) return;
        const val = document.getElementById('exportSourceSelect').value;
        const src = _parseSourceVal(val);
        if (!src) { showToast('Selecciona una imagen', 'error'); return; }

        const format = document.getElementById('exportFormat').value;
        const bitDepth = parseInt(document.getElementById('exportBitDepth').value) || 16;
        const stretchOn = document.getElementById('exportStretch').checked;
        const stretchMethod = document.getElementById('exportStretchMethod').value;

        const spinner = document.getElementById('exportSpinner');
        spinner.style.display = 'flex';
        document.getElementById('exportResultCard').style.display = 'none';

        try {
            const body = {
                source_id: src.source_id,
                source_type: src.source_type,
                format,
                bit_depth: bitDepth,
                stretch_on_export: stretchOn,
                stretch_method: stretchMethod,
            };

            const res = await fetch(`${API}/projects/${currentProject.id}/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || 'Error al exportar', 'error');
                return;
            }

            // Trigger download
            const blob = await res.blob();
            const contentDisp = res.headers.get('content-disposition') || '';
            const filenameMatch = contentDisp.match(/filename="?([^";]+)"?/);
            const filename = filenameMatch ? filenameMatch[1] : `export.${format}`;

            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

            document.getElementById('exportResultMsg').textContent =
                `✓ Exportado como ${filename} (${(blob.size / 1024).toFixed(1)} KB)`;
            document.getElementById('exportResultCard').style.display = '';
            showToast(`Exportado: ${filename}`);
        } catch (err) {
            showToast('Error al exportar', 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    function updateExportUI() {
        if (!currentProject) return;
        updateExportSourceSelect();
    }

    // ═══════════════════════════════════════════════
    //  PHASE 5 — PIPELINE PROGRESS
    // ═══════════════════════════════════════════════

    function updatePipelineProgress() {
        if (!currentProject) return;
        const p = currentProject;
        const imgs = p.images || {};
        const log = (p.processing_log || []).map(e => (e.description || '').toLowerCase()).join(' ');

        const hasImages = Object.values(imgs).some(arr => (arr || []).length > 0);
        const hasMasters = !!(p.master_bias || p.master_dark || p.master_flat);
        const hasCalibrated = (imgs.calibrated || []).length > 0 || log.includes('calibra');
        const hasAligned = (imgs.aligned || []).length > 0 || log.includes('alinea') || log.includes('align');
        const hasStacked = Object.keys(p.stacked_channels || {}).length > 0 || log.includes('apila') || log.includes('stack');
        const hasProcessed = log.includes('stretch') || log.includes('recort') || log.includes('crop') || log.includes('rot');
        const hasExported = log.includes('export');

        const steps = [
            { id: 'pp-load', done: hasImages },
            { id: 'pp-calibration', done: hasMasters || hasCalibrated },
            { id: 'pp-alignment', done: hasAligned },
            { id: 'pp-stacking', done: hasStacked },
            { id: 'pp-processing', done: hasProcessed },
            { id: 'pp-export', done: hasExported },
        ];

        // Find the first not-done step → that's active
        let activeIdx = steps.findIndex(s => !s.done);
        if (activeIdx === -1) activeIdx = steps.length; // all done

        steps.forEach((s, i) => {
            const el = document.getElementById(s.id);
            if (!el) return;
            el.classList.remove('done', 'active');
            if (s.done) el.classList.add('done');
            else if (i === activeIdx) el.classList.add('active');
        });
    }

    // ═══════════════════════════════════════════════
    //  PHASE 5 — UNDO / REDO
    // ═══════════════════════════════════════════════

    function initUndoRedo() {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');

        if (btnUndo) btnUndo.addEventListener('click', doUndo);
        if (btnRedo) btnRedo.addEventListener('click', doRedo);

        document.addEventListener('keydown', (e) => {
            if (!currentProject) return;
            if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); doUndo(); }
            if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z') || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); doRedo(); }
        });
    }

    async function doUndo() {
        if (!currentProject) return;
        try {
            const data = await api(`/projects/${currentProject.id}/undo`, { method: 'POST' });
            if (data.error) { showToast(data.error, 'warning'); return; }
            currentProject = data;
            populateWorkspace();
            showToast('Deshacer aplicado');
        } catch { showToast('Error al deshacer', 'error'); }
    }

    async function doRedo() {
        if (!currentProject) return;
        try {
            const data = await api(`/projects/${currentProject.id}/redo`, { method: 'POST' });
            if (data.error) { showToast(data.error, 'warning'); return; }
            currentProject = data;
            populateWorkspace();
            showToast('Rehacer aplicado');
        } catch { showToast('Error al rehacer', 'error'); }
    }

    async function updateUndoRedoButtons() {
        if (!currentProject) {
            setUndoRedoState(false, false);
            return;
        }
        try {
            const st = await api(`/projects/${currentProject.id}/undo-redo-status`);
            setUndoRedoState(st.can_undo, st.can_redo);
        } catch {
            setUndoRedoState(false, false);
        }
    }

    function setUndoRedoState(canUndo, canRedo) {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.disabled = !canUndo;
        if (btnRedo) btnRedo.disabled = !canRedo;
    }

    // ═══════════════════════════════════════════════
    //  PHASE 5 — TUTORIAL MODE
    // ═══════════════════════════════════════════════

    // Generic tab-overview steps (used when no guided tutorial is active)
    const GENERIC_STEPS = [
        { tab: 'tab-project', title: 'Proyecto', body: 'Aquí configuras los metadatos de tu proyecto: nombre del objeto, telescopio, fecha de observación… Estos datos se guardan junto a tu trabajo.' },
        { tab: 'tab-images', title: 'Carga de imágenes', body: 'Sube tus imágenes FITS, TIFF, RAW o JPG. El sistema intenta clasificarlas automáticamente en lights, darks, flats y bias según el nombre y los headers FITS.' },
        { tab: 'tab-calibration', title: 'Calibración', body: 'Crea los <b>master frames</b> (bias, dark, flat) y aplícalos a los lights para eliminar ruido térmico, corriente oscura y viñeteo. Es el primer paso de la cadena de procesado.' },
        { tab: 'tab-alignment', title: 'Alineamiento', body: 'Detecta estrellas en cada frame y calcula transformaciones geométricas para que todos queden perfectamente alineados. Puedes ver la puntuación de calidad de cada frame.' },
        { tab: 'tab-stacking', title: 'Apilado', body: 'Combina los frames alineados en una sola imagen por canal, aumentando la relación señal-ruido. Se ofrecen varios métodos: media, mediana, sigma-clip, winsorized…' },
        { tab: 'tab-processing', title: 'Procesado', body: 'Ajusta el histograma con diferentes funciones de <i>stretching</i>, recorta o rota la imagen. Aquí es donde se revela el detalle oculto en los datos.' },
        { tab: 'tab-color', title: 'Composición de color', body: 'Asigna canales a colores y crea tu imagen final en color. Puedes usar paletas como SHO (Hubble), HOO, OSC o personalizar los canales libremente.' },
        { tab: 'tab-liveedit', title: 'Edición en vivo', body: 'El editor visual procesa todo en tu <b>navegador</b>: brillo, contraste, exposición, gamma, saturación, sombras/luces, enfoque, reducción de ruido, rotación… Los cambios son instantáneos y no destructivos. Cuando estés satisfecho, exporta directamente a PNG.' },
        { tab: 'tab-preview', title: 'Previsualización', body: 'Vista rápida no destructiva de cualquier light, útil para comprobar el encuadre y la calidad antes de procesar.' },
        { tab: 'tab-export', title: 'Exportar', body: 'Descarga tu resultado en FITS (datos científicos), TIFF (16 bit), PNG o JPG. Puedes elegir el canal o la imagen compuesta de color.' },
    ];

    let tutorialStep = 0;
    let tutorialActive = false;
    let guidedTutorial = null;       // null = generic, object = guided tutorial data
    let activeTutorialSteps = GENERIC_STEPS;

    function initTutorial() {
        const btnTut = document.getElementById('btnTutorial');
        if (btnTut) btnTut.addEventListener('click', toggleTutorial);

        const btnClose = document.getElementById('btnTutorialClose');
        if (btnClose) btnClose.addEventListener('click', () => endTutorial());

        const btnCollapse = document.getElementById('btnTutCollapse');
        if (btnCollapse) btnCollapse.addEventListener('click', () => {
            document.getElementById('tutorialOverlay').classList.toggle('collapsed');
        });

        // Load tutorials grid in splash
        loadTutorialsList();
    }

    // ── Tutorials grid in splash ────────────────
    async function loadTutorialsList() {
        const $grid = document.getElementById('tutorialsList');
        if (!$grid) return;
        try {
            const tutorials = await api('/tutorials');
            if (!tutorials.length) {
                $grid.innerHTML = '<p class="text-secondary">No hay tutoriales disponibles.</p>';
                return;
            }
            $grid.innerHTML = tutorials.map(t => {
                const externalClass = t.bundled ? '' : 'tut-external';
                const extBadge = t.bundled ? '' :
                    `<span class="tut-ext-badge"><i class="bi bi-cloud-download me-1"></i>Dataset externo</span>`;
                return `
                    <div class="tutorial-card-item ${externalClass}" data-tutorial="${t.id}">
                        <i class="bi ${t.icon} tut-icon"></i>
                        <h5>${escHtml(t.title)}</h5>
                        <p class="tut-subtitle">${escHtml(t.subtitle)}</p>
                        <div class="tut-meta">
                            <span class="badge bg-secondary">${escHtml(t.category)}</span>
                            <span><i class="bi bi-clock me-1"></i>${t.duration}</span>
                            <span>${t.num_steps} pasos</span>
                            ${extBadge}
                        </div>
                    </div>
                `;
            }).join('');

            $grid.querySelectorAll('.tutorial-card-item').forEach(card => {
                card.addEventListener('click', () => startGuidedTutorial(card.dataset.tutorial));
            });
        } catch (err) {
            $grid.innerHTML = '<p class="text-danger">Error al cargar tutoriales.</p>';
        }
    }

    // ── Start a guided tutorial ─────────────────
    async function startGuidedTutorial(tutorialId) {
        showToast('Preparando tutorial…', 'info');
        try {
            const res = await api(`/tutorials/${tutorialId}/start`, { method: 'POST' });
            if (res.error) { showToast(res.error, 'error'); return; }

            guidedTutorial = res.tutorial;
            activeTutorialSteps = guidedTutorial.steps;
            currentProject = res.project;

            $splash.style.display = 'none';
            $workspace.style.display = 'flex';
            populateWorkspace();

            // Auto-start the guided tutorial overlay
            tutorialActive = true;
            tutorialStep = 0;
            document.getElementById('tutorialOverlay').style.display = '';
            renderTutorialStep();

            showToast(`Tutorial "${guidedTutorial.title}" iniciado`);
        } catch (err) {
            showToast('Error al iniciar el tutorial', 'error');
        }
    }

    function toggleTutorial() {
        if (tutorialActive) { endTutorial(); return; }
        // If we're in a guided tutorial project, resume it; otherwise generic
        if (currentProject && currentProject.metadata && currentProject.metadata.tutorial_id && guidedTutorial) {
            activeTutorialSteps = guidedTutorial.steps;
        } else {
            activeTutorialSteps = GENERIC_STEPS;
            guidedTutorial = null;
        }
        tutorialActive = true;
        tutorialStep = 0;
        document.getElementById('tutorialOverlay').style.display = '';
        renderTutorialStep();
    }

    function endTutorial() {
        tutorialActive = false;
        const overlay = document.getElementById('tutorialOverlay');
        overlay.style.display = 'none';
        overlay.classList.remove('collapsed');
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
    }

    function goTutorialStep(delta) {
        tutorialStep = Math.max(0, Math.min(activeTutorialSteps.length - 1, tutorialStep + delta));
        renderTutorialStep();
    }

    function renderTutorialStep() {
        const step = activeTutorialSteps[tutorialStep];
        const total = activeTutorialSteps.length;
        document.getElementById('tutStepIndicator').textContent = `${tutorialStep + 1}/${total}`;
        document.getElementById('tutBody').innerHTML = `<h6>${step.title}</h6><p class="mb-0">${step.body}</p>`;

        // Header title
        const headerTitle = document.getElementById('tutHeaderTitle');
        if (guidedTutorial) {
            headerTitle.textContent = guidedTutorial.title;
        } else {
            headerTitle.textContent = 'Modo Tutorial';
        }

        // Credit bar
        const creditEl = document.getElementById('tutCredit');
        if (guidedTutorial && guidedTutorial.credit) {
            creditEl.style.display = '';
            creditEl.innerHTML = `<i class="bi bi-info-circle me-1"></i>Datos: `
                + `<a href="${guidedTutorial.credit_url || '#'}" target="_blank">${escHtml(guidedTutorial.credit)}</a>`
                + ` · ${escHtml(guidedTutorial.license || '')}`;
        } else {
            creditEl.style.display = 'none';
        }

        // Navigate to the relevant tab
        switchTab(step.tab);

        // Highlight the tab button
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
        const tabBtn = document.querySelector(`.etab[data-tab="${step.tab}"]`);
        if (tabBtn) tabBtn.classList.add('tutorial-highlight');

        document.getElementById('btnTutPrev').disabled = tutorialStep === 0;
        document.getElementById('btnTutPrev').onclick = () => goTutorialStep(-1);
        const btnNext = document.getElementById('btnTutNext');
        if (tutorialStep === activeTutorialSteps.length - 1) {
            btnNext.innerHTML = '<i class="bi bi-check-lg me-1"></i> Finalizar';
            btnNext.onclick = () => endTutorial();
        } else {
            btnNext.innerHTML = 'Siguiente <i class="bi bi-chevron-right"></i>';
            btnNext.onclick = () => goTutorialStep(1);
        }
    }

    // ═══════════════════════════════════════════════
    //  PHASE 5 — COMPARATOR (BEFORE / AFTER)
    // ═══════════════════════════════════════════════

    function initComparator() {
        const btnComp = document.getElementById('btnComparator');
        if (btnComp) btnComp.addEventListener('click', openComparator);

        const btnCompare = document.getElementById('btnCompare');
        if (btnCompare) btnCompare.addEventListener('click', loadComparison);

        initCompSlider();
    }

    function openComparator() {
        populateCompSelects();
        const modal = new bootstrap.Modal(document.getElementById('comparatorModal'));
        modal.show();
    }

    function populateCompSelects() {
        if (!currentProject) return;
        const imgs = currentProject.images || {};
        let options = '<option value="">— Seleccionar —</option>';
        const allTypes = ['light', 'calibrated', 'aligned', 'dark', 'flat', 'bias', 'unclassified'];
        allTypes.forEach(type => {
            (imgs[type] || []).forEach(img => {
                const name = img.original_name || img.id;
                options += `<option value="${type}/${img.id}">${escHtml(name)} (${type})</option>`;
            });
        });
        // Add stacked channels
        const stacked = currentProject.stacked_channels || {};
        Object.keys(stacked).forEach(ch => {
            options += `<option value="stacked/${ch}">Apilado: ${escHtml(ch)}</option>`;
        });
        document.getElementById('compSelectA').innerHTML = options;
        document.getElementById('compSelectB').innerHTML = options;
    }

    async function loadComparison() {
        const selA = document.getElementById('compSelectA').value;
        const selB = document.getElementById('compSelectB').value;
        if (!selA || !selB) { showToast('Selecciona ambas imágenes', 'warning'); return; }

        const spinner = document.getElementById('compSpinner');
        const display = document.getElementById('compDisplay');
        spinner.style.display = '';
        display.style.display = 'none';

        try {
            const [imgA, imgB] = await Promise.all([
                fetchCompPreview(selA),
                fetchCompPreview(selB),
            ]);
            document.getElementById('compImgA').src = imgA;
            document.getElementById('compImgB').src = imgB;
            display.style.display = '';
            // Reset slider to 50%
            setCompSlider(0.5);
        } catch {
            showToast('Error generando comparativa', 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    async function fetchCompPreview(sel) {
        if (!currentProject) throw new Error();
        const pid = currentProject.id;
        if (sel.startsWith('stacked/')) {
            const ch = sel.replace('stacked/', '');
            const d = await api(`/projects/${pid}/preview/color?channels=${encodeURIComponent(JSON.stringify({ r: ch }))}`);
            if (d.error) throw new Error(d.error);
            return `data:image/png;base64,${d.image}`;
        }
        const [type, imgId] = sel.split('/');
        const d = await api(`/projects/${pid}/preview/${type}/${imgId}`);
        if (d.error) throw new Error(d.error);
        return `data:image/png;base64,${d.image}`;
    }

    function setCompSlider(pct) {
        pct = Math.max(0, Math.min(1, pct));
        const overlay = document.getElementById('compOverlay');
        const divider = document.getElementById('compDivider');
        overlay.style.width = (pct * 100) + '%';
        divider.style.left = (pct * 100) + '%';
        // Adjust inner image to compensate for crop
        const imgB = document.getElementById('compImgB');
        if (pct > 0) {
            imgB.style.width = (100 / pct) + '%';
        }
    }

    function initCompSlider() {
        const container = document.getElementById('compContainer');
        if (!container) return;
        let dragging = false;

        function updateFromEvent(e) {
            const rect = container.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const pct = (clientX - rect.left) / rect.width;
            setCompSlider(pct);
        }

        container.addEventListener('mousedown', (e) => { dragging = true; updateFromEvent(e); });
        container.addEventListener('touchstart', (e) => { dragging = true; updateFromEvent(e); }, { passive: true });
        document.addEventListener('mousemove', (e) => { if (dragging) updateFromEvent(e); });
        document.addEventListener('touchmove', (e) => { if (dragging) updateFromEvent(e); }, { passive: true });
        document.addEventListener('mouseup', () => { dragging = false; });
        document.addEventListener('touchend', () => { dragging = false; });
    }

    // ═══════════════════════════════════════════════
    //  LIVE EDITOR (client-side Canvas processing)
    // ═══════════════════════════════════════════════

    let liveProc = null;  // AstroImageProcessor instance

    function initLiveEdit() {
        const canvas = document.getElementById('liveEditCanvas');
        const histo = document.getElementById('liveEditHistoCanvas');
        if (!canvas || typeof AstroImageProcessor === 'undefined') return;

        liveProc = new AstroImageProcessor(canvas, histo);

        // Update info text after every render
        liveProc.onChange(() => {
            const info = document.getElementById('liveEditInfo');
            if (info && liveProc.loaded) {
                info.textContent = `${liveProc.sourceWidth} × ${liveProc.sourceHeight} px`;
            }
        });

        // Load button
        document.getElementById('btnLiveEditLoad').addEventListener('click', loadLiveEditImage);

        // Reset
        document.getElementById('btnLiveEditReset').addEventListener('click', () => {
            if (!liveProc.loaded) return;
            liveProc.resetEdits();
            syncLiveEditSlidersFromProc();
        });

        // Export
        document.getElementById('btnLiveEditExport').addEventListener('click', exportLiveEdit);

        // Stretch method toggling
        document.getElementById('liveEditStretch').addEventListener('change', (ev) => {
            liveProc.setEdit('stretch', ev.target.value);
            showLiveStretchParams(ev.target.value);
        });

        // Bind all sliders
        const sliders = {
            leBP:         { key: 'stretchBP',   fmt: v => parseFloat(v).toFixed(1) },
            leWP:         { key: 'stretchWP',   fmt: v => parseFloat(v).toFixed(1) },
            leBeta:       { key: 'stretchBeta',  fmt: v => v },
            leMid:        { key: 'stretchMid',   fmt: v => parseFloat(v).toFixed(2) },
            leScale:      { key: 'stretchScale', fmt: v => v },
            leBrightness: { key: 'brightness',   fmt: v => v },
            leContrast:   { key: 'contrast',     fmt: v => v },
            leExposure:   { key: 'exposure',     fmt: v => parseFloat(v).toFixed(2) },
            leGamma:      { key: 'gamma',        fmt: v => parseFloat(v).toFixed(2) },
            leSaturation: { key: 'saturation',   fmt: v => v },
            leShadows:    { key: 'shadows',      fmt: v => v },
            leHighlights: { key: 'highlights',   fmt: v => v },
            leSharpen:    { key: 'sharpen',       fmt: v => v },
            leDenoise:    { key: 'denoise',       fmt: v => v },
            leRotation:   { key: 'rotation',      fmt: v => parseFloat(v).toFixed(1) },
        };

        Object.entries(sliders).forEach(([id, cfg]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                document.getElementById(id + 'Val').textContent = cfg.fmt(val);
                liveProc.setEdit(cfg.key, val);
            });
        });

        // Rotate 90 buttons
        document.getElementById('btnLeRot90CW').addEventListener('click', () => {
            const r = (liveProc.edits.rotation + 90) % 360;
            liveProc.setEdit('rotation', r);
            syncRotSlider(r);
        });
        document.getElementById('btnLeRot90CCW').addEventListener('click', () => {
            const r = (liveProc.edits.rotation - 90 + 360) % 360;
            liveProc.setEdit('rotation', r > 180 ? r - 360 : r);
            syncRotSlider(liveProc.edits.rotation);
        });

        // Flip buttons
        document.getElementById('btnLeFlipH').addEventListener('click', () => {
            liveProc.setEdit('flipH', !liveProc.edits.flipH);
        });
        document.getElementById('btnLeFlipV').addEventListener('click', () => {
            liveProc.setEdit('flipV', !liveProc.edits.flipV);
        });
    }

    function syncRotSlider(r) {
        const el = document.getElementById('leRotation');
        if (el) { el.value = r; document.getElementById('leRotationVal').textContent = parseFloat(r).toFixed(1); }
    }

    function showLiveStretchParams(method) {
        document.getElementById('leBetaGroup').style.display = method === 'asinh' ? '' : 'none';
        document.getElementById('leMidGroup').style.display = method === 'midtone' ? '' : 'none';
        document.getElementById('leScaleGroup').style.display = method === 'log' ? '' : 'none';
    }

    function syncLiveEditSlidersFromProc() {
        if (!liveProc) return;
        const e = liveProc.edits;
        const sets = {
            leBP: e.stretchBP, leWP: e.stretchWP, leBeta: e.stretchBeta,
            leMid: e.stretchMid, leScale: e.stretchScale,
            leBrightness: e.brightness, leContrast: e.contrast,
            leExposure: e.exposure, leGamma: e.gamma,
            leSaturation: e.saturation, leShadows: e.shadows, leHighlights: e.highlights,
            leSharpen: e.sharpen, leDenoise: e.denoise, leRotation: e.rotation,
        };
        Object.entries(sets).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
                const valEl = document.getElementById(id + 'Val');
                if (valEl) valEl.textContent = typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(2) : val;
            }
        });
        const stretchEl = document.getElementById('liveEditStretch');
        if (stretchEl) { stretchEl.value = e.stretch; showLiveStretchParams(e.stretch); }
    }

    async function loadLiveEditImage() {
        if (!currentProject) { showToast('Abre un proyecto primero', 'warning'); return; }
        const sel = document.getElementById('liveEditSource').value;
        if (!sel) { showToast('Selecciona una imagen', 'warning'); return; }

        const spinner = document.getElementById('liveEditLoadSpinner');
        const layout = document.getElementById('liveEditorLayout');
        spinner.style.display = '';

        try {
            let b64 = null;
            const pid = currentProject.id;
            const stretch = document.getElementById('liveEditStretch').value;

            if (sel === 'color_composite') {
                const d = await api(`/projects/${pid}/preview/color`);
                if (d.error) throw new Error(d.error);
                b64 = d.image;
            } else if (sel.startsWith('stacked/')) {
                const ch = sel.replace('stacked/', '');
                const channels = JSON.stringify({ r: ch });
                const d = await api(`/projects/${pid}/preview/color?channels=${encodeURIComponent(channels)}&stretch=${stretch}&max_size=2000`);
                if (d.error) throw new Error(d.error);
                b64 = d.image;
            } else {
                const [type, imgId] = sel.split('/');
                const d = await api(`/projects/${pid}/preview/${type}/${imgId}?stretch=${stretch}&max_size=2000`);
                if (d.error) throw new Error(d.error);
                b64 = d.image;
            }

            await liveProc.loadFromBase64(b64);
            // Apply the selected stretch as default
            const stretchMethod = document.getElementById('liveEditStretch').value;
            if (stretchMethod !== 'none') {
                liveProc.setEdit('stretch', stretchMethod);
            }
            layout.style.display = '';
            showToast('Imagen cargada en el editor');
        } catch (err) {
            showToast('Error cargando imagen: ' + (err.message || err), 'error');
        } finally {
            spinner.style.display = 'none';
        }
    }

    function populateLiveEditSource() {
        if (!currentProject) return;
        const select = document.getElementById('liveEditSource');
        if (!select) return;
        const imgs = currentProject.images || {};
        let html = '<option value="" disabled selected>— Selecciona una imagen —</option>';

        // Stacked channels first
        const stacked = currentProject.stacked_channels || {};
        Object.keys(stacked).forEach(ch => {
            html += `<option value="stacked/${ch}">📊 Apilado: ${escHtml(ch)}</option>`;
        });

        // Color composite
        if (currentProject.color_composite) {
            html += `<option value="color_composite">🎨 Composición de color</option>`;
        }

        // Individual images
        ['calibrated', 'aligned', 'light', 'dark', 'flat', 'bias'].forEach(type => {
            (imgs[type] || []).forEach(img => {
                const name = img.original_name || img.id;
                html += `<option value="${type}/${img.id}">${escHtml(name)} (${type})</option>`;
            });
        });

        select.innerHTML = html;
    }

    function updateLiveEditUI() {
        populateLiveEditSource();
    }

    async function exportLiveEdit() {
        if (!liveProc || !liveProc.loaded) { showToast('No hay imagen cargada', 'warning'); return; }
        try {
            const blob = await liveProc.toBlob('image/png');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `astroeditor_export_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Imagen exportada');
        } catch {
            showToast('Error al exportar', 'error');
        }
    }

})();
