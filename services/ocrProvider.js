/**
 * ============================================================
 * SRAAS OCR Provider Abstraction
 * ============================================================
 *
 * Defines:
 * 1. Normalized OCR output format
 * 2. Base OCR provider interface
 * 3. Helper functions used by OCR providers
 *
 * The result parser should consume NormalizedOcr and should
 * not care which OCR engine produced it.
 */

class NormalizedOcr {
    constructor() {
        this.text = "";
        this.words = [];
        this.blocks = [];
        this.lines = [];
        this.provider = "";
        this.confidence = 0;
    }
}


/**
 * Base class for all OCR providers.
 */
class OcrProvider {

    /**
     * Extract OCR information from a file.
     *
     * @param {string} filePath
     * @returns {Promise<NormalizedOcr>}
     */
    async extract(filePath) {
        throw new Error(
            `${this.constructor.name} must implement extract(filePath)`
        );
    }
}


/**
 * Safely convert a value to a number.
 */
function safeParseNumber(value) {
    if (value === null || value === undefined || value === "") {
        return NaN;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : NaN;
}


/**
 * Normalize Tesseract word objects.
 *
 * Output format:
 *
 * {
 *     text,
 *     confidence,
 *     left,
 *     top,
 *     width,
 *     height
 * }
 */
function normalizeTesseractWords(tesseractWords) {

    if (!Array.isArray(tesseractWords)) {
        return [];
    }

    return tesseractWords
        .filter(word => word && word.text != null)
        .map(word => {

            const confidence = safeParseNumber(word.confidence);
            const left = safeParseNumber(word.left);
            const top = safeParseNumber(word.top);
            const width = safeParseNumber(word.width);
            const height = safeParseNumber(word.height);

            return {
                text: String(word.text).trim(),

                confidence: Number.isFinite(confidence)
                    ? confidence
                    : 0,

                left: Number.isFinite(left)
                    ? left
                    : 0,

                top: Number.isFinite(top)
                    ? top
                    : 0,

                width: Number.isFinite(width)
                    ? width
                    : 0,

                height: Number.isFinite(height)
                    ? height
                    : 0
            };
        })
        .filter(word => word.text.length > 0);
}


/**
 * Calculate average OCR confidence.
 */
function averageConfidence(words) {

    if (!Array.isArray(words) || words.length === 0) {
        return 0;
    }

    const validWords = words.filter(
        word => Number.isFinite(word.confidence)
    );

    if (validWords.length === 0) {
        return 0;
    }

    const total = validWords.reduce(
        (sum, word) => sum + word.confidence,
        0
    );

    return total / validWords.length;
}


module.exports = {
    NormalizedOcr,
    OcrProvider,
    normalizeTesseractWords,
    averageConfidence,
    safeParseNumber
};