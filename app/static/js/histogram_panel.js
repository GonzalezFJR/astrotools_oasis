/* ============================================
   HistogramPanel — Modular histogram component
   Features:
   - Dual histograms (original + processed)
   - RGB channel histograms (separate R/G/B)
   - Log/linear scale toggles for both axes
   - zmin / zmax draggable sliders per histogram
   ============================================ */

class HistogramPanel {
    /**
     * @param {HTMLElement} container — DOM element to render into
     * @param {Object} opts
     *   mode      : 'mono' | 'dual' | 'rgb' | 'dual+rgb'
     *   height    : canvas height in px (default 90)
     *   zmin      : initial zmin (0–1, default 0.002)
     *   zmax      : initial zmax (0–1, default 0.999)
     *   onChange  : (channel, zmin, zmax) => void
     *   labels    : {original, processed} custom titles
     */
    constructor(container, opts = {}) {
        this.container = container;
        this.mode = opts.mode || 'mono';
        this.canvasH = opts.height || 90;
        this._onChange = opts.onChange || (() => {});
        this._logX = false;
        this._logY = true; // default Y-axis to log
        this._labels = opts.labels || {};

        // State per sub-histogram: {counts, zmin, zmax}
        this._state = {};
        this._defaultZmin = opts.zmin !== undefined ? opts.zmin : 0.002;
        this._defaultZmax = opts.zmax !== undefined ? opts.zmax : 0.999;

        this._canvases = {};
        this._contexts = {};
        this._dragging = {}; // channelKey -> 'min'|'max'|null

        this._build();
    }

    // ── public API ────────────────────────────────

    /** Set histogram counts for a channel. channel = 'L' | 'R' | 'G' | 'B' | 'L_proc' */
    setHistogram(channel, counts) {
        if (!this._state[channel]) this._initChannel(channel);
        this._state[channel].counts = counts;
        this._drawChannel(channel);
    }

    /** Get {zmin, zmax} for a channel */
    getValues(channel = 'L') {
        const s = this._state[channel];
        return s ? { zmin: s.zmin, zmax: s.zmax } : { zmin: this._defaultZmin, zmax: this._defaultZmax };
    }

    /** Set zmin/zmax for a channel */
    setValues(channel, zmin, zmax) {
        if (!this._state[channel]) this._initChannel(channel);
        this._state[channel].zmin = zmin;
        this._state[channel].zmax = zmax;
        this._drawChannel(channel);
    }

    /** Batch-set all histogram data: {L: [...], R: [...], G: [...], B: [...], L_proc: [...]} */
    setAllHistograms(data) {
        for (const [ch, counts] of Object.entries(data)) {
            this.setHistogram(ch, counts);
        }
    }

    /** Get all zmin/zmax values */
    getAllValues() {
        const out = {};
        for (const ch of Object.keys(this._state)) {
            out[ch] = { zmin: this._state[ch].zmin, zmax: this._state[ch].zmax };
        }
        return out;
    }

    /** Toggle log scale for an axis */
    setLogX(v) { this._logX = !!v; this._redrawAll(); this._updateToggleUI(); }
    setLogY(v) { this._logY = !!v; this._redrawAll(); this._updateToggleUI(); }

    // ── build DOM ─────────────────────────────────

    _build() {
        this.container.innerHTML = '';
        this.container.classList.add('hpanel');

        // Toolbar: log toggles
        const toolbar = document.createElement('div');
        toolbar.className = 'hpanel-toolbar';

        this._btnLogX = this._makeToggle('LogX', this._logX, (v) => this.setLogX(v));
        this._btnLogY = this._makeToggle('LogY', this._logY, (v) => this.setLogY(v));
        toolbar.append(this._btnLogX, this._btnLogY);
        this.container.appendChild(toolbar);

        // Build sub-panels per mode
        const channels = this._getChannelKeys();
        for (const ch of channels) {
            this._initChannel(ch);
            this._buildChannelUI(ch);
        }
    }

    _getChannelKeys() {
        switch (this.mode) {
            case 'mono': return ['L'];
            case 'dual': return ['L', 'L_proc'];
            case 'rgb': return ['R', 'G', 'B'];
            case 'dual+rgb': return ['L', 'L_proc', 'R', 'G', 'B'];
            default: return ['L'];
        }
    }

    _initChannel(ch) {
        if (this._state[ch]) return;
        this._state[ch] = {
            counts: null,
            zmin: this._defaultZmin,
            zmax: this._defaultZmax,
        };
    }

    _channelLabel(ch) {
        const map = {
            'L': this._labels.original || 'Original',
            'L_proc': this._labels.processed || 'Procesado',
            'R': 'Rojo (R)', 'G': 'Verde (G)', 'B': 'Azul (B)',
        };
        return map[ch] || ch;
    }

    _channelColor(ch) {
        return {
            'L': 'rgba(200,200,255,0.7)',
            'L_proc': 'rgba(120,255,160,0.7)',
            'R': 'rgba(239,68,68,0.7)',
            'G': 'rgba(34,197,94,0.7)',
            'B': 'rgba(59,130,246,0.7)',
        }[ch] || 'rgba(200,200,255,0.7)';
    }

    _channelStroke(ch) {
        return {
            'L': 'rgba(200,200,255,0.9)',
            'L_proc': 'rgba(120,255,160,0.9)',
            'R': 'rgba(239,68,68,0.95)',
            'G': 'rgba(34,197,94,0.95)',
            'B': 'rgba(59,130,246,0.95)',
        }[ch] || 'rgba(200,200,255,0.9)';
    }

    _buildChannelUI(ch) {
        const wrap = document.createElement('div');
        wrap.className = 'hpanel-channel';
        wrap.dataset.channel = ch;

        // Label
        const lbl = document.createElement('div');
        lbl.className = 'hpanel-label';
        lbl.textContent = this._channelLabel(ch);
        wrap.appendChild(lbl);

        // Canvas
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = this.canvasH;
        canvas.className = 'hpanel-canvas';
        wrap.appendChild(canvas);
        this._canvases[ch] = canvas;
        this._contexts[ch] = canvas.getContext('2d');

        // zmin/zmax display
        const vals = document.createElement('div');
        vals.className = 'hpanel-values';
        vals.innerHTML = `<small>z<sub>min</sub>: <span class="hpanel-zmin">0.00</span></small>
                          <small>z<sub>max</sub>: <span class="hpanel-zmax">1.00</span></small>`;
        wrap.appendChild(vals);
        this._dragging[ch] = null;

        // Events
        this._bindDrag(canvas, ch, wrap);

        this.container.appendChild(wrap);
        this._drawChannel(ch);
    }

    // ── drag handles ──────────────────────────────

    _bindDrag(canvas, ch, wrap) {
        const getX = (e) => {
            const rect = canvas.getBoundingClientRect();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            return Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
        };
        const T = 0.025;
        const startDrag = (e) => {
            const x = getX(e);
            const s = this._state[ch];
            const dMin = Math.abs(x - s.zmin);
            const dMax = Math.abs(x - s.zmax);
            if (dMin <= T && dMin <= dMax) this._dragging[ch] = 'min';
            else if (dMax <= T) this._dragging[ch] = 'max';
            else if (x < (s.zmin + s.zmax) / 2) this._dragging[ch] = 'min';
            else this._dragging[ch] = 'max';
            this._move(ch, x, wrap);
        };
        const moveDrag = (e) => {
            if (!this._dragging[ch]) return;
            e.preventDefault();
            this._move(ch, getX(e), wrap);
        };
        const endDrag = () => { this._dragging[ch] = null; };

        canvas.addEventListener('mousedown', startDrag);
        canvas.addEventListener('touchstart', startDrag, { passive: true });
        document.addEventListener('mousemove', moveDrag);
        document.addEventListener('touchmove', moveDrag, { passive: false });
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);
    }

    _move(ch, x, wrap) {
        const s = this._state[ch];
        if (this._dragging[ch] === 'min') {
            s.zmin = Math.max(0, Math.min(x, s.zmax - 0.005));
        } else {
            s.zmax = Math.min(1, Math.max(x, s.zmin + 0.005));
        }
        this._drawChannel(ch);
        // Update value display
        const zminEl = wrap.querySelector('.hpanel-zmin');
        const zmaxEl = wrap.querySelector('.hpanel-zmax');
        if (zminEl) zminEl.textContent = s.zmin.toFixed(3);
        if (zmaxEl) zmaxEl.textContent = s.zmax.toFixed(3);
        this._onChange(ch, s.zmin, s.zmax);
    }

    // ── drawing ───────────────────────────────────

    _drawChannel(ch) {
        const canvas = this._canvases[ch];
        const ctx = this._contexts[ch];
        if (!canvas || !ctx) return;
        const s = this._state[ch];
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, W, H);

        if (s.counts && s.counts.length) {
            const counts = s.counts;
            const N = counts.length;

            // Possibly transform X (bin indices) & Y (counts)
            let ys = new Float64Array(N);
            for (let i = 0; i < N; i++) {
                ys[i] = this._logY && counts[i] > 0 ? Math.log10(counts[i]) : counts[i];
            }
            // Normalise Y — skip first & last bin (often spikes)
            let maxY = 0;
            for (let i = 1; i < N - 1; i++) maxY = Math.max(maxY, ys[i]);
            if (maxY === 0) maxY = 1;

            const fillColor = this._channelColor(ch);
            const strokeColor = this._channelStroke(ch);

            // X positions: optionally log-spaced
            const xs = new Float64Array(N);
            if (this._logX) {
                // Map [0..N-1] to log scale; shift by 1 to avoid log(0)
                const logMax = Math.log10(N);
                for (let i = 0; i < N; i++) {
                    xs[i] = (Math.log10(i + 1) / logMax) * W;
                }
            } else {
                const barW = W / N;
                for (let i = 0; i < N; i++) xs[i] = i * barW;
            }

            // Draw filled bars
            ctx.fillStyle = fillColor;
            for (let i = 0; i < N; i++) {
                const barH = (ys[i] / maxY) * (H - 4);
                const nextX = i < N - 1 ? xs[i + 1] : W;
                const bw = nextX - xs[i];
                ctx.fillRect(xs[i], H - barH, bw + 0.5, barH);
            }

            // Stroke outline
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                const barH = (ys[i] / maxY) * (H - 4);
                const nextX = i < N - 1 ? xs[i + 1] : W;
                const x = xs[i] + (nextX - xs[i]) / 2;
                if (i === 0) ctx.moveTo(x, H - barH); else ctx.lineTo(x, H - barH);
            }
            ctx.stroke();
        }

        // Dim outside zmin–zmax
        const xMin = s.zmin * W;
        const xMax = s.zmax * W;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, 0, xMin, H);
        ctx.fillRect(xMax, 0, W - xMax, H);

        // Handle lines
        this._drawHandle(ctx, canvas, xMin, '#38bdf8');
        this._drawHandle(ctx, canvas, xMax, '#fb923c');
    }

    _drawHandle(ctx, canvas, x, color) {
        const H = canvas.height;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 6, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x, 9);
        ctx.closePath();
        ctx.fill();
    }

    _redrawAll() {
        for (const ch of Object.keys(this._canvases)) this._drawChannel(ch);
    }

    // ── toggle buttons ────────────────────────────

    _makeToggle(label, initial, onToggle) {
        const btn = document.createElement('button');
        btn.className = 'hpanel-toggle' + (initial ? ' active' : '');
        btn.textContent = label;
        btn.type = 'button';
        btn.addEventListener('click', () => {
            const next = !btn.classList.contains('active');
            btn.classList.toggle('active', next);
            onToggle(next);
        });
        return btn;
    }

    _updateToggleUI() {
        if (this._btnLogX) this._btnLogX.classList.toggle('active', this._logX);
        if (this._btnLogY) this._btnLogY.classList.toggle('active', this._logY);
    }

    /** Destroy and empty the container */
    destroy() {
        this.container.innerHTML = '';
        this._state = {};
        this._canvases = {};
        this._contexts = {};
    }
}

// Export for global use
window.HistogramPanel = HistogramPanel;
