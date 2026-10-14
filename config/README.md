## Environment Variables

### Database Configuration

* `DB_HOST` - MySQL host address.
* `DB_PORT` - MySQL port (default: 3306).
* `DB_USER` - MySQL username.
* `DB_PASSWORD` - MySQL password.
* `DB_NAME` - Database name.

### Session Configuration

* `SESSION_SECRET` - Secret key used to sign session cookies.
* For production, generate a secure random value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Application Configuration

* `APP_PORT` - Port on which the application runs.
* `DEBUG_MODE=true` - Enables verbose logging for development.
* `DEBUG_MODE=false` - Recommended for production to reduce log output and avoid exposing internal details.

### AI Hybrid Extraction (optional, free via Groq)

Extraction combines advanced Tesseract OCR + a vision model (VLM) + a text
LLM. See `../README.md` for the full table. In short:

* `GROQ_API_KEY` - Free API key from <https://console.groq.com/keys>. When
  set, the AI path is enabled; when absent, the app falls back to classic
  Tesseract automatically.
* `GROQ_VLM_MODEL` - Vision model (default `qwen/qwen3.8-27b`).
* `GROQ_LLM_MODEL` - Reconciling text model (default `openai/gpt-oss-20b`).
* `EXTRACTION_MODE` - `auto` (default) | `vlm` | `tesseract`.
* `VLM_MAX_PAGES` / `VLM_RENDER_SCALE` - VLM page/cost tuning.
