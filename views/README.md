# Views Directory Documentation

## Purpose

The `views/` directory contains all **EJS (Embedded JavaScript)** templates responsible for rendering the application's user interface. It follows a feature-based structure that separates pages into logical modules while reusing common layouts and partials. This organization improves maintainability, scalability, and code reusability.

---

# Directory Structure

```text
views/
├── README.md                 # Views directory documentation
├── analytics/                # Analytics and reporting pages
├── auth/                     # Authentication pages
├── batches/                  # Batch management pages
├── chat/                     # Chat assistant pages
├── dashboard/                # Dashboard pages
├── departments/              # Department management pages
├── errors/                   # Error pages (404, 500)
├── faculty/                  # Faculty management pages
├── landing/                  # Public landing page
├── layouts/                  # Base layouts
├── partials/                 # Reusable UI components
├── reports/                  # Report pages
├── results/                  # Result management pages
├── revaluation/              # Revaluation pages
├── sessions/                 # Academic session pages
├── students/                 # Student management pages
├── subjects/                 # Subject management pages
```

---

# Directory Overview

| Directory          | Description                                        |
| ------------------ | -------------------------------------------------- |
| `analytics/`       | Views related to analytics and reports.            |
| `auth/`            | Login, account security, and authentication pages. |
| `batches/`         | Batch management interfaces.                       |
| `chat/`            | Chat assistant pages.                              |
| `dashboard/`       | Main dashboard displayed after successful login.   |
| `departments/`     | Department management pages.                       |
| `errors/`          | Custom error pages such as 404 and 500.            |
| `faculty/`         | Faculty management pages.                          |
| `landing/`         | Public-facing landing page.                        |
| `layouts/`         | Base layouts shared across multiple pages.         |
| `partials/`        | Reusable UI components included in layouts.        |
| `reports/`         | Report generation and display pages.               |
| `results/`         | Result management pages.                           |
| `revaluation/`     | Revaluation workflow pages.                        |
| `sessions/`        | Academic session management pages.                 |
| `students/`        | Student management pages.                          |
| `subjects/`        | Subject management pages.                          |

---

# Layouts

Layouts define the common structure shared by multiple pages.

| Layout        | Purpose                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ejs`    | Primary layout for authenticated pages. Includes the navbar, sidebar, breadcrumbs, alerts, page content, footer, and common JavaScript. |
| `auth.ejs`    | Layout used for authentication-related pages such as Login and Change Password.                                                         |
| `landing.ejs` | Layout for public pages without authentication or application navigation.                                                               |

---

# Partials

Reusable UI components shared across layouts.

| Partial           | Purpose                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `head.ejs`        | HTML head section including metadata, fonts, icons, and CSS files.               |
| `navbar.ejs`      | Top navigation bar with branding, sidebar toggle, theme switcher, and user menu. |
| `sidebar.ejs`     | Main navigation sidebar with collapsible menu items.                             |
| `breadcrumbs.ejs` | Breadcrumb navigation displayed on application pages.                            |
| `alerts.ejs`      | Flash messages and alert notifications.                                          |
| `footer.ejs`      | Common footer displayed across pages.                                            |
| `scripts.ejs`     | Shared JavaScript imports and initialization scripts.                            |

---

# Rendering Flow

Every page is rendered using the following flow:

```text
Route
   │
   ▼
Controller
   │
   ▼
View (.ejs)
   │
   ▼
Layout
   │
   ├── head.ejs
   ├── navbar.ejs
   ├── sidebar.ejs
   ├── breadcrumbs.ejs
   ├── alerts.ejs
   ├── Page Content
   ├── footer.ejs
   └── scripts.ejs
```

---

# EJS Conventions

* Organize pages by feature.
* Keep business logic inside controllers.
* Use layouts to avoid duplicated page structure.
* Use partials for reusable UI components.
* Keep templates focused on presentation.
* Pass only the required data from controllers.
* Use semantic HTML wherever possible.
* Follow consistent naming conventions for files and folders.

---

# Current Implemented Views

| View                        | Description           | Layout        |
| --------------------------- | --------------------- | ------------- |
| `auth/login.ejs`            | User login page       | `auth.ejs`    |
| `auth/account-security.ejs` | Account security page | `main.ejs`    |
| `auth/changePassword.ejs`   | Change password page  | `auth.ejs`    |
| `dashboard/index.ejs`       | Dashboard home page   | `main.ejs`    |
| `landing/index.ejs`         | Public landing page   | `landing.ejs` |
| `errors/404.ejs`            | Page Not Found        | `landing.ejs` |
| `errors/500.ejs`            | Internal Server Error | `landing.ejs` |

> Update this table whenever new views are added.

---

# Adding a New View

1. Create the EJS file inside the appropriate feature directory.
2. Create or update the corresponding controller.
3. Register the route.
4. Choose the appropriate layout (`main`, `auth`, or `landing`).
5. Pass the required data from the controller.
6. Reuse existing partials whenever possible.

---

# Best Practices

* Keep feature-specific pages inside their respective folders.
* Reuse layouts and partials instead of duplicating HTML.
* Avoid placing business logic inside EJS templates.
* Keep templates clean, readable, and modular.
* Maintain consistent file naming conventions.
* Update this documentation whenever the `views/` directory structure changes.
