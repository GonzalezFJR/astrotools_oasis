/* ============================================
   OASIS ASTROTOOLS — FOV Calculator JS
   ============================================ */

(function () {
    let fovMode = 'camera';
    let catalogData = {};
    let fovOverlay = null;

    document.addEventListener('DOMContentLoaded', () => {
        // --- Mode toggle ---
        const modeBtns = document.querySelectorAll('#fovModeToggle .mode-btn');
        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                fovMode = btn.dataset.mode;
                document.getElementById('cameraParamsGroup').style.display =
                    fovMode === 'camera' ? 'block' : 'none';
                document.getElementById('eyepieceParamsGroup').style.display =
                    fovMode === 'eyepiece' ? 'block' : 'none';
            });
        });

        // --- Range display ---
        bindRangeDisplay('fieldRotation', 'fieldRotationValue', v => v + '°');

        // --- Catalog loading ---
        loadCatalog('messier');

        document.getElementById('catalogType').addEventListener('change', e => {
            loadCatalog(e.target.value);
        });

        // --- Target selection ---
        document.getElementById('targetSelect').addEventListener('change', e => {
            goToTarget(e.target.value);
        });

        // --- Custom target ---
        document.getElementById('goToCustomTarget').addEventListener('click', () => {
            const name = document.getElementById('customTarget').value.trim();
            if (name) goToTarget(name);
        });
        document.getElementById('customTarget').addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const name = e.target.value.trim();
                if (name) goToTarget(name);
            }
        });

        // --- Survey selector ---
        document.getElementById('surveySelect').addEventListener('change', e => {
            if (window.aladinInstance) {
                window.aladinInstance.setImageSurvey(e.target.value);
            }
        });

        // --- Calculate button ---
        document.getElementById('fovCalculateBtn').addEventListener('click', calculateAndDraw);
    });

    async function loadCatalog(type) {
        try {
            const data = await apiGet(`/api/catalogs/${type}`);
            catalogData[type] = data;
            const select = document.getElementById('targetSelect');
            select.innerHTML = '';
            data.forEach(obj => {
                const opt = document.createElement('option');
                opt.value = obj.id;
                opt.textContent = obj.name
                    ? `${obj.id} — ${obj.name}`
                    : obj.id;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('Error loading catalog:', err);
        }
    }

    function goToTarget(name) {
        if (!window.aladinInstance) return;
        window.aladinInstance.gotoObject(name, {
            success: () => {
                // Update header
                const select = document.getElementById('targetSelect');
                const opt = select.querySelector(`option[value="${name}"]`);
                document.getElementById('skyViewTarget').textContent =
                    opt ? opt.textContent : name;
                // Auto-recalculate if we have a previous result
                if (document.getElementById('fovResults').style.display !== 'none') {
                    calculateAndDraw();
                }
            },
            error: () => {
                console.warn('Could not resolve target:', name);
            }
        });
    }

    async function calculateAndDraw() {
        const data = {
            mode: fovMode,
            telescope_focal_length: parseFloat(document.getElementById('fovFocalLength').value),
            telescope_diameter: parseFloat(document.getElementById('fovDiameter').value),
            camera: {
                pixel_size: parseFloat(document.getElementById('fovPixelSize').value),
                sensor_width: parseInt(document.getElementById('sensorWidth').value),
                sensor_height: parseInt(document.getElementById('sensorHeight').value),
                binning: parseInt(document.getElementById('fovBinning').value),
            },
            eyepiece: {
                focal_length: parseFloat(document.getElementById('eyepieceFocal').value),
                afov: parseFloat(document.getElementById('eyepieceAFOV').value),
            },
            rotation: parseFloat(document.getElementById('fieldRotation').value),
        };

        try {
            const result = await apiPost('/api/fov/calculate', data);
            displayFOVResults(result);
            drawFOVOverlay(result);
        } catch (err) {
            console.error('FOV calculation error:', err);
            alert('Error en el cálculo: ' + err.message);
        }
    }

    function displayFOVResults(r) {
        const container = document.getElementById('fovResults');
        container.style.display = 'block';

        const tbody = document.getElementById('fovResultsBody');
        tbody.innerHTML = '';

        const rows = [];

        if (r.mode === 'camera') {
            rows.push(['FOV ancho', r.fov_width_arcmin + "'", '(' + r.fov_width_deg + '°)']);
            rows.push(['FOV alto', r.fov_height_arcmin + "'", '(' + r.fov_height_deg + '°)']);
            rows.push(['Diagonal', r.fov_diagonal_arcmin + "'", '']);
            rows.push(['Escala de placa', r.plate_scale_arcsec + '', '"/px']);
            rows.push(['Sensor', r.sensor_width_mm + ' × ' + r.sensor_height_mm, 'mm']);
            rows.push(['Resolución', r.resolution_width + ' × ' + r.resolution_height, 'px']);
        } else {
            rows.push(['Aumentos', r.magnification + '×', '']);
            rows.push(['FOV real', r.true_fov_arcmin + "'", '(' + r.true_fov_deg + '°)']);
            rows.push(['Pupila de salida', r.exit_pupil_mm, 'mm']);
        }

        rows.push(['Relación focal', 'f/' + r.f_ratio.toFixed(1), '']);
        rows.push(['Rotación', r.rotation + '°', '']);

        rows.forEach(([label, value, unit]) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${label}</td><td>${value}</td><td>${unit}</td>`;
            tbody.appendChild(tr);
        });
    }

    function drawFOVOverlay(r) {
        const aladin = window.aladinInstance;
        const A = window.AladinLib;
        if (!aladin || !A) return;

        // Remove previous overlay
        if (fovOverlay) {
            aladin.removeLayer(fovOverlay);
        }

        fovOverlay = A.graphicOverlay({
            color: '#00ff88',
            lineWidth: 2,
        });
        aladin.addOverlay(fovOverlay);

        // Get current center
        const [ra, dec] = aladin.getRaDec();
        const rotation = r.rotation || 0;

        if (r.mode === 'camera') {
            const widthDeg = r.fov_width_deg;
            const heightDeg = r.fov_height_deg;
            drawRectangle(fovOverlay, A, ra, dec, widthDeg, heightDeg, rotation);

            // Adjust FOV to show a bit more than the sensor
            const maxDim = Math.max(widthDeg, heightDeg);
            aladin.setFoV(maxDim * 1.8);
        } else {
            const radiusDeg = r.true_fov_deg / 2;
            fovOverlay.add(A.circle(ra, dec, radiusDeg, {
                color: '#00ff88',
                lineWidth: 2,
            }));
            aladin.setFoV(r.true_fov_deg * 1.8);
        }
    }

    function drawRectangle(overlay, A, raCen, decCen, wDeg, hDeg, rotDeg) {
        const rot = rotDeg * Math.PI / 180;
        const cosRot = Math.cos(rot);
        const sinRot = Math.sin(rot);
        const cosDec = Math.cos(decCen * Math.PI / 180);

        const hw = wDeg / 2;
        const hh = hDeg / 2;

        // Corner offsets (before rotation)
        const corners = [
            [-hw, -hh],
            [hw, -hh],
            [hw, hh],
            [-hw, hh],
        ];

        // Rotate and project (flat-sky approximation)
        const projected = corners.map(([dx, dy]) => {
            const rx = dx * cosRot - dy * sinRot;
            const ry = dx * sinRot + dy * cosRot;
            return [raCen + rx / cosDec, decCen + ry];
        });

        overlay.add(A.polygon(projected, {
            color: '#00ff88',
            lineWidth: 2,
        }));

        // Draw crosshair at center
        const chSize = Math.min(wDeg, hDeg) * 0.05;
        overlay.add(A.polyline(
            [[raCen - chSize / cosDec, decCen], [raCen + chSize / cosDec, decCen]],
            { color: '#00ff8888', lineWidth: 1 }
        ));
        overlay.add(A.polyline(
            [[raCen, decCen - chSize], [raCen, decCen + chSize]],
            { color: '#00ff8888', lineWidth: 1 }
        ));
    }

    // Expose initialization function for Aladin module script
    window.initFOVTool = function (A, aladin) {
        // Aladin is ready — trigger initial calculation if user clicks the button
        console.log('Aladin Lite initialized');
    };
})();
