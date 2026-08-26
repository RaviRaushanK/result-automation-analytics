/**
 * ============================================================
 * SRAAS Tesseract OCR Provider
 * ============================================================
 *
 * Converts Tesseract.js output into the normalized OCR format
 * consumed by documentExtractor.js.
 */

const Tesseract = require("tesseract.js");

const {
    NormalizedOcr,
    OcrProvider,
    normalizeTesseractWords,
    averageConfidence
} = require("./ocrProvider");


class TesseractProvider extends OcrProvider {

    /**
     * Extract OCR information from an image.
     *
     * @param {string} filePath
     * @returns {Promise<NormalizedOcr>}
     */
    async extract(filePath) {

        let worker = null;

        try {

            console.log(
                `[TesseractProvider] Starting OCR: ${filePath}`
            );

            worker = await Tesseract.createWorker("eng", 1, {
                logger: message => {

                    if (process.env.DEBUG_MODE === "true") {
                        console.log("[Tesseract]", message);
                    }
                }
            });


            const result = await worker.recognize(filePath);

            const data = result?.data;

            if (!data) {
                throw new Error(
                    "Tesseract OCR returned no data"
                );
            }


            // -------------------------------------------------
            // Create normalized OCR result
            // -------------------------------------------------

            const normalized = new NormalizedOcr();

            normalized.provider = "tesseract";

            normalized.text = data.text || "";


            // -------------------------------------------------
            // Normalize words
            // -------------------------------------------------

            normalized.words = normalizeTesseractWords(
                data.words
            );


            // -------------------------------------------------
            // Confidence
            // -------------------------------------------------

            normalized.confidence = averageConfidence(
                normalized.words
            );


            // -------------------------------------------------
            // Optional layout information
            // -------------------------------------------------

            if (Array.isArray(data.blocks)) {
                normalized.blocks = data.blocks;
            }

            if (Array.isArray(data.lines)) {
                normalized.lines = data.lines;
            }


            console.log(
                `[TesseractProvider] OCR completed`
            );

            console.log(
                `[TesseractProvider] Words: ${normalized.words.length}`
            );

            console.log(
                `[TesseractProvider] Average confidence: ` +
                `${normalized.confidence.toFixed(2)}`
            );

            console.log(
                `[TesseractProvider] Text length: ` +
                `${normalized.text.length}`
            );


            return normalized;

        } catch (error) {

            console.error(
                `[TesseractProvider] OCR failed:`,
                error.message
            );

            throw new Error(
                `Tesseract OCR error: ${error.message}`
            );

        } finally {

            // Always terminate the worker.
            if (worker) {
                try {
                    await worker.terminate();
                } catch (terminateError) {
                    console.error(
                        "[TesseractProvider] Failed to terminate worker:",
                        terminateError.message
                    );
                }
            }
        }
    }
}


module.exports = TesseractProvider;
