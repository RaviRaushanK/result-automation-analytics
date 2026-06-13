# Project Structure  


```
.
├── .sequelizerc
├── app.js
├── package.json
├── package-lock.json
├── README.md
├── config
│   ├── .env
│   ├── config.js
│   ├── db.js
│   ├── README.md
│   └── session.js
├── controllers
│   ├── authController.js
│   ├── batchController.js
│   ├── resultController.js
│   ├── sessionController.js
│   └── subjectController.js
├── database
│   ├── schema.sql
│   └── models
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
├── docs
│   ├── database-structure.md
│   ├── er-diagram.md
│   ├── implementation-status.md
│   └── project-structure.md
├── init
│   ├── 01-default-settings.js
│   ├── 02-default-admin.js
│   └── README.md
├── middlewares
├── migrations
│   └── 20231001000000-create-all-tables.js
├── models
│   └── models.js
├── public
│   ├── charts
│   ├── css
│   ├── images
│   └── js
├── routes
│   └── batchRoutes.js
├── scripts
│   ├── bootstrap-db.js
│   └── runInit.js
├── seeders
│   └── 20231001000100-seed-mca.js
├── services
├── uploads
└── views
    ├── analytics
    ├── auth
    ├── batches
    ├── chat
    ├── dashboard
    ├── layouts
    ├── partials
    ├── reports
    ├── revaluation
    ├── sessions
    ├── students
    └── subjects
```

---  