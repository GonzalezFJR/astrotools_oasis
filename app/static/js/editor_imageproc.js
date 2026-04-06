/* ============================================
   ASTROEDITOR — Client-side Image Processing
   Canvas-based, non-destructive editing pipeline
   ============================================ */

'use strict';

class AstroImageProcessor {
    /**
     * @param {HTMLCanvasElement} canvas  — main display canvas
     * @param {HTMLCanvasElement} histoCanvas — histogram canvas
     */
    constructor(canvas, histoCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.histoCanvas = histoCanvas;
        this.histoCtx = histoCanvas ? histoCanvas.getContext('2d') : null;

        this._srcImage = null;   // HTMLImageElement (original)
        this._srcCanvas = null;  // offscreen canvas at source resolution
        this._srcData = null;    // ImageData of source

        // Non-destructive edit stack — all values are defaults (no-op)
        this.edits = this._defaultEdits();

        this._rendering = false;
        this._pendingRender = false;
        this._onChangeCallbacks = [];
    }

    _defaultEdits() {
        return {
            brightness: 0,       // -100..100
            contrast: 0,         // -100..100
            exposure: 0,         // -3..3 stops
            gamma: 1.0,          // 0.1..5
            saturation: 0,       // -100..100
            highlights: 0,       // -100..100
            shadows: 0,          // -100..100
            stretch: 'none',     // none|linear|asinh|log|sqrt|midtone|histeq
            stretchBP: 0.2,      // black point percentile
            stretchWP: 99.9,     // white point percentile
            stretchBeta: 10,     // asinh beta
            stretchMid: 0.25,    // midtone balance
            stretchScale: 1000,  // log scale
            sharpen: 0,          // 0..100
            denoise: 0,          // 0..100
            rotation: 0,         // degrees
            flipH: false,
            flipV: false,
            crop: null,          // {x,y,w,h} normalised 0..1 or null
        };
    }

    /* ── Load image ────────────────────────────── */

    loadFromURL(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { this._setSource(img); resolve(); };
            img.onerror = () => reject(new Error('Error loading image'));
            img.src = url;
        });
    }

    loadFromBase64(b64, mime = 'image/png') {
        return this.loadFromURL(`data:${mime};base64,${b64}`);
    }

    _setSource(img) {
        this._srcImage = img;
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        this._srcCanvas = c;
        this._srcData = ctx.getImageData(0, 0, c.width, c.height);
        this.edits = this._defaultEdits();
        this.render();
    }

    get loaded() { return !!this._srcData; }
    get sourceWidth() { return this._srcCanvas ? this._srcCanvas.width : 0; }
    get sourceHeight() { return this._srcCanvas ? this._srcCanvas.height : 0; }

    /* ── Edit setters ──────────────────────────── */

    setEdit(key, value) {
        this.edits[key] = value;
        this.requestRender();
    }

    setEdits(obj) {
        Object.assign(this.edits, obj);
        this.requestRender();
    }

    resetEdits() {
        this.edits = this._defaultEdits();
        this.requestRender();
    }

    onChange(fn) { this._onChangeCallbacks.push(fn); }

    /* ── Render pipeline ───────────────────────── */

    requestRender() {
        if (this._rendering) { this._pendingRender = true; return; }
        requestAnimationFrame(() => this.render());
    }

    render() {
        if (!this._srcData) return;
        this._rendering = true;

        const e = this.edits;
        const src = this._srcData;
        const w = src.width, h = src.height;

        // 1) Copy pixel data
        const pixels = new Uint8ClampedArray(src.data);

        // 2) Stretch (operates on raw values before adjustments)
        if (e.stretch !== 'none') {
            this._applyStretch(pixels, w, h, e);
        }

        // 3) Exposure + Gamma (multiplicative / power)
        if (e.exposure !== 0 || e.gamma !== 1.0) {
            this._applyExposureGamma(pixels, e.exposure, e.gamma);
        }

        // 4) Brightness + Contrast
        if (e.brightness !== 0 || e.contrast !== 0) {
            this._applyBrightnessContrast(pixels, e.brightness, e.contrast);
        }

        // 5) Shadows / Highlights
        if (e.shadows !== 0 || e.highlights !== 0) {
            this._applyShadowsHighlights(pixels, e.shadows, e.highlights);
        }

        // 6) Saturation
        if (e.saturation !== 0) {
            this._applySaturation(pixels, e.saturation);
        }

        // 7) Denoise (must be before sharpen)
        let imgData = new ImageData(pixels, w, h);
        if (e.denoise > 0) {
            imgData = this._applyDenoise(imgData, e.denoise);
        }

        // 8) Sharpen
        if (e.sharpen > 0) {
            imgData = this._applySharpen(imgData, e.sharpen);
        }

        // 9) Draw to an offscreen canvas, then apply transforms
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        offscreen.getContext('2d').putImageData(imgData, 0, 0);

        // 10) Apply crop → rotate → flip → draw to display canvas
        this._drawTransformed(offscreen, e);

        // 11) Histogram
        this._drawHistogram(imgData);

        this._rendering = false;
        this._onChangeCallbacks.forEach(fn => fn());
        if (this._pendingRender) { this._pendingRender = false; this.requestRender(); }
    }

    /* ── Pixel operations ──────────────────────── */

    _applyStretch(px, w, h, e) {
        // Collect luminance statistics for percentile calc
        const len = w * h;
        const lums = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const idx = i * 4;
            lums[i] = (px[idx] * 0.299 + px[idx + 1] * 0.587 + px[idx + 2] * 0.114);
        }
        lums.sort();

        const bpIdx = Math.floor(e.stretchBP / 100 * len);
        const wpIdx = Math.min(len - 1, Math.floor(e.stretchWP / 100 * len));
        const bp = lums[bpIdx] / 255;
        const wp = lums[wpIdx] / 255;
        const range = Math.max(wp - bp, 1e-6);

        const total = px.length;
        for (let i = 0; i < total; i += 4) {
            for (let c = 0; c < 3; c++) {
                let v = (px[i + c] / 255 - bp) / range;
                v = Math.max(0, Math.min(1, v));
                v = this._stretchFn(v, e);
                px[i + c] = v * 255;
            }
        }
    }

    _stretchFn(v, e) {
        switch (e.stretch) {
            case 'linear': return v;
            case 'asinh': {
                const b = e.stretchBeta;
                return Math.asinh(v * b) / Math.asinh(b);
            }
            case 'log': {
                const s = e.stretchScale;
                return Math.log(1 + v * s) / Math.log(1 + s);
            }
            case 'sqrt': return Math.sqrt(v);
            case 'midtone': {
                const m = e.stretchMid;
                if (v <= 0) return 0;
                if (v >= 1) return 1;
                return (m - 1) * v / ((2 * m - 1) * v - m);
            }
            case 'histeq': return v; // handled separately below
            default: return v;
        }
    }

    _applyExposureGamma(px, exposure, gamma) {
        const mult = Math.pow(2, exposure);
        const invGamma = 1 / gamma;
        for (let i = 0; i < px.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                let v = px[i + c] / 255;
                v *= mult;
                v = Math.pow(Math.max(0, Math.min(1, v)), invGamma);
                px[i + c] = v * 255;
            }
        }
    }

    _applyBrightnessContrast(px, brightness, contrast) {
        const b = brightness * 2.55;       // map -100..100 → -255..255
        const c = 1 + contrast / 100;      // map -100..100 → 0..2
        for (let i = 0; i < px.length; i += 4) {
            for (let ch = 0; ch < 3; ch++) {
                let v = px[i + ch];
                v = (v - 128) * c + 128 + b;
                px[i + ch] = v;  // Uint8Clamped clamps automatically
            }
        }
    }

    _applyShadowsHighlights(px, shadows, highlights) {
        // Shadows: lift dark tones. Highlights: pull down bright tones.
        const sAmt = shadows / 100;     // -1..1
        const hAmt = highlights / 100;  // -1..1
        for (let i = 0; i < px.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                let v = px[i + c] / 255;
                // Shadow: affect low values (weighted by (1-v)^2)
                if (sAmt !== 0) { v += sAmt * (1 - v) * (1 - v) * 0.5; }
                // Highlights: affect high values (weighted by v^2)
                if (hAmt !== 0) { v -= hAmt * v * v * 0.5; }
                px[i + c] = Math.max(0, Math.min(1, v)) * 255;
            }
        }
    }

    _applySaturation(px, saturation) {
        const s = 1 + saturation / 100;  // 0..2  (0 = greyscale, 2 = 2x saturated)
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            px[i]     = lum + (r - lum) * s;
            px[i + 1] = lum + (g - lum) * s;
            px[i + 2] = lum + (b - lum) * s;
        }
    }

    /* ── Convolution (sharpen / denoise) ───────── */

    _convolve3x3(imgData, kernel, amount) {
        const { width: w, height: h, data: src } = imgData;
        const out = new Uint8ClampedArray(src.length);
        out.set(src); // copy (edges stay unchanged)
        const mix = Math.min(1, amount / 100);

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    let sum = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const si = ((y + ky) * w + (x + kx)) * 4 + c;
                            sum += src[si] * kernel[(ky + 1) * 3 + (kx + 1)];
                        }
                    }
                    out[idx + c] = src[idx + c] * (1 - mix) + sum * mix;
                }
                out[idx + 3] = src[idx + 3]; // alpha
            }
        }
        return new ImageData(out, w, h);
    }

    _applySharpen(imgData, amount) {
        // Unsharp-mask style kernel
        const k = [
            0, -1,  0,
           -1,  5, -1,
            0, -1,  0,
        ];
        return this._convolve3x3(imgData, k, amount);
    }

    _applyDenoise(imgData, amount) {
        // Gaussian blur 3×3 approximation
        const s = 1 / 16;
        const k = [
            1*s, 2*s, 1*s,
            2*s, 4*s, 2*s,
            1*s, 2*s, 1*s,
        ];
        return this._convolve3x3(imgData, k, amount);
    }

    /* ── Transforms (crop / rotate / flip) ─────── */

    _drawTransformed(offscreen, e) {
        let sw = offscreen.width, sh = offscreen.height;
        let sx = 0, sy = 0, cw = sw, ch = sh;

        // Crop (normalised coords 0..1)
        if (e.crop) {
            sx = Math.floor(e.crop.x * sw);
            sy = Math.floor(e.crop.y * sh);
            cw = Math.floor(e.crop.w * sw);
            ch = Math.floor(e.crop.h * sh);
        }

        // Compute output dimensions after rotation
        const rad = e.rotation * Math.PI / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));
        const rw = Math.ceil(cw * cos + ch * sin);
        const rh = Math.ceil(cw * sin + ch * cos);

        // Size canvas to fit container while maintaining aspect
        const container = this.canvas.parentElement;
        const maxW = container ? container.clientWidth : 900;
        const maxH = container ? Math.min(container.clientHeight, 700) : 700;
        const scale = Math.min(1, maxW / rw, maxH / rh);

        this.canvas.width = Math.ceil(rw * scale);
        this.canvas.height = Math.ceil(rh * scale);

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.save();

        ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        ctx.scale(scale, scale);
        if (e.rotation) ctx.rotate(rad);
        if (e.flipH) ctx.scale(-1, 1);
        if (e.flipV) ctx.scale(1, -1);

        ctx.drawImage(offscreen, sx, sy, cw, ch, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
    }

    /* ── Histogram ─────────────────────────────── */

    _drawHistogram(imgData) {
        if (!this.histoCtx) return;
        const ctx = this.histoCtx;
        const cw = this.histoCanvas.width;
        const ch = this.histoCanvas.height;
        ctx.clearRect(0, 0, cw, ch);

        const rH = new Uint32Array(256);
        const gH = new Uint32Array(256);
        const bH = new Uint32Array(256);
        const lH = new Uint32Array(256);

        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            rH[d[i]]++;
            gH[d[i + 1]]++;
            bH[d[i + 2]]++;
            const lum = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
            lH[Math.min(255, lum)]++;
        }

        // Ignore the very first and last bins for max (often spikes)
        let max = 0;
        for (let i = 1; i < 255; i++) {
            max = Math.max(max, rH[i], gH[i], bH[i], lH[i]);
        }
        if (max === 0) return;

        const drawChannel = (hist, color) => {
            ctx.beginPath();
            ctx.moveTo(0, ch);
            for (let i = 0; i < 256; i++) {
                const x = (i / 255) * cw;
                const y = ch - (hist[i] / max) * ch;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(cw, ch);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        };

        ctx.globalCompositeOperation = 'screen';
        drawChannel(rH, 'rgba(255,60,60,0.45)');
        drawChannel(gH, 'rgba(60,255,60,0.45)');
        drawChannel(bH, 'rgba(60,100,255,0.45)');
        ctx.globalCompositeOperation = 'source-over';
        drawChannel(lH, 'rgba(200,200,200,0.2)');
    }

    /* ── Export ─────────────────────────────────── */

    toDataURL(format = 'image/png', quality = 0.92) {
        return this.canvas.toDataURL(format, quality);
    }

    toBlob(format = 'image/png', quality = 0.92) {
        return new Promise(resolve => this.canvas.toBlob(resolve, format, quality));
    }
}
