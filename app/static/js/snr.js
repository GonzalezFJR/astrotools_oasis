/* ============================================
   OASIS ASTROTOOLS — SNR Calculator JS
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    let noiseChart = null;
    // Store last result rates for the exposure toolkit
    let lastRates = null;

    // --- Range inputs ---
    bindRangeDisplay('opticalEfficiency', 'opticalEfficiencyValue', v => Math.round(v * 100) + '%');
    bindRangeDisplay('qe', 'qeValue', v => Math.round(v * 100) + '%');

    // --- Calculate ---
    document.getElementById('calculateBtn').addEventListener('click', calculate);

    // Allow Enter key on inputs to trigger calculation
    document.querySelectorAll('.param-tabs .param-input input, .param-tabs .param-input select').forEach(el => {
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') calculate();
        });
    });

    // --- Exposure Toolkit sliders ---
    const toolkitSNR = document.getElementById('toolkitSNR');
    const toolkitNExp = document.getElementById('toolkitNExp');
    toolkitSNR.addEventListener('input', () => {
        document.getElementById('toolkitSNRValue').textContent = toolkitSNR.value;
        updateToolkit();
    });
    toolkitNExp.addEventListener('input', () => {
        document.getElementById('toolkitNExpValue').textContent = toolkitNExp.value;
        updateToolkit();
    });

    async function calculate() {
        const btn = document.getElementById('calculateBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Calculando...';

        const data = {
            mode: 'snr',
            camera: {
                pixel_size: parseFloat(document.getElementById('pixelSize').value),
                binning: parseInt(document.getElementById('binning').value),
                readout_noise: parseFloat(document.getElementById('readoutNoise').value),
                gain: parseFloat(document.getElementById('gain').value),
                temperature: parseFloat(document.getElementById('temperature').value),
                t_ref: parseFloat(document.getElementById('tRef').value),
                dark_current_ref: parseFloat(document.getElementById('darkCurrent').value),
            },
            telescope: {
                focal_length: parseFloat(document.getElementById('focalLength').value),
                diameter: parseFloat(document.getElementById('diameter').value),
                secondary_diameter: parseFloat(document.getElementById('secondaryDiameter').value),
                optical_efficiency: parseFloat(document.getElementById('opticalEfficiency').value),
            },
            observation: {
                filter_band: document.getElementById('filterBand').value,
                quantum_efficiency: parseFloat(document.getElementById('qe').value),
                airmass: parseFloat(document.getElementById('airmass').value),
                object_magnitude: parseFloat(document.getElementById('objectMagnitude').value),
                exposure_time: parseFloat(document.getElementById('exposureTime').value) || 60,
                seeing: parseFloat(document.getElementById('seeing').value),
                aperture_radius: parseFloat(document.getElementById('apertureRadius').value),
                sky_brightness: document.getElementById('skyBrightness').value ? parseFloat(document.getElementById('skyBrightness').value) : null,
                extinction: document.getElementById('extinction').value ? parseFloat(document.getElementById('extinction').value) : null,
                n_exposures: parseInt(document.getElementById('nExposures').value) || 1,
            },
            target_snr: 10,
        };

        try {
            const result = await apiPost('/api/snr/calculate', data);
            displayResults(result);
        } catch (err) {
            alert('Error en el cálculo: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-calculator"></i> Calcular SNR';
        }
    }

    function displayResults(r) {
        if (r.error) {
            document.getElementById('snrValue').textContent = '!';
            document.getElementById('snrLabel').textContent = r.error;
            return;
        }

        // Main SNR value
        document.getElementById('snrValue').textContent = r.snr;
        document.getElementById('snrLabel').textContent = 'SNR';

        // Secondary info
        const secondary = document.getElementById('snrSecondary');
        if (r.snr_single !== r.snr) {
            secondary.style.display = 'block';
            document.getElementById('snrSecondaryText').textContent =
                `SNR por exposición: ${r.snr_single}`;
        } else {
            secondary.style.display = 'none';
        }

        // Detailed results
        document.getElementById('resultsDetails').style.display = 'block';
        document.getElementById('resSignal').textContent = formatNumber(r.signal_electrons);
        document.getElementById('resNoiseSource').textContent = formatNumber(r.noise_source);
        document.getElementById('resNoiseSky').textContent = formatNumber(r.noise_sky);
        document.getElementById('resNoiseDark').textContent = formatNumber(r.noise_dark);
        document.getElementById('resNoiseRead').textContent = formatNumber(r.noise_read);
        document.getElementById('resNoiseTotal').textContent = formatNumber(r.total_noise);
        document.getElementById('resPlateScale').textContent = r.pixel_scale;
        document.getElementById('resNPix').textContent = formatNumber(r.n_pix_aperture);
        document.getElementById('resFAperture').textContent = (r.f_aperture * 100).toFixed(1) + '%';
        document.getElementById('resSourceRate').textContent = formatNumber(r.source_rate);
        document.getElementById('resSkyRate').textContent = formatSci(r.sky_rate_per_pixel);
        document.getElementById('resDarkCurrent').textContent = formatSci(r.dark_current);
        document.getElementById('resArea').textContent = formatNumber(r.collecting_area_cm2);

        // Noise chart
        updateNoiseChart(r);

        // Store rates for the exposure toolkit
        lastRates = {
            source_rate: r.source_rate,
            f_aperture: r.f_aperture,
            sky_rate: r.sky_rate_per_pixel,
            dark_current: r.dark_current,
            n_pix: r.n_pix_aperture,
            readout_noise: parseFloat(document.getElementById('readoutNoise').value),
        };

        // Set toolkit slider to current SNR and show it
        toolkitSNR.value = Math.min(Math.round(r.snr), 500);
        document.getElementById('toolkitSNRValue').textContent = toolkitSNR.value;
        toolkitNExp.value = parseInt(document.getElementById('nExposures').value) || 1;
        document.getElementById('toolkitNExpValue').textContent = toolkitNExp.value;
        document.getElementById('exposureToolkit').style.display = 'block';
        updateToolkit();
    }

    /**
     * Solve for exposure time client-side using the CCD equation quadratic.
     * (sf)²·t² − SNR²·(sf + nd)·t − SNR²·nr = 0
     */
    function solveExposureTime(targetSNR, nExp) {
        if (!lastRates) return null;

        const snr1 = targetSNR / Math.sqrt(nExp);
        const n2 = snr1 * snr1;
        const sf = lastRates.source_rate * lastRates.f_aperture;
        const nd = lastRates.n_pix * (lastRates.sky_rate + lastRates.dark_current);
        const nr = lastRates.n_pix * lastRates.readout_noise * lastRates.readout_noise;

        const a = sf * sf;
        const b = -n2 * (sf + nd);
        const c = -n2 * nr;

        if (a <= 0) return null;

        const disc = b * b - 4 * a * c;
        if (disc < 0) return null;

        const t = (-b + Math.sqrt(disc)) / (2 * a);
        return t > 0 ? t : null;
    }

    function updateToolkit() {
        const targetSNR = parseFloat(toolkitSNR.value);
        const nExp = parseInt(toolkitNExp.value);

        const tExp = solveExposureTime(targetSNR, nExp);

        const expEl = document.getElementById('toolkitExpTime');
        const totalEl = document.getElementById('toolkitTotalTime');

        if (tExp === null) {
            expEl.textContent = 'No alcanzable';
            totalEl.textContent = '—';
            return;
        }

        expEl.textContent = formatTime(tExp);
        totalEl.textContent = formatTime(tExp * nExp);
    }

    function formatTime(seconds) {
        if (seconds < 0.1) return seconds.toFixed(3) + ' s';
        if (seconds < 60) return seconds.toFixed(1) + ' s';
        if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
        return (seconds / 3600).toFixed(2) + ' h';
    }

    function updateNoiseChart(r) {
        const ctx = document.getElementById('noiseChart').getContext('2d');

        const noiseData = [
            { label: 'Fotónico', value: r.noise_source ** 2, color: '#14b8a6' },
            { label: 'Cielo', value: r.noise_sky ** 2, color: '#22d3ee' },
            { label: 'Oscuro', value: r.noise_dark ** 2, color: '#f59e0b' },
            { label: 'Lectura', value: r.noise_read ** 2, color: '#f87171' },
        ];

        const total = noiseData.reduce((s, d) => s + d.value, 0);

        if (noiseChart) {
            noiseChart.destroy();
        }

        noiseChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: noiseData.map(d => d.label),
                datasets: [{
                    data: noiseData.map(d => d.value),
                    backgroundColor: noiseData.map(d => d.color),
                    borderColor: '#0c1824',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#8ba8c0',
                            padding: 16,
                            usePointStyle: true,
                            font: { size: 12 },
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw;
                                const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
                                return ` ${context.label}: ${pct}% (σ² = ${formatNumber(val)})`;
                            }
                        }
                    }
                },
                cutout: '55%',
            }
        });
    }

    function formatNumber(n) {
        if (n === undefined || n === null) return '—';
        if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.01 && n !== 0)) {
            return n.toExponential(2);
        }
        return parseFloat(n.toFixed(2)).toLocaleString('es-ES');
    }

    function formatSci(n) {
        if (n === undefined || n === null) return '—';
        return n.toExponential(3);
    }
});
