'use strict';
const { TITLES } = require('../services/reportsService');
const card = (type, icon, description) => ({ type, title: TITLES[type], href: `/reports/${type}`, icon, description });
module.exports = [
  { title: 'Academic Results', cards: [
    card('student', 'person', "Review an individual student's semester results and recorded attempts."),
    card('class', 'groups', 'Review student result attempts for a selected batch, semester and session.'),
    card('subject', 'book', 'Review student marks and outcomes for a selected subject offering.'),
    card('consolidated', 'table_chart', 'Review the wide subject-wise result sheet with internal, external and total marks.')
  ] },
  { title: 'Performance & Progress', cards: [
    card('toppers', 'star', 'Review ranked student result attempts using the existing stored CGPA ranking basis.'),
    card('student-progress', 'view_week', 'Review first attempts, retake clearance and verified semester and year progression.'),
    card('result-analysis', 'bar_chart', 'Review subject-wise pass rates and overall result performance.')
  ] },
  { title: 'Result Revision', cards: [
    card('revaluation', 'assignment', 'Review original and revised outcomes with revaluation event history.')
  ] }
];
