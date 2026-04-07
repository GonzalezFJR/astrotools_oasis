/* ============================================
   HistogramPanel — ECharts-based histogram component
   ============================================
   Features:
   - Modes: mono, dual, rgb, dual+rgb
   - Crisp SVG rendering via ECharts
   - dataZoom slider for zmin/zmax (both handles work)
   - Per-channel gain (0–3×) overlaid on the dataZoom bar
   - Log Y toggle, Stats popup, Reset, Pop-out, Expand modal
   - Double-click opens full-screen modal
   - Pop-out with full toolbar, pop-in button, hides sidebar
   - Responsive via ResizeObserver
   - Intensity center markLine per channel
   ============================================ */

class HistogramPanel {
    /**
     * @param {HTMLElement} container
     * @param {Object} opts
     *   mode     : 'mono'|'dual'|'rgb'|'dual+rgb'
     *   height   : chart height per channel (px, default 100)
     *   zmin/zmax: initial range (0–1)
     *   onChange  : (channel, zmin, zmax) => void
     *   labels   : {original, processed}
     *   title    : panel title shown in modal/popout header
     */
    constructor(container, opts = {}) {
        this.container = container;
        this.mode = opts.mode || 'mono';
        this.chartH = opts.height || 100;
        this._onChange = opts.onChange || (() => {});
        this._logY = true;
        this._labels = opts.labels || {};
        this._title = opts.title || 'Histograma';
        this._defaultZmin = opts.zmin !== undefined ? opts.zmin : 0.002;
        this._defaultZmax = opts.zmax !== undefined ? opts.zmax : 0.999;
        this._stats = {};            // per-channel stats {min, max, mean, median, std}
        this._state = {};            // per-channel {counts, zmin, zmax, gain}
        this._charts = {};           // per-channel ECharts instances
        this._chartEls = {};         // per-channel DOM divs
        this._gainSliders = {};      // per-channel gain overlay input elements
        this._gainLabels = {};       // per-channel gain value labels
        this._popoutWin = null;
        this._popoutCharts = {};     // ECharts in pop-out window

        this._build();
        this._ro = new ResizeObserver(() => this._resizeAll());
        this._ro.observe(this.container);
    }

    /* ── Public API ──────────────────────────── */

    setHistogram(channel, counts, stats) {
        if (!this._state[channel]) this._initChannel(channel);
        this._state[channel].counts = counts;
        if (stats) this._stats[channel] = stats;
        this._updateChart(channel);
    }

    getValues(channel = 'L') {
        const s = this._state[channel];
        return s ? { zmin: s.zmin, zmax: s.zmax, gain: s.gain }
                 : { zmin: this._defaultZmin, zmax: this._defaultZmax, gain: 1 };
    }

    setValues(channel, zmin, zmax) {
        if (!this._state[channel]) this._initChannel(channel);
        this._state[channel].zmin = zmin;
        this._state[channel].zmax = zmax;
        this._syncDataZoom(channel);
    }

    setStats(channel, stats) {
        this._stats[channel] = stats;
    }

    setAllHistograms(data) {
        for (const [ch, counts] of Object.entries(data)) this.setHistogram(ch, counts);
    }

    getAllValues() {
        const out = {};
        for (const ch of Object.keys(this._state))
            out[ch] = { zmin: this._state[ch].zmin, zmax: this._state[ch].zmax, gain: this._state[ch].gain };
        return out;
    }

    setLogY(v) {
        this._logY = !!v;
        this._syncToggles();
        for (const ch of Object.keys(this._charts)) this._updateChart(ch);
    }

    setGain(v) {
        const g = Math.max(0, Math.min(3, v));
        for (const ch of Object.keys(this._state)) {
            this._state[ch].gain = g;
            this._syncGainUI(ch);
            this._updateChart(ch);
        }
    }

    reset() {
        for (const ch of Object.keys(this._state)) {
            this._state[ch].zmin = this._defaultZmin;
            this._state[ch].zmax = this._defaultZmax;
            this._state[ch].gain = 1.0;
            this._syncGainUI(ch);
            this._syncDataZoom(ch);
            this._updateChart(ch);
            this._onChange(ch, this._defaultZmin, this._defaultZmax);
        }
        this._logY = true;
        this._syncToggles();
    }

    destroy() {
        this._ro.disconnect();
        for (const ch of Object.keys(this._charts)) this._charts[ch].dispose();
        this.container.innerHTML = '';
        this._state = {}; this._charts = {}; this._chartEls = {};
        this._gainSliders = {}; this._gainLabels = {};
        if (this._popoutWin && !this._popoutWin.closed) this._popoutWin.close();
    }

    /* ── DOM build ───────────────────────────── */

    _build() {
        this.container.innerHTML = '';
        this.container.classList.add('hpanel');

        /* toolbar */
        const tb = document.createElement('div');
        tb.className = 'hpanel-toolbar';

        this._btnLogY = this._mkBtn('bi-graph-up', 'Log Y', true, () => {
            this._logY = !this._logY;
            this._syncToggles();
            for (const ch of Object.keys(this._charts)) this._updateChart(ch);
        });
        this._btnStats = this._mkBtn('bi-info-circle', 'Estadísticas', false, () => this._showStats());
        this._btnReset = this._mkBtn('bi-arrow-counterclockwise', 'Reset', false, () => this.reset());
        this._btnExpand = this._mkBtn('bi-arrows-fullscreen', 'Ampliar', false, () => this._openModal());
        this._btnPopout = this._mkBtn('bi-box-arrow-up-right', 'Ventana', false, () => this._openPopout());

        tb.append(this._btnLogY, this._btnStats, this._btnReset, this._btnExpand, this._btnPopout);
        this.container.appendChild(tb);

        /* channels (gain slider is per-channel, overlaid on dataZoom) */
        const channels = this._getChannelKeys();
        for (const ch of channels) { this._initChannel(ch); this._buildChannelUI(ch); }
    }

    _getChannelKeys() {
        switch (this.mode) {
            case 'mono':     return ['L'];
            case 'dual':     return ['L', 'L_proc'];
            case 'rgb':      return ['R', 'G', 'B'];
            case 'dual+rgb': return ['L', 'L_proc', 'R', 'G', 'B'];
            default:         return ['L'];
        }
    }

    _initChannel(ch) {
        if (this._state[ch]) return;
        this._state[ch] = { counts: null, zmin: this._defaultZmin, zmax: this._defaultZmax, gain: 1.0 };
    }

    _chLabel(ch) {
        return { L: this._labels.original || 'Luminancia', L_proc: this._labels.processed || 'Procesado',
                 R: 'R', G: 'G', B: 'B' }[ch] || ch;
    }

    _chColor(ch) {
        return { L: '#a5b4fc', L_proc: '#6ee7b7', R: '#ef4444', G: '#22c55e', B: '#3b82f6' }[ch] || '#a5b4fc';
    }

    _buildChannelUI(ch) {
        const wrap = document.createElement('div');
        wrap.className = 'hpanel-channel';

        /* chart */
        const el = document.createElement('div');
        el.style.width = '100%'; el.style.height = this.chartH + 'px';
        wrap.appendChild(el);

        /* gain overlay row: sits on top of dataZoom bar */
        const gainRow = document.createElement('div');
        gainRow.className = 'hpanel-gain-overlay';
        const gainSlider = document.createElement('input');
        gainSlider.type = 'range';
        gainSlider.className = 'hpanel-gain-input';
        gainSlider.min = '0'; gainSlider.max = '3'; gainSlider.step = '0.05'; gainSlider.value = '1';
        gainSlider.title = 'Gain';
        const gainVal = document.createElement('span');
        gainVal.className = 'hpanel-gain-tag';
        gainVal.textContent = '1×';
        gainSlider.addEventListener('input', () => {
            const g = parseFloat(gainSlider.value);
            this._state[ch].gain = g;
            gainVal.textContent = g.toFixed(g < 1 ? 2 : (g >= 2 ? 1 : 2)) + '×';
            gainVal.classList.toggle('hpanel-gain-tag--active', g !== 1);
            this._updateChart(ch);
        });
        gainRow.append(gainSlider, gainVal);
        wrap.appendChild(gainRow);

        this.container.appendChild(wrap);
        this._chartEls[ch] = el;
        this._gainSliders[ch] = gainSlider;
        this._gainLabels[ch] = gainVal;

        const chart = echarts.init(el, null, { renderer: 'svg' });
        this._charts[ch] = chart;
        chart.on('datazoom', (p) => this._onZoom(ch, p));

        /* double-click → modal */
        el.addEventListener('dblclick', () => this._openModal());

        this._updateChart(ch);
    }

    _syncGainUI(ch) {
        if (this._gainSliders[ch]) this._gainSliders[ch].value = this._state[ch].gain;
        if (this._gainLabels[ch]) {
            const g = this._state[ch].gain;
            this._gainLabels[ch].textContent = g.toFixed(g < 1 ? 2 : (g >= 2 ? 1 : 2)) + '×';
            this._gainLabels[ch].classList.toggle('hpanel-gain-tag--active', g !== 1);
        }
    }

    /* ── Chart rendering ─────────────────────── */

    _updateChart(ch) {
        const chart = this._charts[ch];
        if (!chart) return;
        const s = this._state[ch];
        const color = this._chColor(ch);
        const label = this._chLabel(ch);
        const raw = (s.counts || []).map(c => Number.isFinite(c) ? c : 0);
        const gain = s.gain;

        const yData = raw.map(c => {
            const v = c * gain;
            return this._logY ? (v > 0 ? Math.log10(v) : 0) : v;
        });

        /* intensity center */
        let tw = 0, sw = 0;
        for (let i = 0; i < raw.length; i++) { tw += raw[i]; sw += raw[i] * i; }
        const meanBin = tw > 0 ? Math.round(sw / tw) : -1;

        chart.setOption({
            animation: false,
            grid: { left: 0, right: 0, top: 14, bottom: 22, containLabel: false },
            title: {
                text: label, left: 4, top: 0,
                textStyle: { color, fontSize: 10, fontWeight: 600 },
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(10,10,18,0.92)',
                borderColor: 'rgba(255,255,255,0.08)',
                textStyle: { color: '#ccc', fontSize: 10 },
                formatter: (p) => {
                    const d = p[0]; if (!d) return '';
                    const bin = d.dataIndex, v = raw[bin] || 0;
                    return `Bin ${bin} (${((bin / (raw.length || 1)) * 100).toFixed(1)}%)<br/>Count: ${v.toLocaleString()}`;
                },
            },
            xAxis: {
                type: 'category', data: yData.map((_, i) => i), show: false,
                axisPointer: { show: true, lineStyle: { color: 'rgba(255,255,255,0.25)' } },
            },
            yAxis: { type: 'value', show: false },
            dataZoom: [{
                type: 'slider', xAxisIndex: 0,
                start: s.zmin * 100, end: s.zmax * 100,
                height: 14, bottom: 0,
                borderColor: 'rgba(255,255,255,0.15)',
                backgroundColor: 'rgba(10,10,18,0.6)',
                fillerColor: 'rgba(99,102,241,0.12)',
                handleSize: '110%',
                handleStyle: { color, borderColor: color, borderWidth: 1 },
                moveHandleSize: 4,
                moveHandleStyle: { color: 'rgba(255,255,255,0.18)' },
                emphasis: { handleStyle: { color, borderColor: '#fff' }, moveHandleStyle: { color: 'rgba(255,255,255,0.3)' } },
                textStyle: { color: '#999', fontSize: 9 },
                dataBackground: { lineStyle: { color: 'transparent' }, areaStyle: { color: 'transparent' } },
                selectedDataBackground: { lineStyle: { color: 'transparent' }, areaStyle: { color: 'transparent' } },
                labelFormatter: (v) => (v / (raw.length || 1)).toFixed(2),
                brushSelect: false,
                zoomLock: false,
            }],
            series: [{
                type: 'bar', data: yData, barWidth: '100%', barCategoryGap: 0,
                itemStyle: { color, opacity: 0.7 },
                emphasis: { itemStyle: { opacity: 1 } },
                markLine: meanBin >= 0 ? {
                    silent: true, symbol: ['none', 'none'], label: { show: false },
                    data: [{ xAxis: meanBin }],
                    lineStyle: { color: '#fbbf24', type: 'solid', width: 2, opacity: 0.8 },
                } : undefined,
            }],
        }, true);

        /* sync pop-out if open */
        this._syncPopoutChart(ch);
    }

    _syncDataZoom(ch) {
        const chart = this._charts[ch]; if (!chart) return;
        const s = this._state[ch];
        chart.dispatchAction({ type: 'dataZoom', start: s.zmin * 100, end: s.zmax * 100 });
    }

    _onZoom(ch, params) {
        const s = this._state[ch];
        let start, end;
        if (params.start !== undefined) { start = params.start; end = params.end; }
        else if (params.batch && params.batch.length) { start = params.batch[0].start; end = params.batch[0].end; }
        else return;
        s.zmin = Math.max(0, start / 100);
        s.zmax = Math.min(1, end / 100);
        this._onChange(ch, s.zmin, s.zmax);
    }

    /* ── Resize ──────────────────────────────── */

    _resizeAll() {
        for (const ch of Object.keys(this._charts)) this._charts[ch].resize();
    }

    /* ── Toolbar buttons ─────────────────────── */

    _mkBtn(icon, tip, initialActive, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hpanel-tbtn' + (initialActive ? ' active' : '');
        btn.title = tip;
        btn.innerHTML = `<i class="bi ${icon}"></i>`;
        btn.addEventListener('click', onClick);
        return btn;
    }

    _syncToggles() {
        if (this._btnLogY) this._btnLogY.classList.toggle('active', this._logY);
    }

    /* ── Stats popup ─────────────────────────── */

    _showStats() {
        /* toggle off */
        if (this._statsPopup && this._statsPopup.parentNode) {
            this._statsPopup.remove(); this._statsPopup = null; return;
        }
        const popup = document.createElement('div');
        popup.className = 'hpanel-stats-popup';

        const channels = Object.keys(this._state);
        let html = '<table class="hpanel-stats-table"><thead><tr><th></th><th>Min</th><th>Max</th><th>Media</th><th>Med</th><th>σ</th></tr></thead><tbody>';
        for (const ch of channels) {
            const st = this._stats[ch] || {};
            const fmt = (v) => v !== undefined ? Number(v).toFixed(2) : '—';
            const raw = (this._state[ch].counts || []).filter(Number.isFinite);
            const total = raw.reduce((a, b) => a + b, 0);
            /* compute from counts if backend stats absent */
            const cMin = st.data_min !== undefined ? st.data_min : (raw.length ? Math.min(...raw) : 0);
            const cMax = st.data_max !== undefined ? st.data_max : (raw.length ? Math.max(...raw) : 0);
            const cMean = st.data_mean !== undefined ? st.data_mean : (total / (raw.length || 1));
            const cStd = st.data_std !== undefined ? st.data_std : 0;
            const cMed = st.data_median !== undefined ? st.data_median : cMean;
            html += `<tr><td style="color:${this._chColor(ch)};font-weight:700">${this._chLabel(ch)}</td>
                     <td>${fmt(cMin)}</td><td>${fmt(cMax)}</td><td>${fmt(cMean)}</td><td>${fmt(cMed)}</td><td>${fmt(cStd)}</td></tr>`;
        }
        html += '</tbody></table>';
        popup.innerHTML = html;
        this.container.appendChild(popup);
        this._statsPopup = popup;

        /* close on outside click */
        const close = (e) => { if (!popup.contains(e.target) && e.target !== this._btnStats) { popup.remove(); this._statsPopup = null; document.removeEventListener('mousedown', close); } };
        setTimeout(() => document.addEventListener('mousedown', close), 0);
    }

    /* ── Modal (full-screen overlay) ─────────── */

    _openModal() {
        if (document.getElementById('hpanel-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'hpanel-modal';
        overlay.className = 'hpanel-modal-overlay';

        const box = document.createElement('div');
        box.className = 'hpanel-modal-box';

        /* header */
        const hdr = document.createElement('div');
        hdr.className = 'hpanel-modal-header';
        hdr.innerHTML = `<span>${this._title}</span>`;
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'hpanel-modal-close';
        closeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        closeBtn.addEventListener('click', () => overlay.remove());
        hdr.appendChild(closeBtn);
        box.appendChild(hdr);

        /* body: one big chart per channel */
        const body = document.createElement('div');
        body.className = 'hpanel-modal-body';

        const modalCharts = [];
        const channels = this._getChannelKeys();
        for (const ch of channels) {
            const s = this._state[ch]; if (!s) continue;
            const el = document.createElement('div');
            el.style.width = '100%'; el.style.height = '180px'; el.style.marginBottom = '12px';
            body.appendChild(el);
            const mc = echarts.init(el, null, { renderer: 'svg' });
            modalCharts.push(mc);
            /* build same option at larger size */
            const raw = (s.counts || []).map(c => Number.isFinite(c) ? c : 0);
            const gain = s.gain;
            const yData = raw.map(c => { const v = c * gain; return this._logY ? (v > 0 ? Math.log10(v) : 0) : v; });
            const color = this._chColor(ch);
            let tw = 0, sw = 0;
            for (let i = 0; i < raw.length; i++) { tw += raw[i]; sw += raw[i] * i; }
            const meanBin = tw > 0 ? Math.round(sw / tw) : -1;
            mc.setOption({
                animation: false,
                grid: { left: 40, right: 16, top: 28, bottom: 40, containLabel: false },
                title: { text: this._chLabel(ch), left: 4, top: 0, textStyle: { color, fontSize: 13, fontWeight: 700 } },
                tooltip: {
                    trigger: 'axis', backgroundColor: 'rgba(10,10,18,0.92)', borderColor: 'rgba(255,255,255,0.08)',
                    textStyle: { color: '#ccc', fontSize: 11 },
                    formatter: (p) => { const d = p[0]; if (!d) return ''; return `Bin ${d.dataIndex}<br/>Count: ${(raw[d.dataIndex] || 0).toLocaleString()}`; },
                },
                xAxis: { type: 'category', data: yData.map((_, i) => i), axisLabel: { show: true, color: '#666', fontSize: 9, formatter: (v) => ((v / (raw.length || 1)) * 100).toFixed(0) + '%' }, splitLine: { show: false }, axisTick: { show: false } },
                yAxis: { type: 'value', axisLabel: { show: true, color: '#555', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
                dataZoom: [{ type: 'slider', start: s.zmin * 100, end: s.zmax * 100, height: 18, bottom: 4, handleSize: '110%', handleStyle: { color, borderColor: color }, fillerColor: 'rgba(99,102,241,0.12)', labelFormatter: (v) => (v / (raw.length || 1)).toFixed(3), brushSelect: false, zoomLock: false }],
                series: [{
                    type: 'bar', data: yData, barWidth: '100%', barCategoryGap: 0,
                    itemStyle: { color, opacity: 0.7 }, emphasis: { itemStyle: { opacity: 1 } },
                    markLine: meanBin >= 0 ? { silent: true, symbol: ['none', 'none'], label: { show: false }, data: [{ xAxis: meanBin }], lineStyle: { color: '#fbbf24', width: 2, opacity: 0.8 } } : undefined,
                }],
            }, true);
        }

        box.appendChild(body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } });
        requestAnimationFrame(() => modalCharts.forEach(c => c.resize()));
    }

    /* ── Pop-out window ──────────────────────── */

    _openPopout() {
        if (this._popoutWin && !this._popoutWin.closed) { this._popoutWin.focus(); return; }
        const w = 700, h = 500;
        const win = window.open('', '_blank', `width=${w},height=${h},resizable=yes,scrollbars=yes`);
        if (!win) return;
        this._popoutWin = win;
        this._popoutCharts = {};

        /* hide sidebar container */
        this.container.style.display = 'none';

        const channels = this._getChannelKeys();
        let chartHtml = '';
        channels.forEach(ch => {
            chartHtml += `<div class="po-channel">
                <div id="ch-${ch}" style="width:100%;height:${Math.max(160, Math.floor((h - 80) / channels.length))}px;"></div>
                <div class="po-gain-row">
                    <input type="range" class="po-gain-input" id="gain-${ch}" min="0" max="3" step="0.05" value="${this._state[ch]?.gain || 1}">
                    <span class="po-gain-tag" id="gaintag-${ch}">${(this._state[ch]?.gain || 1).toFixed(1)}×</span>
                </div>
            </div>`;
        });

        const biCss = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.2/font/bootstrap-icons.min.css';
        win.document.write(`<!DOCTYPE html><html><head><title>${this._title}</title>
        <link rel="stylesheet" href="${biCss}">
        <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"><\/script>
        <style>
            body{margin:0;padding:0;background:#0a0a12;color:#ccc;font-family:system-ui;display:flex;flex-direction:column;height:100vh;}
            .po-toolbar{display:flex;gap:4px;padding:6px 10px;background:rgba(10,10,18,0.9);border-bottom:1px solid rgba(255,255,255,0.08);align-items:center;}
            .po-toolbar .po-title{font-size:13px;font-weight:700;color:#a5b4fc;margin-right:auto;}
            .po-tbtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#999;cursor:pointer;font-size:0;padding:0;transition:background .15s,color .15s;}
            .po-tbtn i{font-size:0.75rem;}
            .po-tbtn.active{background:#6366f1;color:#fff;border-color:#6366f1;}
            .po-tbtn:hover{opacity:0.85;}
            .po-body{flex:1;overflow-y:auto;padding:8px 10px;}
            .po-channel{margin-bottom:6px;position:relative;}
            .po-gain-row{display:flex;align-items:center;gap:4px;height:16px;margin-top:-2px;padding:0 2px;}
            .po-gain-input{flex:1;-webkit-appearance:none;appearance:none;height:3px;border-radius:1px;background:rgba(255,255,255,0.10);outline:none;cursor:pointer;}
            .po-gain-input::-webkit-slider-thumb{-webkit-appearance:none;width:3px;height:14px;border-radius:1px;background:#6366f1;cursor:pointer;border:none;}
            .po-gain-input::-moz-range-thumb{width:3px;height:14px;border-radius:1px;background:#6366f1;cursor:pointer;border:none;}
            .po-gain-tag{font-size:0.55rem;color:#666;min-width:22px;text-align:right;}
        </style>
        </head><body>
        <div class="po-toolbar">
            <span class="po-title">${this._title}</span>
            <button class="po-tbtn" id="poLogY" title="Log Y"><i class="bi bi-graph-up"></i></button>
            <button class="po-tbtn" id="poStats" title="Estadísticas"><i class="bi bi-info-circle"></i></button>
            <button class="po-tbtn" id="poReset" title="Reset"><i class="bi bi-arrow-counterclockwise"></i></button>
            <button class="po-tbtn" id="poExpand" title="Ampliar"><i class="bi bi-arrows-fullscreen"></i></button>
            <button class="po-tbtn" id="poPopin" title="Volver a la barra lateral"><i class="bi bi-box-arrow-in-down-left"></i></button>
        </div>
        <div class="po-body">${chartHtml}</div>
        </body></html>`);
        win.document.close();

        win.addEventListener('load', () => {
            /* toolbar wiring */
            const poLogY = win.document.getElementById('poLogY');
            if (poLogY) {
                poLogY.classList.toggle('active', this._logY);
                poLogY.addEventListener('click', () => {
                    this._logY = !this._logY;
                    poLogY.classList.toggle('active', this._logY);
                    this._syncToggles();
                    for (const c of Object.keys(this._charts)) this._updateChart(c);
                });
            }
            const poStats = win.document.getElementById('poStats');
            if (poStats) poStats.addEventListener('click', () => this._showStats());
            const poReset = win.document.getElementById('poReset');
            if (poReset) poReset.addEventListener('click', () => this.reset());
            const poExpand = win.document.getElementById('poExpand');
            if (poExpand) poExpand.addEventListener('click', () => this._openModal());
            const poPopin = win.document.getElementById('poPopin');
            if (poPopin) poPopin.addEventListener('click', () => this._closePopout());

            /* charts */
            for (const ch of channels) {
                const s = this._state[ch]; if (!s) continue;
                const el = win.document.getElementById('ch-' + ch);
                if (!el) continue;
                const mc = echarts.init(el, null, { renderer: 'svg' });
                this._popoutCharts[ch] = mc;

                /* datazoom events in popout sync back to main state */
                mc.on('datazoom', (p) => {
                    let start, end;
                    if (p.start !== undefined) { start = p.start; end = p.end; }
                    else if (p.batch && p.batch.length) { start = p.batch[0].start; end = p.batch[0].end; }
                    else return;
                    s.zmin = Math.max(0, start / 100);
                    s.zmax = Math.min(1, end / 100);
                    /* sync sidebar chart */
                    this._syncDataZoom(ch);
                    this._onChange(ch, s.zmin, s.zmax);
                });

                this._renderPopoutChart(ch);
                win.addEventListener('resize', () => mc.resize());

                /* gain slider in popout */
                const gs = win.document.getElementById('gain-' + ch);
                const gt = win.document.getElementById('gaintag-' + ch);
                if (gs) {
                    gs.addEventListener('input', () => {
                        const g = parseFloat(gs.value);
                        this._state[ch].gain = g;
                        if (gt) gt.textContent = g.toFixed(g < 1 ? 2 : (g >= 2 ? 1 : 2)) + '×';
                        this._syncGainUI(ch);
                        this._updateChart(ch);
                    });
                }
            }
        });

        /* on window close → restore sidebar */
        const checkClosed = setInterval(() => {
            if (!win || win.closed) {
                clearInterval(checkClosed);
                this.container.style.display = '';
                this._popoutWin = null;
                this._popoutCharts = {};
                /* refresh sidebar charts */
                requestAnimationFrame(() => this._resizeAll());
            }
        }, 400);
    }

    _closePopout() {
        if (this._popoutWin && !this._popoutWin.closed) this._popoutWin.close();
        this.container.style.display = '';
        this._popoutWin = null;
        this._popoutCharts = {};
        requestAnimationFrame(() => this._resizeAll());
    }

    _renderPopoutChart(ch) {
        const mc = this._popoutCharts[ch]; if (!mc) return;
        const s = this._state[ch]; if (!s) return;
        const raw = (s.counts || []).map(c => Number.isFinite(c) ? c : 0);
        const gain = s.gain;
        const yData = raw.map(c => { const v = c * gain; return this._logY ? (v > 0 ? Math.log10(v) : 0) : v; });
        const color = this._chColor(ch);
        let tw = 0, sw = 0;
        for (let i = 0; i < raw.length; i++) { tw += raw[i]; sw += raw[i] * i; }
        const meanBin = tw > 0 ? Math.round(sw / tw) : -1;
        mc.setOption({
            animation: false,
            grid: { left: 40, right: 16, top: 28, bottom: 36 },
            title: { text: this._chLabel(ch), left: 4, top: 0, textStyle: { color, fontSize: 13, fontWeight: 700 } },
            tooltip: { trigger: 'axis', textStyle: { color: '#ccc', fontSize: 11 }, backgroundColor: 'rgba(10,10,18,0.92)' },
            xAxis: { type: 'category', data: yData.map((_, i) => i), axisLabel: { color: '#666', fontSize: 9, formatter: (v) => ((v / (raw.length || 1)) * 100).toFixed(0) + '%' }, splitLine: { show: false } },
            yAxis: { type: 'value', axisLabel: { color: '#555', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
            dataZoom: [{ type: 'slider', start: s.zmin * 100, end: s.zmax * 100, height: 18, bottom: 2, handleStyle: { color }, fillerColor: 'rgba(99,102,241,0.12)', brushSelect: false, zoomLock: false }],
            series: [{ type: 'bar', data: yData, barWidth: '100%', barCategoryGap: 0, itemStyle: { color, opacity: 0.7 },
                markLine: meanBin >= 0 ? { silent: true, symbol: ['none', 'none'], label: { show: false }, data: [{ xAxis: meanBin }], lineStyle: { color: '#fbbf24', width: 2, opacity: 0.8 } } : undefined }],
        }, true);
    }

    _syncPopoutChart(ch) {
        if (!this._popoutWin || this._popoutWin.closed) return;
        this._renderPopoutChart(ch);
        /* sync gain slider in popout */
        const gs = this._popoutWin.document.getElementById('gain-' + ch);
        const gt = this._popoutWin.document.getElementById('gaintag-' + ch);
        if (gs) gs.value = this._state[ch].gain;
        if (gt) {
            const g = this._state[ch].gain;
            gt.textContent = g.toFixed(g < 1 ? 2 : (g >= 2 ? 1 : 2)) + '×';
        }
    }
}

window.HistogramPanel = HistogramPanel;
