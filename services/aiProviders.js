/**
 * ============================================================
 * SRAAS AI Provider Clients (FREE models via Groq)
 * ============================================================
 *
 * OpenAI-compatible clients for the two free models used by the
 * hybrid extraction pipeline:
 *   - VLM : qwen/qwen3.8-27b      (vision + text, JSON mode)
 *   - LLM : openai/gpt-oss-20b    (fast, strong structured output)
 *
 * Uses Node's native fetch (Node 18+) — no SDK dependency.
 *
 * Set GROQ_API_KEY in config/.env. When it is absent, isConfigured()
 * returns false and the caller falls back to the classic Tesseract
 * path, so the app keeps working with zero configuration.
 */

const path = require('path');

// Load env from the project root (app.js) and config/.env (db.js) so the
// keys are found regardless of how this module is required.
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', 'config', '.env') });
} catch (_) { /* ignore */ }

const BASE_URL = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
const VLM_MODEL = process.env.GROQ_VLM_MODEL || 'qwen/qwen3.8-27b';
const LLM_MODEL = process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-20b';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GROQ_TIMEOUT_MS || '60000', 10);

function isConfigured() {
    return Boolean(process.env.GROQ_API_KEY && String(process.env.GROQ_API_KEY).trim());
}

function maskKey() {
    const k = String(process.env.GROQ_API_KEY || '').trim();
    if (!k) return '(none)';
    return k.length <= 8 ? '****' : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/**
 * Low-level chat completion call against the OpenAI-compatible endpoint.
 * @param {Object} opts
 * @param {string} opts.model
 * @param {Array}  opts.messages
 * @param {boolean}[opts.jsonMode=false]  request JSON output
 * @param {number}[opts.maxTokens=4096]
 * @param {number}[opts.temperature]
 * @returns {Promise<string>} the assistant message content
 */
async function chat({ model, messages, jsonMode = false, maxTokens = 4096, temperature, maxRetries = 3 }) {
    if (!isConfigured()) {
        throw new Error('GROQ_API_KEY is not set — AI extraction is disabled.');
    }

    const body = { model, messages, max_tokens: maxTokens };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (jsonMode) body.response_format = { type: 'json_object' };

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        attempt++;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        let res;
        try {
            res = await fetch(`${BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${String(process.env.GROQ_API_KEY).trim()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`Groq request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
            }
            throw new Error(`Groq request failed: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }

        // Retry on rate limits (429) and transient 5xx, honouring Groq's
        // "try again in Xs" hint. The free tier is token-limited per minute,
        // so multi-page documents can transiently exceed it.
        if ((res.status === 429 || res.status >= 500) && attempt <= maxRetries) {
            let detail = '';
            try { detail = await res.text(); } catch (_) { /* ignore */ }
            const waitMs = parseRetryAfter(detail, attempt);
            console.warn(`[aiProviders] ${res.status} on attempt ${attempt}; retrying in ${waitMs}ms`);
            await sleep(waitMs);
            continue;
        }

        if (!res.ok) {
            let detail = '';
            try { detail = await res.text(); } catch (_) { /* ignore */ }
            throw new Error(`Groq API error ${res.status}: ${detail}`);
        }

        const data = await res.json();
        const content = data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : '';
        return content || '';
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse Groq's "try again in X.XXs" hint; otherwise exponential backoff. */
function parseRetryAfter(detail, attempt) {
    const m = /try again in\s+([\d.]+)\s*s/i.exec(detail || '');
    if (m) return Math.ceil((parseFloat(m[1]) + 0.5) * 1000);
    return Math.min(1000 * Math.pow(2, attempt), 30000);
}

/**
 * Vision call: send ONE image (base64) plus a text prompt to the VLM.
 * @param {Object} opts
 * @param {string} opts.imageBase64
 * @param {string}[opts.mime='image/png']
 * @param {string}[opts.systemPrompt]
 * @param {string} opts.userText
 * @param {boolean}[opts.jsonMode=true]
 * @param {string}[opts.model]
 * @param {number}[opts.maxTokens]
 * @returns {Promise<string>} model text output
 */
async function vision({
    imageBase64,
    mime = 'image/png',
    systemPrompt,
    userText,
    jsonMode = true,
    model = VLM_MODEL,
    maxTokens = 8192
}) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({
        role: 'user',
        content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
            { type: 'text', text: userText }
        ]
    });
    return chat({ model, messages, jsonMode, maxTokens });
}

/**
 * Text-only LLM call.
 * @param {Object} opts
 * @param {string}[opts.systemPrompt]
 * @param {string} opts.userText
 * @param {boolean}[opts.jsonMode=true]
 * @param {string}[opts.model]
 * @param {number}[opts.maxTokens]
 * @returns {Promise<string>} model text output (JSON when jsonMode)
 */
async function complete({
    systemPrompt,
    userText,
    jsonMode = true,
    model = LLM_MODEL,
    maxTokens = 8192
}) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userText });
    return chat({ model, messages, jsonMode, maxTokens });
}

/** Parse JSON from a model response, tolerating code fences / stray text. */
function safeJsonParse(text, fallback = null) {
    if (text == null) return fallback;
    if (typeof text === 'object') return text;
    try {
        return JSON.parse(text);
    } catch (_) { /* fall through */ }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
        try { return JSON.parse(m[0]); } catch (_) { /* ignore */ }
    }
    return fallback;
}

module.exports = {
    isConfigured,
    maskKey,
    chat,
    vision,
    complete,
    safeJsonParse,
    BASE_URL,
    VLM_MODEL,
    LLM_MODEL
};
