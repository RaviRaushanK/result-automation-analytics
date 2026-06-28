# Result Automation Analytics (SRAAS)

## Overview

A full-stack Node.js/Express application for managing academic results, students, subjects, and revaluations.

## Features

- Manage departments, batches, students, faculty, and subjects
- Record semester results with optional SGPA and CGPA values
- Handle revaluation requests with file uploads
- Generate analytics and reports
- Role-based access control (admin, faculty, student)
- Dashboard with sidebar navigation
- Session and academic management

## Technology Stack

- **Runtime**: Node.js
- **View Engine**: EJS (Embedded JavaScript)
- **Database**: MySQL
- **ORM**: Sequelize
- **Authentication**: express-session with bcryptjs
- **UI**: Bootstrap 5, Material Icons

## Project Structure

```text
result-automation-analytics/
├── app.js                          # Express application entry point
├── package.json                    # Project metadata and dependencies
├── package-lock.json               # Dependency lock file
├── README.md                       # Main project documentation
├── .gitignore                      # Git ignore rules
├── .sequelizerc                    # Sequelize CLI configuration
├── config/
│   ├── .env.example                # Environment variables template
│   ├── config.js                   # Application configuration
│   ├── db.js                       # Database connection
│   ├── session.js                  # Session configuration
│   ├── sidebar.json                # Sidebar menu configuration
│   └── README.md                   # Configuration documentation
├── controllers/
│   ├── authController.js
│   ├── batchController.js
│   ├── resultController.js
│   ├── sessionController.js
│   └── subjectController.js
├── database/
│   ├── schema.sql                  # Database schema
│   └── models/
│       ├── index.js
│       ├── AdminUser.js
│       ├── Batch.js
│       ├── Department.js
│       ├── Faculty.js
│       ├── ImportLog.js
│       ├── OcrExtraction.js
│       ├── Result.js
│       ├── ResultSession.js
│       ├── RevaluationResult.js
│       ├── Student.js
│       ├── Subject.js
│       ├── SubjectFaculty.js
│       ├── SubjectResult.js
│       └── SystemSetting.js
├── docs/
│   ├── database-structure.md
│   ├── er-diagram.md
│   ├── implementation-status.md
│   └── project-structure.md
├── init/
│   ├── 01-default-settings.js
│   ├── 02-default-admin.js
│   └── README.md
├── middlewares/
│   ├── authMiddleware.js
│   ├── layoutMiddleware.js
│   ├── menuMiddleware.js
│   ├── themeMiddleware.js
│   └── userMiddleware.js
├── migrations/
│   ├── 20231001000000-create-all-tables.js
│   └── 20231101000000-modify-schema.js
├── public/
│   ├── charts/
│   ├── css/
│   │   ├── dashboard.css
│   │   ├── landing.css
│   │   ├── login.css
│   │   └── tokens.css
│   ├── images/
│   └── js/
│       ├── landing.js
│       ├── sidebar.js
│       └── themeSwitcher.js
├── routes/
│   ├── authRoutes.js
│   ├── batchRoutes.js
│   ├── dashboardRoutes.js
│   ├── landingRoutes.js
│   ├── resultRoutes.js
│   ├── sessionRoutes.js
│   ├── subjectRoutes.js
├── scripts/
│   ├── bootstrap-db.js
│   └── runInit.js
├── seeders/
│   └── 20231001000100-seed-mca.js
├── services/
├── uploads/
└── views/
    ├── README.md
    ├── analytics/
    ├── auth/
    ├── batches/
    ├── chat/
    ├── dashboard/
    ├── departments/
    ├── errors/
    ├── faculty/
    ├── landing/
    ├── layouts/
    ├── partials/
    ├── reports/
    ├── results/
    ├── revaluation/
    ├── sessions/
    ├── students/
    ├── subjects/
```

## Installation

### Prerequisites

* Node.js (v18 or later recommended)
* npm (v9 or later)
* MySQL (v8.0 or later)

### Clone the Repository

```bash
git clone https://github.com/RaviRaushanK/result-automation-analytics.git
cd result-automation-analytics
```

### Install Dependencies

```bash
npm install
```

### Configure Environment

Copy the example environment file and update the required values.

```bash
cp config/.env.example config/.env
```

> **Note:** On Windows, create `config/.env` manually or use File Explorer if the `cp` command is unavailable.

Update the database credentials and other environment variables inside `config/.env`.

### Initialize the Database

Run the initialization script to create the database schema, seed default data, and prepare the application.

```bash
npm run setup
```

### Start the Application

```bash
npm start
```

or during development:

```bash
npm run dev <- Not working
```

The application will be available at:

```text
http://localhost:3000
```

## Default Login Credentials

After completing the setup, log in using the default administrator account configured by the initialization script.

| Field        | Value               |
| ------------ | ------------------- |
| **Username** | `admin`             |
| **Email**    | `admin@example.com` |
| **Password** | `admin123`          |


## Available npm Scripts

npm install - Install dependencies
npm run setup - Setup database, run migrations, init data
npm run migrate - Run migrations
npm run seed - Run seeders
npm run init-db - Run initialization scripts
npm start - Start the application

## Authentication

The application uses session-based authentication with bcryptjs for password hashing.

## Routes

/ - Landing page - Public
/login - Login page - Public
/logout - Logout - Authenticated
/dashboard - Dashboard - Authenticated
/batches - Batch management - Authenticated
/subjects - Subject management - Authenticated
/results - Result management - Authenticated
/sessions - Session management - Authenticated

## Current Project Status

- Core architecture implemented with Express.js and Sequelize
- Database models and associations defined
- Dashboard with sidebar navigation
- CRUD operations for batches, subjects, results, sessions
- EJS views with layout system

## Future Roadmap

- Add pagination and filtering to result listings
- Implement role-based access control for admin, faculty, and student roles
- Add file upload functionality for revaluation documents
- Implement OCR extraction for result processing
- Implement automated tests
- Add API endpoints for mobile applications

## License
This project is licensed under the ISC License.

## Contributing
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request
Password: admin123
