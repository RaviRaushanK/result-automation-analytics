const Tesseract = require('tesseract.js');

/**
 * OCR Service - Handles text extraction from uploaded marksheets
 * Uses Tesseract.js for OCR processing
 */

class OCRService {
  constructor() {
    this.worker = null;
    this.initializeWorker();
  }

  /**
   * Initialize Tesseract worker
   */
  async initializeWorker() {
    try {
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${(m.progress * 100).toFixed(2)}%`);
          }
        }
      });
      console.log('OCR Worker initialized successfully');
    } catch (err) {
      console.error('Failed to initialize OCR worker:', err);
      throw err;
    }
  }

  /**
   * Process image/file and extract text
   * @param {string} filePath - Path to the uploaded file
   * @returns {Object} OCR result with extracted text and data
   */
  async processImage(filePath) {
    try {
      if (!this.worker) {
        await this.initializeWorker();
      }

      console.log(`Processing OCR for file: ${filePath}`);

      // Perform OCR
      const { data } = await this.worker.recognize(filePath);
      
      const rawText = data.text;
      const confidence = data.confidence;

      console.log(`OCR completed with confidence: ${confidence}%`);

      // Parse extracted text to structured data
      const extractedData = this.parseMarksheetData(rawText);

      return {
        rawText,
        extractedData,
        confidence
      };
    } catch (err) {
      console.error('Error processing OCR:', err);
      throw new Error(`OCR processing failed: ${err.message}`);
    }
  }

  /**
   * Parse raw OCR text into structured marksheet data
   * @param {string} rawText - Raw text from OCR
   * @returns {Array} Array of extracted records
   */
  parseMarksheetData(rawText) {
    try {
      const lines = rawText.split('\n').filter(line => line.trim().length > 0);
      const records = [];
      
      // Common patterns in marksheets
      const studentNamePattern = /(?:Name|Student Name|NAME)[\s:]+([A-Za-z\s]+)/i;
      const usnPattern = /(?:USN|Reg No|Register No|Roll No)[\s:]+([A-Z0-9]+)/i;
      const semesterPattern = /(?:Semester|SEM|Sem)[\s:]+(\d+)/i;
      const subjectPattern = /([A-Z]{2,3}\d{2,3})[\s]+([A-Za-z\s&]+)[\s]+(\d{2,3})/g;

      let currentRecord = {
        studentName: '',
        usn: '',
        semester: '',
        academicYear: '',
        subjects: []
      };

      // Extract student information
      for (const line of lines) {
        // Try to match student name
        const nameMatch = line.match(studentNamePattern);
        if (nameMatch && !currentRecord.studentName) {
          currentRecord.studentName = nameMatch[1].trim();
          continue;
        }

        // Try to match USN
        const usnMatch = line.match(usnPattern);
        if (usnMatch && !currentRecord.usn) {
          currentRecord.usn = usnMatch[1].trim();
          continue;
        }

        // Try to match semester
        const semMatch = line.match(semesterPattern);
        if (semMatch && !currentRecord.semester) {
          currentRecord.semester = semMatch[1];
          continue;
        }

        // Try to match subject and marks
        const subjectMatch = line.match(subjectPattern);
        if (subjectMatch) {
          const subjectCode = subjectMatch[1];
          const subjectName = subjectMatch[2].trim();
          const marks = parseInt(subjectMatch[3]);

          if (!isNaN(marks) && marks >= 0 && marks <= 100) {
            currentRecord.subjects.push({
              subjectCode,
              subjectName,
              marks,
              grade: this.calculateGrade(marks),
              result: marks >= 40 ? 'pass' : 'fail'
            });
          }
        }
      }

      // If we found valid data, create records for each subject
      if (currentRecord.studentName || currentRecord.usn || currentRecord.subjects.length > 0) {
        // If no student name/USN found, use placeholder
        if (!currentRecord.studentName) currentRecord.studentName = 'Unknown Student';
        if (!currentRecord.usn) currentRecord.usn = `UNKNOWN-${Date.now()}`;
        if (!currentRecord.semester) currentRecord.semester = '1';

        // Create a record for each subject
        for (const subject of currentRecord.subjects) {
          records.push({
            studentName: currentRecord.studentName,
            usn: currentRecord.usn,
            semester: currentRecord.semester,
            academicYear: new Date().getFullYear().toString(),
            subjectCode: subject.subjectCode,
            subjectName: subject.subjectName,
            marks: subject.marks,
            grade: subject.grade,
            result: subject.result,
            sessionId: null // Will be set during save
          });
        }

        // If no subjects found but student info exists, create at least one record
        if (records.length === 0) {
          records.push({
            studentName: currentRecord.studentName,
            usn: currentRecord.usn,
            semester: currentRecord.semester,
            academicYear: new Date().getFullYear().toString(),
            subjectCode: 'N/A',
            subjectName: 'No Subject Found',
            marks: 0,
            grade: 'N/A',
            result: 'fail',
            sessionId: null
          });
        }
      }

      return records;
    } catch (err) {
      console.error('Error parsing marksheet data:', err);
      return [];
    }
  }

  /**
   * Calculate grade based on marks
   * @param {number} marks - Marks obtained
   * @returns {string} Grade
   */
  calculateGrade(marks) {
    if (marks >= 90) return 'A+';
    if (marks >= 80) return 'A';
    if (marks >= 70) return 'B+';
    if (marks >= 60) return 'B';
    if (marks >= 50) return 'C+';
    if (marks >= 40) return 'C';
    return 'F';
  }

  /**
   * Validate extracted data
   * @param {Array} data - Extracted data array
   * @returns {Object} Validation result
   */
  validateExtractedData(data) {
    const errors = [];
    const warnings = [];

    if (!Array.isArray(data) || data.length === 0) {
      return {
        isValid: false,
        errors: ['No data extracted'],
        warnings: []
      };
    }

    data.forEach((record, index) => {
      // Validate required fields
      if (!record.studentName || record.studentName === 'Unknown Student') {
        warnings.push(`Record ${index + 1}: Student name not detected`);
      }
      
      if (!record.usn || record.usn.startsWith('UNKNOWN')) {
        warnings.push(`Record ${index + 1}: USN not detected`);
      }

      if (!record.subjectCode || record.subjectCode === 'N/A') {
        warnings.push(`Record ${index + 1}: Subject code not detected`);
      }

      if (isNaN(record.marks) || record.marks < 0 || record.marks > 100) {
        errors.push(`Record ${index + 1}: Invalid marks value`);
      }

      if (!['pass', 'fail'].includes(record.result)) {
        errors.push(`Record ${index + 1}: Invalid result status`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      validRecords: data.filter((_, i) => !errors.some(e => e.includes(`Record ${i + 1}`)))
    };
  }

  /**
   * Clean up worker resources
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      console.log('OCR Worker terminated');
    }
  }
}

// Export singleton instance
const ocrService = new OCRService();

module.exports = ocrService;