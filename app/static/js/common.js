/* ============================================
   OASIS ASTROTOOLS — Common JavaScript
   Shared utilities and concept explanations
   ============================================ */

/**
 * Concept explanations database.
 * Each entry has a title, a brief tooltip (used in data-bs-toggle="tooltip"),
 * and a detailed HTML explanation shown in a modal.
 */
const CONCEPTS = {
    // --- SNR / Exposure ---
    "target-snr": {
        title: "SNR objetivo",
        detail: `
            <p>El <strong>SNR objetivo</strong> es la relación señal-ruido que deseas alcanzar en tu observación. La herramienta calculará el tiempo de exposición necesario para lograrlo.</p>
            <p><strong>Valores de referencia:</strong></p>
            <ul>
                <li><strong>SNR ≈ 3–5:</strong> Detección marginal — el objeto apenas se distingue del ruido.</li>
                <li><strong>SNR ≈ 10:</strong> Detección fiable — adecuado para confirmar la presencia de un objeto.</li>
                <li><strong>SNR ≈ 50:</strong> Buena fotometría — errores de ~2% en la medida de brillo.</li>
                <li><strong>SNR ≈ 100:</strong> Fotometría precisa — errores de ~1%.</li>
                <li><strong>SNR > 200:</strong> Espectroscopía de alta resolución.</li>
            </ul>
        `
    },
    "pixel-size": {
        title: "Tamaño de píxel",
        detail: `
            <p>El <strong>tamaño de píxel</strong> es la dimensión física de cada elemento del sensor de la cámara, medido en micrómetros (μm).</p>
            <p>Determina la <strong>escala de placa</strong> (cuántos segundos de arco del cielo cubre cada píxel):</p>
            <p style="text-align:center">$$\\text{Escala} = \\frac{p}{f} \\times 206.265 \\;\\text{"/px}$$</p>
            <p>donde $p$ es el tamaño de píxel en μm y $f$ la distancia focal en mm.</p>
            <p><strong>Píxeles más grandes:</strong> capturan más luz por píxel, pero con menor resolución espacial.</p>
            <p><strong>Píxeles más pequeños:</strong> mayor resolución, pero pueden submuestrear la imagen si la escala de placa es mayor que el seeing/2.</p>
            <p><strong>Valores típicos:</strong> 2.4 μm (CMOS pequeños) – 9 μm (CCD astronómicos).</p>
        `
    },
    "binning": {
        title: "Binning",
        detail: `
            <p>El <strong>binning</strong> combina la carga de varios píxeles adyacentes en uno solo antes de la lectura.</p>
            <p><strong>Binning 2×2:</strong> agrupa 4 píxeles en 1, cuadruplicando la señal por píxel efectivo y reduciendo el número de lecturas (menos ruido de lectura). La resolución se reduce a la mitad.</p>
            <p><strong>Ventajas:</strong></p>
            <ul>
                <li>Mayor señal por píxel → mejor SNR para objetos débiles.</li>
                <li>Menos píxeles que leer → menos ruido de lectura total.</li>
                <li>Archivos más pequeños y lectura más rápida.</li>
            </ul>
            <p><strong>Desventajas:</strong></p>
            <ul>
                <li>Menor resolución espacial.</li>
                <li>Mayor fondo de cielo por píxel.</li>
            </ul>
            <p><strong>Consejo:</strong> usa binning 1×1 cuando el seeing es bueno y quieres resolución, y binning 2×2 o más para objetos débiles extendidos.</p>
        `
    },
    "readout-noise": {
        title: "Ruido de lectura",
        detail: `
            <p>El <strong>ruido de lectura</strong> (read noise) es el ruido electrónico que se añade cada vez que se lee un píxel del sensor. Se mide en electrones (e⁻).</p>
            <p>Es <strong>independiente del tiempo de exposición</strong> — se añade una vez por lectura, sin importar lo larga que sea la exposición.</p>
            <p>Es relevante especialmente para:</p>
            <ul>
                <li>Exposiciones cortas (donde la señal es baja).</li>
                <li>Objetos débiles con poco fondo de cielo.</li>
            </ul>
            <p><strong>Valores típicos:</strong></p>
            <ul>
                <li>CCD científicos: 3–15 e⁻</li>
                <li>CMOS modernos: 1–5 e⁻</li>
                <li>CMOS retroiluminados: < 2 e⁻</li>
            </ul>
        `
    },
    "gain": {
        title: "Ganancia (e⁻/ADU)",
        detail: `
            <p>La <strong>ganancia</strong> es el factor de conversión entre electrones recopilados en el sensor y las unidades digitales (ADU) almacenadas en la imagen.</p>
            <p style="text-align:center">$$\\text{ADU} = \\frac{\\text{Electrones}}{\\text{Ganancia}}$$</p>
            <p>Una ganancia de 1.0 e⁻/ADU significa que cada electrón se convierte en 1 cuenta digital.</p>
            <p><strong>Ganancia alta (muchos e⁻/ADU):</strong> menor rango dinámico digital, pero suficiente para objetos brillantes.</p>
            <p><strong>Ganancia baja:</strong> mejor muestreo del ruido de lectura, útil para objetos débiles.</p>
        `
    },
    "temperature": {
        title: "Temperatura del sensor",
        detail: `
            <p>La <strong>temperatura del sensor</strong> determina la tasa de corriente oscura. Los sensores astronómicos se enfrían para reducir el ruido térmico.</p>
            <p>La corriente oscura se <strong>duplica cada ~5.8 °C</strong> en silicio:</p>
            <p style="text-align:center">$$D(T) = D_{\\text{ref}} \\times 2^{(T - T_{\\text{ref}}) / 5.8}$$</p>
            <p>Por ejemplo, si a 20 °C la corriente oscura es 0.1 e⁻/s/px, al enfriar a -10 °C se reduce a ~0.003 e⁻/s/px.</p>
            <p><strong>Temperaturas típicas de operación:</strong> -10 °C a -30 °C (cámaras refrigeradas).</p>
        `
    },
    "t-ref": {
        title: "Temperatura de referencia",
        detail: `
            <p>La <strong>temperatura de referencia</strong> es la temperatura a la que el fabricante midió la corriente oscura especificada.</p>
            <p>Normalmente es 20 °C o 25 °C. La calculadora usa este valor para extrapolar la corriente oscura a la temperatura real de operación.</p>
        `
    },
    "dark-current": {
        title: "Corriente oscura",
        detail: `
            <p>La <strong>corriente oscura</strong> (dark current) es la acumulación de electrones generados térmicamente en el sensor, incluso sin luz. Se mide en e⁻/s/píxel.</p>
            <p>Depende exponencialmente de la <strong>temperatura</strong> del sensor. Se reduce drásticamente al enfriar:</p>
            <p style="text-align:center">$$D(T) = D_{\\text{ref}} \\times 2^{(T - T_{\\text{ref}}) / 5.8}$$</p>
            <p><strong>En exposiciones largas</strong> puede dominar el ruido si el sensor no está suficientemente frío.</p>
            <p>Se puede <strong>calibrar y restar</strong> usando «dark frames» (exposiciones con el obturador cerrado), pero la fluctuación estadística (ruido de Poisson) no se puede eliminar.</p>
        `
    },
    "focal-length": {
        title: "Distancia focal",
        detail: `
            <p>La <strong>distancia focal</strong> del telescopio determina el aumento y la escala de placa del sistema óptico.</p>
            <p><strong>Mayor distancia focal</strong> → imágenes más grandes (más resolución angular por píxel), pero field of view más pequeño y relación focal (f/) más alta (óptica más lenta).</p>
            <p><strong>Relación focal:</strong> $f/D$, donde $D$ es el diámetro. Ej: un telescopio de 200 mm y f=1000 mm tiene f/5.</p>
            <p><strong>Valores típicos:</strong></p>
            <ul>
                <li>Refractor corto: 400–600 mm</li>
                <li>Newton f/5: 1000 mm (200 mm apertura)</li>
                <li>Schmidt-Cassegrain: 2000 mm</li>
            </ul>
        `
    },
    "diameter": {
        title: "Diámetro del telescopio",
        detail: `
            <p>El <strong>diámetro</strong> (apertura) del telescopio determina cuánta luz recopila. El área colectora es proporcional al cuadrado del diámetro:</p>
            <p style="text-align:center">$$A = \\frac{\\pi}{4}(D^2 - D_{\\text{sec}}^2)$$</p>
            <p>donde $D$ es el diámetro primario y $D_{\\text{sec}}$ el diámetro de la obstrucción central (secundario en reflectores).</p>
            <p><strong>Duplicar el diámetro</strong> cuadruplica el área y la señal recopilada.</p>
        `
    },
    "secondary": {
        title: "Obstrucción central",
        detail: `
            <p>En telescopios reflectores, el <strong>espejo secundario</strong> bloquea parte de la luz entrante. Esto reduce el área colectora efectiva.</p>
            <p>En refractores, la obstrucción es cero.</p>
            <p>Una obstrucción de 70 mm en un telecopio de 200 mm reduce el área colectora en un ~12%.</p>
        `
    },
    "optical-efficiency": {
        title: "Eficiencia óptica",
        detail: `
            <p>La <strong>eficiencia óptica</strong> es la fracción de la luz recopilada que llega efectivamente al sensor, después de las pérdidas en espejos, lentes, filtros y ventanas.</p>
            <p>Incluye:</p>
            <ul>
                <li>Reflectividad de espejos (~90-97% por superficie con recubrimiento de aluminio o plata).</li>
                <li>Transmisión de lentes correctoras (~95-99% por superficie con recubrimiento AR).</li>
                <li>Pérdidas en la ventana del sensor.</li>
            </ul>
            <p><strong>Valor típico:</strong> 0.80–0.90 para un sistema reflector con corrector.</p>
        `
    },
    "filter": {
        title: "Filtros fotométricos",
        detail: `
            <p>Los <strong>filtros fotométricos</strong> seleccionan un rango de longitudes de onda de la luz. El sistema más usado es el <strong>Johnson-Cousins UBVRI</strong>:</p>
            <ul>
                <li><strong>U (ultravioleta):</strong> 360 nm, Δλ ≈ 68 nm</li>
                <li><strong>B (azul):</strong> 440 nm, Δλ ≈ 98 nm</li>
                <li><strong>V (visual):</strong> 550 nm, Δλ ≈ 89 nm</li>
                <li><strong>R (rojo):</strong> 640 nm, Δλ ≈ 220 nm</li>
                <li><strong>I (infrarrojo cercano):</strong> 790 nm, Δλ ≈ 240 nm</li>
            </ul>
            <p><strong>Filtros de banda estrecha</strong> (Hα, [O III], [S II]) aíslan líneas de emisión específicas y son ideales para nebulosas, incluso con contaminación lumínica.</p>
        `
    },
    "qe": {
        title: "Eficiencia cuántica (QE)",
        detail: `
            <p>La <strong>eficiencia cuántica</strong> es la probabilidad de que un fotón que llega al sensor genere un electrón detectable.</p>
            <p>Depende de la longitud de onda. Los sensores <strong>retroiluminados (BSI)</strong> modernos alcanzan QE > 90% en el rango visible.</p>
            <p>Al cambiar de filtro, ajusta la QE al valor correspondiente a la longitud de onda central del filtro.</p>
        `
    },
    "extinction": {
        title: "Extinción atmosférica",
        detail: `
            <p>La <strong>extinción atmosférica</strong> es la absorción y dispersión de la luz al atravesar la atmósfera. Se mide en magnitudes por masa de aire.</p>
            <p>La magnitud observada se corrige como:</p>
            <p style="text-align:center">$$m_{\\text{obs}} = m_{\\text{real}} + k \\cdot X$$</p>
            <p>donde $k$ es el coeficiente de extinción y $X$ la masa de aire.</p>
            <p><strong>Valores típicos</strong> (sitio bueno, al nivel del mar):</p>
            <ul>
                <li>U: 0.55 mag/airmass</li>
                <li>B: 0.25</li>
                <li>V: 0.15</li>
                <li>R: 0.10</li>
                <li>I: 0.05</li>
            </ul>
        `
    },
    "airmass": {
        title: "Masa de aire (airmass)",
        detail: `
            <p>La <strong>masa de aire</strong> es una medida de la cantidad de atmósfera que la luz del objeto debe atravesar. Se define como:</p>
            <p style="text-align:center">$$X \\approx \\sec(z) = \\frac{1}{\\cos(z)}$$</p>
            <p>donde $z$ es el ángulo cenital (distancia angular al cénit).</p>
            <ul>
                <li><strong>X = 1.0:</strong> objeto en el cénit (mínima atmósfera).</li>
                <li><strong>X = 1.5:</strong> ~48° de elevación.</li>
                <li><strong>X = 2.0:</strong> ~30° de elevación.</li>
                <li><strong>X > 3:</strong> muy bajo en el horizonte, mucha extinción y turbulencia.</li>
            </ul>
            <p><strong>Consejo:</strong> observa con X < 2 siempre que sea posible.</p>
        `
    },
    "sky-brightness": {
        title: "Brillo del cielo",
        detail: `
            <p>El <strong>brillo del cielo</strong> (sky brightness) mide la luminosidad del fondo, en magnitudes por segundo de arco cuadrado (mag/arcsec²).</p>
            <p><strong>Escala inversa:</strong> un número <em>mayor</em> significa cielo <em>más oscuro</em>.</p>
            <p><strong>Valores de referencia (banda V):</strong></p>
            <ul>
                <li><strong>18 mag/arcsec²:</strong> cielo muy contaminado (ciudad grande)</li>
                <li><strong>20 mag/arcsec²:</strong> suburbano</li>
                <li><strong>21 mag/arcsec²:</strong> rural</li>
                <li><strong>21.8 mag/arcsec²:</strong> cielo oscuro sin luna</li>
                <li><strong>22.5+ mag/arcsec²:</strong> sitio astronómico excelente</li>
            </ul>
            <p>La Luna puede añadir 1–4 magnitudes de brillo al cielo, dependiendo de la fase y la distancia angular.</p>
        `
    },
    "magnitude": {
        title: "Magnitud aparente",
        detail: `
            <p>La <strong>magnitud aparente</strong> mide el brillo de un objeto visto desde la Tierra. Usa una escala logarítmica inversa:</p>
            <p style="text-align:center">$$m_1 - m_2 = -2.5 \\log_{10}\\left(\\frac{F_1}{F_2}\\right)$$</p>
            <p>Una diferencia de 5 magnitudes corresponde a un factor 100 en flujo.</p>
            <p><strong>Ejemplos:</strong></p>
            <ul>
                <li>Sol: –26.7</li>
                <li>Luna llena: –12.7</li>
                <li>Venus (máx.): –4.6</li>
                <li>Sirius: –1.46</li>
                <li>Límite a simple vista: ~6</li>
                <li>Límite telescopio 200mm: ~13–14 (visual)</li>
            </ul>
        `
    },
    "exposure-time": {
        title: "Tiempo de exposición",
        detail: `
            <p>El <strong>tiempo de exposición</strong> es la duración de cada toma individual, en segundos.</p>
            <p>La señal crece linealmente con el tiempo, pero el ruido crece como $\\sqrt{t}$, por lo que el SNR mejora como:</p>
            <p style="text-align:center">$$\\text{SNR} \\propto \\sqrt{t} \\;\\text{(si domina el ruido de cielo/dark)}$$</p>
            <p><strong>Límites prácticos:</strong></p>
            <ul>
                <li>Sin guiado: 15–60 s (según la focal y la montura).</li>
                <li>Con guiado: minutos a decenas de minutos.</li>
                <li>Saturación: objetos brillantes pueden saturar el sensor en exposiciones largas.</li>
            </ul>
        `
    },
    "n-exposures": {
        title: "Número de exposiciones (apilado)",
        detail: `
            <p>Apilar varias exposiciones mejora el SNR total:</p>
            <p style="text-align:center">$$\\text{SNR}_{\\text{total}} = \\text{SNR}_{\\text{individual}} \\times \\sqrt{N}$$</p>
            <p>Con $N$ exposiciones, el ruido aleatorio se reduce en un factor $\\sqrt{N}$.</p>
            <p><strong>Ventajas del apilado frente a una sola exposición larga:</strong></p>
            <ul>
                <li>Más fácil de guiar (exposiciones individuales más cortas).</li>
                <li>Permite rechazar tomas con defectos (satélites, nubes, vibraciones).</li>
                <li>Reduce el impacto de rayos cósmicos.</li>
            </ul>
        `
    },
    "seeing": {
        title: "Seeing atmosférico",
        detail: `
            <p>El <strong>seeing</strong> mide la turbulencia atmosférica. Se define como la anchura a media altura (FWHM) de la imagen de una estrella puntual (PSF).</p>
            <p><strong>Valores típicos:</strong></p>
            <ul>
                <li><strong>< 1":</strong> seeing excelente (observatorios profesionales de alta montaña).</li>
                <li><strong>1–2":</strong> bueno.</li>
                <li><strong>2–3":</strong> promedio.</li>
                <li><strong>3–5":</strong> pobre (zonas urbanas, baja altitud, meteo adversa).</li>
            </ul>
            <p>El seeing limita la resolución angular efectiva del telescopio. Para la mayoría de telescopios amateur, el seeing es el factor limitante, no la difracción.</p>
        `
    },
    "aperture": {
        title: "Apertura fotométrica",
        detail: `
            <p>La <strong>apertura fotométrica</strong> es el radio del círculo (en segundos de arco) dentro del cual se mide la señal de un objeto puntual.</p>
            <p><strong>Demasiado pequeña:</strong> pierdes parte de la señal de la estrella.</p>
            <p><strong>Demasiado grande:</strong> incluyes demasiado fondo de cielo, aumentando el ruido.</p>
            <p><strong>Regla general:</strong> un radio de 2–3× el FWHM del seeing captura el ~95–99% de la luz de la estrella con un buen balance señal/ruido.</p>
            <p>La fracción de luz capturada sigue un modelo gaussiano:</p>
            <p style="text-align:center">$$f = 1 - e^{-r^2 / (2\\sigma^2)}$$</p>
            <p>donde $\\sigma = \\text{FWHM} / 2.355$.</p>
        `
    },
    // --- FOV ---
    "sensor-size": {
        title: "Tamaño del sensor",
        detail: `
            <p>El <strong>tamaño del sensor</strong> (en píxeles) determina el campo de visión cuando se combina con el tamaño de píxel y la distancia focal:</p>
            <p style="text-align:center">$$\\text{FOV} = \\frac{N_{\\text{px}} \\times p}{f} \\times 206265"$$</p>
            <p><strong>Sensores comunes:</strong></p>
            <ul>
                <li>IMX294: 4144×2822 px (6.46 μm) → 19.2×13.1 mm</li>
                <li>IMX533: 3008×3008 px (3.76 μm) → 11.3×11.3 mm</li>
                <li>KAF-8300: 3326×2504 px (5.4 μm) → 18.0×13.5 mm</li>
                <li>Full frame 35mm: 6000×4000 px (3.76 μm) → 36×24 mm</li>
            </ul>
        `
    },
    "eyepiece-focal": {
        title: "Distancia focal del ocular",
        detail: `
            <p>La <strong>distancia focal del ocular</strong> determina el aumento (magnificación) del sistema:</p>
            <p style="text-align:center">$$M = \\frac{f_{\\text{telescopio}}}{f_{\\text{ocular}}}$$</p>
            <p>Un ocular de 25 mm en un telescopio de 1000 mm da 40×.</p>
            <p>El campo de visión real depende del aumento y del campo aparente (AFOV).</p>
        `
    },
    "afov": {
        title: "Campo aparente del ocular (AFOV)",
        detail: `
            <p>El <strong>AFOV</strong> (Apparent Field of View) es el ángulo visual que abarca el ocular visto por el ojo. El campo real es:</p>
            <p style="text-align:center">$$\\text{FOV}_{\\text{real}} = \\frac{\\text{AFOV}}{M}$$</p>
            <p><strong>Tipos de oculares:</strong></p>
            <ul>
                <li>Plössl: ~52°</li>
                <li>Wide-angle: ~65–72°</li>
                <li>Ultra wide-angle: ~82°</li>
                <li>Ethos / Mega wide: ~100–110°</li>
            </ul>
        `
    },
};

/**
 * Show a concept explanation in a modal.
 */
function showConcept(conceptId) {
    const concept = CONCEPTS[conceptId];
    if (!concept) return;

    document.getElementById('conceptModalTitle').textContent = concept.title;
    document.getElementById('conceptModalBody').innerHTML = concept.detail;

    // Re-render KaTeX in the modal
    const modalBody = document.getElementById('conceptModalBody');
    if (window.renderMathInElement) {
        renderMathInElement(modalBody, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
            ],
            throwOnError: false,
        });
    }

    const modal = new bootstrap.Modal(document.getElementById('conceptModal'));
    modal.show();
}

/**
 * Helper: update a range input's displayed value.
 */
function bindRangeDisplay(inputId, displayId, format) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!input || !display) return;

    const update = () => {
        display.textContent = format ? format(input.value) : input.value;
    };
    input.addEventListener('input', update);
    update();
}

/**
 * Helper: make a POST request to an API endpoint with JSON body.
 */
async function apiPost(url, data) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `API error: ${response.status}`);
    }
    return response.json();
}

/**
 * Helper: make a GET request to an API endpoint.
 */
async function apiGet(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

/**
 * Auto-bind param-label-text elements to show concept modals on click.
 */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.param-label-text[data-concept]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            showConcept(el.dataset.concept);
        });
    });
});
