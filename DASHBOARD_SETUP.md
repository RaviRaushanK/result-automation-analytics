# Dashboard Setup Guide

## Overview
This guide provides step-by-step instructions to set up and run the Student Automated Result Analysis System (SRAAS) Dashboard.

## Prerequisites
- Node.js (v14 or higher)
- MySQL (v8.0 or higher)
- npm or yarn package manager

## Installation Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Install Additional Dependencies
The dashboard requires the following additional packages:
```bash
npm install multer tesseract.js
```

**Package Details:**
- `multer`: Middleware for handling multipart/form-data (file uploads)
- `tesseract.js`: OCR library for text extraction from images/PDFs

### 3. Environment Configuration
Ensure your `.env` file in the `config/` directory contains:
```env
APP_PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=result_analytics
SESSION_SECRET=your_session_secret
```

### 4. Database Setup
Run database migrations:
```bash
npm run migrate
```

Seed initial data:
```bash
npm run seed
```

Or run the complete setup:
```bash
npm run setup
```

### 5. Create Uploads Directory
The system automatically creates this, but ensure it exists:
```bash
mkdir uploads
```

### 6. Start the Application
```bash
npm start
```

The application will be available at: `http://localhost:3000`

## Dashboard Features

### Main Dashboard (`/dashboard`)
- **Statistics Cards**: 8 animated cards showing key metrics
  - Total Students
  - Total Pass/Fail Students
  - Pass/Fail Percentage
  - Total Subjects
  - Highest Score
  - Average CGPA

- **Filters**: 
  - Academic Year dropdown
  - Semester dropdown
  - Apply/Reset filter buttons

- **Top 10 Scorers Table**: Ranked list of top performers

- **Charts**:
  - Subject Wise Average (Bar Chart)
  - Pass vs Fail Analysis (Pie & Doughnut Charts)
  - Result Trends (Line Chart)
  - Semester Performance (Combined Bar/Line Chart)

- **Subject Analytics Table**: Detailed subject-wise statistics

### Upload Page (`/dashboard/upload`)
- File upload (PDF, JPG, PNG)
- OCR processing with Tesseract.js
- Data preview with editable fields
- Add/Delete rows functionality
- Save to database

## File Structure

```
result-automation-analytics/
├── controllers/
│   └── dashboardController.js      # Dashboard API endpoints
├── routes/
│   └── dashboardRoutes.js          # Dashboard routes
├── services/
│   └── ocrService.js               # OCR processing service
├── views/
│   └── dashboard/
│       ├── index.ejs               # Main dashboard page
│       └── upload.ejs              # Upload page
├── public/
│   ├── css/
│   │   └── dashboard.css           # Dashboard styles
│   └── js/
│       ├── dashboard.js            # Dashboard functionality
│       ├── charts.js               # Chart.js configurations
│       └── upload.js               # Upload page functionality
├── uploads/                        # Uploaded files directory
├── app.js                          # Main application file
└── config/
    └── sidebar.json                # Sidebar navigation config
```

## API Endpoints

### Dashboard Routes
- `GET /dashboard` - Dashboard page
- `GET /dashboard/stats` - Get dashboard statistics
- `GET /dashboard/top-scorers` - Get top 10 scorers
- `GET /dashboard/analytics` - Get subject analytics
- `GET /dashboard/pass-fail` - Get pass/fail data
- `GET /dashboard/trends` - Get result trends
- `GET /dashboard/semester-performance` - Get semester performance

### Upload Routes
- `GET /dashboard/upload` - Upload page
- `POST /dashboard/upload` - Upload marksheet file
- `POST /dashboard/process-ocr` - Process OCR on file
- `POST /dashboard/save-ocr` - Save OCR data to database
- `PUT /dashboard/ocr/:id` - Update OCR record
- `DELETE /dashboard/ocr/:id` - Delete OCR record

## Technology Stack

### Backend
- Node.js
- Express.js
- MySQL
- Sequelize ORM
- Tesseract.js (OCR)
- Multer (File upload)

### Frontend
- EJS (Templating)
- Bootstrap 5 (UI Framework)
- Chart.js (Data visualization)
- Material Icons
- Vanilla JavaScript

## Key Features

### 1. Responsive Design
- Mobile-friendly layout
- Collapsible sidebar
- Adaptive charts and tables

### 2. Dark Mode Support
- Automatic theme switching
- Consistent styling across themes

### 3. Real-time Filtering
- Dynamic data refresh
- Animated transitions
- Loading indicators

### 4. OCR Integration
- Extract data from PDF/JPG/PNG
- Confidence score display
- Editable preview
- Validation before save

### 5. Data Visualization
- 5 different chart types
- Interactive tooltips
- Smooth animations
- Export functionality

## Troubleshooting

### Issue: OCR not working
**Solution**: Ensure Tesseract.js is installed:
```bash
npm install tesseract.js
```

### Issue: File upload fails
**Solution**: Check uploads directory permissions:
```bash
chmod 755 uploads
```

### Issue: Charts not displaying
**Solution**: Verify Chart.js CDN is accessible and internet connection is available.

### Issue: Database connection error
**Solution**: Check MySQL is running and credentials in `.env` are correct.

## Security Considerations

1. **File Upload Security**:
   - File type validation (PDF, JPG, PNG only)
   - File size limit (10MB)
   - Secure file naming

2. **Input Validation**:
   - Server-side validation for all inputs
   - SQL injection prevention (Sequelize ORM)
   - XSS protection (HTML escaping)

3. **Authentication**:
   - Session-based authentication
   - Role-based access control
   - Protected routes

## Performance Optimization

1. **Database Queries**:
   - Indexed columns for faster queries
   - Efficient JOIN operations
   - Pagination for large datasets

2. **Frontend**:
   - Lazy loading for charts
   - Debounced filter inputs
   - Cached API responses

3. **OCR Processing**:
   - Worker pool management
   - Progress tracking
   - Async processing

## Browser Support
- Chrome (v90+)
- Firefox (v88+)
- Safari (v14+)
- Edge (v90+)

## Contributing
1. Follow existing code style
2. Add comments for complex logic
3. Test on multiple browsers
4. Update documentation

## License
ISC

## Support
For issues or questions, please contact the development team.