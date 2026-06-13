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
