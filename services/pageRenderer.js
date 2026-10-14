/**
 * ============================================================
 * SRAAS Page Renderer
 * ============================================================
 *
 * Turns an uploaded document into PNG image buffers — one per page —
 * so the Vision model can read scanned PDFs (which the VLM APIs do
 * not accept as PDF input).
 *
 *   - PDF    → rasterize each page with pdfjs-dist + @napi-rs/canvas
 *   - Images → pass through sharp, normalised to a clean PNG
 *
 * All dependencies are optional at runtime: if @napi-rs/canvas is not
 * installed, isRenderingAvailable() returns false and the caller can
 * fall back to the classic Tesseract path.
 */

const path = require('path');
const fs = require('fs');

let pdfjsLib = null;
try {
    // eslint-disable-next-line global-require
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
} catch (err) {
    pdfjsLib = null;
}

// IMPORTANT: pdfjs-dist bundles its OWN copy of @napi-rs/canvas (currently a
// different major version than the one we might install at the top level).
// pdfjs creates Path2D/contexts from ITS instance, so we MUST build our canvas
// from the SAME instance — otherwise `ctx.clip(path)` throws a Path2D type
// error (or segfaults). We resolve it via pdfjs's own dependency tree, with a
// fallback to a plain top-level require for robustness.
function loadNapiCanvas() {
    try {
        return require('pdfjs-dist/node_modules/@napi-rs/canvas');
    } catch (_) {
        try {
            return require('@napi-rs/canvas');
        } catch (err2) {
            return null;
        }
    }
}

const napiCanvas = loadNapiCanvas();
const createCanvas = napiCanvas ? napiCanvas.createCanvas : null;

let sharpLib = null;
try {
    sharpLib = require('sharp');
} catch (err) {
    sharpLib = null;
}

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];
const PDF_EXT = ['.pdf'];

// Max pages to send to the VLM (cost / latency guard).
const MAX_PAGES = parseInt(process.env.VLM_MAX_PAGES || '3', 10);
// Render scale for PDF rasterisation (~150-200 DPI is plenty for OCR/vision).
const RENDER_SCALE = parseFloat(process.env.VLM_RENDER_SCALE || '2');

function isRenderingAvailable() {
    return Boolean(pdfjsLib && createCanvas);
}

/**
 * pdfjs-dist v6 (legacy build) can use a NodeCanvasFactory. @napi-rs/canvas
 * provides createCanvas + ImageData, which is exactly what the factory needs.
 */
function makeNodeCanvasFactory() {
    return {
        create(width, height) {
            const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
            const context = canvas.getContext('2d');
            return { canvas, context };
        },
        reset(canvasAndContext, width, height) {
            canvasAndContext.canvas.width = Math.ceil(width);
            canvasAndContext.canvas.height = Math.ceil(height);
        },
        destroy(canvasAndContext) {
            if (canvasAndContext && canvasAndContext.canvas) {
                canvasAndContext.canvas.width = 0;
                canvasAndContext.canvas.height = 0;
            }
        }
    };
}

/**
 * Render a PDF file to an array of { pageNumber, buffer, mime } PNG images.
 * @param {string} filePath
 * @param {number}[maxPages]
 * @returns {Promise<Array<{pageNumber:number, buffer:Buffer, mime:string}>>}
 */
async function renderPdfToImages(filePath, maxPages = MAX_PAGES) {
    if (!isRenderingAvailable()) {
        throw new Error('PDF rendering unavailable: install @napi-rs/canvas.');
    }
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({
        data,
        // Keep pdfjs from trying to load worker scripts in this Node context.
        isEvalSupported: false,
        useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const factory = makeNodeCanvasFactory();

    const pageCount = Math.min(pdf.numPages, maxPages || MAX_PAGES);
    const images = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: RENDER_SCALE });

        const canvasAndContext = factory.create(viewport.width, viewport.height);

        await page.render({
            canvasContext: canvasAndContext.context,
            viewport,
            canvasFactory: factory
        }).promise;

        const png = canvasAndContext.canvas.toBuffer('image/png');
        images.push({ pageNumber, buffer: png, mime: 'image/png' });

        factory.destroy(canvasAndContext);
        page.cleanup();
    }

    try { await pdf.destroy(); } catch (_) { /* ignore */ }
    return images;
}

/**
 * Normalise a standalone image file to a single PNG buffer.
 * @param {string} filePath
 * @returns {Promise<Array<{pageNumber:number, buffer:Buffer, mime:string}>>}
 */
async function normalizeImageToPng(filePath) {
    if (!sharpLib) {
        // No sharp: hand the raw bytes back (VLM still accepts png/jpg).
        return [{ pageNumber: 1, buffer: fs.readFileSync(filePath), mime: guessMime(filePath) }];
    }
    const png = await sharpLib(filePath)
        .rotate()
        .resize({ width: 2400, withoutEnlargement: true })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
    return [{ pageNumber: 1, buffer: png, mime: 'image/png' }];
}

function guessMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
}

/**
 * Universal entry: document file → array of PNG page images.
 * @param {string} filePath
 * @returns {Promise<Array<{pageNumber:number, buffer:Buffer, mime:string}>>}
 */
async function documentToImages(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (PDF_EXT.includes(ext)) {
        return renderPdfToImages(filePath);
    }
    if (IMAGE_EXT.includes(ext)) {
        return normalizeImageToPng(filePath);
    }
    throw new Error(`Unsupported file type for vision: ${ext}`);
}

module.exports = {
    documentToImages,
    renderPdfToImages,
    normalizeImageToPng,
    isRenderingAvailable,
    IMAGE_EXT,
    PDF_EXT,
    MAX_PAGES
};
