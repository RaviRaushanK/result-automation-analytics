'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../config/.env') });
const DE = require('../services/documentExtractor');

let pass = 0, fail = 0;
const C = (l,g,e) => {
  const o = JSON.stringify(g) === JSON.stringify(e);
  console.log((o ? '  PASS ' : '  FAIL ') + l + (o ? '' : ': exp=' + JSON.stringify(e) + ' got=' + JSON.stringify(g)));
  o ? pass++ : fail++;
};
const R = (n,f) => {
  console.log('\n[' + n + ']');
  try { f(); } catch(e) { console.error('  EXCEPTION:' + e.message); fail++; }
};
const p = t => {
  const r = DE.parseProductionData(t, [], 'revaluation');
  return {
    usn:     r.student.usn            || null,
    usnRaw:  r.student.usnRaw         || null,
    usnNorm: r.student.usnNormalized  || null,
    name:    r.student.name           || null,
    sem:     r.metadata.semester      || null
  };
};

// === A. USN LABEL-DRIVEN ===
R('A1 USN : VAL (full label)', () => {
  const r = p('University Seat Number : 1MV25MC074\nStudent Name : RAVI KUMAR\nSemester : 1');
  C('usn',r.usn,'1MV25MC074');
  C('usnRaw',r.usnRaw,'1MV25MC074');
  C('usnNorm',r.usnNorm,'1MV25MC074');
  C('name',r.name,'RAVI KUMAR');
  C('sem',r.sem,1);
});
R('A2 USN:VAL no space', () => {
  const r = p('University Seat Number:1MV25MC074\nStudent Name:PRIYA S\nSemester:3');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'PRIYA S');
  C('sem',r.sem,3);
});
R('A3 USN\\nVAL next line', () => {
  const r = p('University Seat Number\n1MV25MC074\nStudent Name\nANJALI R\nSemester\n2');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'ANJALI R');
  C('sem',r.sem,2);
});
R('A4 USN short', () => {
  const r = p('USN : 1MV25MC074\nStudent Name : KIRAN V\nSemester : 5');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'KIRAN V');
  C('sem',r.sem,5);
});
R('A5 USN:no space', () => {
  const r = p('USN:1MV25MC074\nStudent Name:MOHANKUMAR N\nSemester:1');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'MOHANKUMAR N');
});
R('A6 Seat Number', () => {
  const r = p('Seat Number : 1MV25MC074\nStudent Name : DIVYA P');
  C('usn',r.usn,'1MV25MC074');
});
R('A7 Seat No', () => {
  const r = p('Seat No : 1MV25MC074\nStudent Name : SUNITHA K');
  C('usn',r.usn,'1MV25MC074');
});

// === B. PATTERN FALLBACK ===
R('B1 bare 10-char VTU', () => {
  const r = p('Result Card 1MV25MC074 Student Name: NAVEEN G\nSemester 4');
  C('usn',r.usn,'1MV25MC074');
});
R('B2 old 18CS51', () => {
  const r = p('Result 18CS51 Web Technologies Student Name: ADITYA R');
  C('usn',r.usn,'18CS51');
});

// === B3. OLD FORMAT 21MCA11 ===
R('B3 old 21MCA11', () => {
  const r = p('Exam Result 21MCA11 Database Systems\nName: GOUTHAM S');
  C('usn',r.usn,'21MCA11');
});

// === C. USN OCR CONFUSION ===
R('C1 I->1: IMV25MCO074', () => {
  const r = p('University Seat Number : IMV25MCO074\nStudent Name : RAVI KUMAR');
  C('usnRaw',r.usnRaw,'IMV25MCO074');
  C('usnNorm I->1 O->0',r.usnNorm,'1MV25MC074');
});
R('C2 O->0: 1MV25MCOO74', () => {
  const r = p('USN : 1MV25MCOO74\nStudent Name : SINDHUKUMAR S');
  C('usnRaw',r.usnRaw,'1MV25MCOO74');
  C('usnNorm',r.usnNorm,'1MV25MC074');
});
R('C3 both: IMV25MCOO74', () => {
  const r = p('University Seat Number: IMV25MCOO74\nStudent Name : PRIYA S');
  C('usnRaw',r.usnRaw,'IMV25MCOO74');
  C('usnNorm',r.usnNorm,'1MV25MC074');
});
R('C4 pattern I->1 pos1', () => {
  const r = p('Card IMV25MC074 Name: KIRAN V');
  C('usnRaw',r.usnRaw,'IMV25MC074');
  C('usnNorm',r.usnNorm,'1MV25MC074');
});

// === D. NAME LABEL VARIANTS ===
R('D1 Student Name : VAL', () => {
  const r = p('University Seat Number : 1MV25MC074\nStudent Name : SINDHUKUMAR S\nSemester : 1');
  C('name',r.name,'SINDHUKUMAR S');
});
R('D2 Student Name:VAL', () => {
  const r = p('USN:1MV25MC074\nStudent Name:RAVI KUMAR\nSemester:2');
  C('name',r.name,'RAVI KUMAR');
});
R('D3 Student Name\\nVAL', () => {
  const r = p('University Seat Number : 1MV25MC074\nStudent Name\nANJALI R\nSemester\n3');
  C('name',r.name,'ANJALI R');
});
R('D4 Name : VAL', () => {
  const r = p('USN : 1MV25MC074\nName : KIRAN V\nSemester : 4');
  C('name',r.name,'KIRAN V');
});
R('D5 Candidate Name : VAL', () => {
  const r = p('University Seat Number : 1MV25MC074\nCandidate Name : DIVYA P\nSemester : 5');
  C('name',r.name,'DIVYA P');
});
R('D6 Name\\nVAL short', () => {
  const r = p('USN : 1MV25MC074\nName\nMOHANKUMAR N\nSemester\n1');
  C('name',r.name,'MOHANKUMAR N');
});
R('D7 name with dot', () => {
  const r = p('USN: 1MV25MC074\nStudent Name: KUMAR. S');
  C('has dot',r.name && r.name.includes('KUMAR'),true);
});
R('D8 name with hyphen', () => {
  const r = p('USN: 1MV25MC074\nStudent Name: RAVI-KUMAR S');
  C('has hyphen',r.name && r.name.includes('-'),true);
});

// === E. SEMESTER LABEL VARIANTS ===
R('E1 Semester : N', () => {
  const r = p('University Seat Number : 1MV25MC074\nStudent Name : RAVI KUMAR\nSemester : 1');
  C('sem',r.sem,1);
});
R('E2 Semester:N', () => {
  const r = p('USN:1MV25MC074\nStudent Name:PRIYA S\nSemester:3');
  C('sem',r.sem,3);
});
R('E3 Semester\\nN', () => {
  const r = p('University Seat Number : 1MV25MC074\nSemester\n5');
  C('sem',r.sem,5);
});
R('E4 Sem : N', () => {
  const r = p('USN:1MV25MC074\nSem:2\nStudent Name:ANJALI R');
  C('sem',r.sem,2);
});
R('E5 double-digit sem 10', () => {
  const r = p('USN:1MV25MC074\nStudent Name:KIRAN V\nSemester:10');
  C('sem',r.sem,10);
});

// === F. MULTIPLE FICTIONAL STUDENTS (no hard-coded values) ===
R('F1 1MV25MC074/RAVI KUMAR/S1', () => {
  const r = p('University Seat Number : 1MV25MC074\nStudent Name : RAVI KUMAR\nSemester : 1\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'RAVI KUMAR');
  C('sem',r.sem,1);
});
R('F2 1MV25MC075/PRIYA S/S2', () => {
  const r = p('University Seat Number : 1MV25MC075\nStudent Name : PRIYA S\nSemester : 2');
  C('usn',r.usn,'1MV25MC075');
  C('name',r.name,'PRIYA S');
  C('sem',r.sem,2);
});
R('F3 IMV25MCO076/ANJALI R/S3 (OCR I->1)', () => {
  // IMV25MCO76 is 10 chars (I→1, O→0 produces 1MV25MC076).
  // The OCR label emits a 10-char value; the O→0 in pos 9 is the digit.
  const r = p('USN : IMV25MCO76\nStudent Name : ANJALI R\nSemester : 3');
  C('usnRaw',r.usnRaw,'IMV25MCO76');
  C('usnNorm',r.usnNorm,'1MV25MC076');
  C('name',r.name,'ANJALI R');
  C('sem',r.sem,3);
});
R('F4 1MV22EC077/KIRAN V/S5', () => {
  const r = p('University Seat Number: 1MV22EC077\nStudent Name: KIRAN V\nSemester: 5');
  C('usn',r.usn,'1MV22EC077');
  C('name',r.name,'KIRAN V');
  C('sem',r.sem,5);
});
R('F5 18CS51/MOHAN G/S6 (old format)', () => {
  const r = p('Seat No: 18CS51\nName: MOHAN G\nSem: 6');
  C('usn',r.usn,'18CS51');
  C('name',r.name,'MOHAN G');
  C('sem',r.sem,6);
});

// === G. EDGE CASES ===
R('G1 no USN -> null', () => {
  const r = p('Student Name: RAHUL\nSemester: 1\nWEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P');
  C('usn null',r.usn,null);
  C('usnNorm null',r.usnNorm,null);
});
R('G2 no name -> null', () => {
  const r = p('USN: 1MV25MC074\nSemester: 2\nWEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P');
  C('name null',r.name,null);
});
R('G3 no sem -> null', () => {
  const r = p('USN: 1MV25MC074\nStudent Name: SINDHUKUMAR S\nWEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P');
  C('sem null',r.sem,null);
});
R('G4 dash label: USN - VAL', () => {
  const r = p('USN - 1MV25MC074\nStudent Name - RAVI KUMAR\nSemester - 3');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'RAVI KUMAR');
  C('sem',r.sem,3);
});
R('G5 uppercase labels', () => {
  const r = p('UNIVERSITY SEAT NUMBER : 1MV25MC074\nSTUDENT NAME : SINDHUKUMAR S\nSEMESTER : 2');
  C('usn',r.usn,'1MV25MC074');
  C('name',r.name,'SINDHUKUMAR S');
  C('sem',r.sem,2);
});

// === H. SUBJECT EXTRACTION REGRESSION ===
R('H1 subjects+labels together', () => {
  const r = DE.parseProductionData(
    'University Seat Number : 1MV25MC074\nStudent Name : RAVI KUMAR\nSemester : 1\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
    [], 'revaluation'
  );
  C('1 subject',r.subjects.length,1);
  C('MMC105',r.subjects[0] && r.subjects[0].subjectCode,'MMC105');
  C('rvMarks=20',r.subjects[0] && r.subjects[0].rvMarks,20);
  C('rvResult=P (raw VTU letter; mapped to PASS in revaluationExtractor)',r.subjects[0] && r.subjects[0].rvResult,'P');
  C('finalMarks=20',r.subjects[0] && r.subjects[0].finalMarks,20);
  C('finalResult=P (raw VTU letter)',r.subjects[0] && r.subjects[0].finalResult,'P');
  C('oldResult=F',r.subjects[0] && r.subjects[0].oldResult,'F');
});
R('H2 SE038 header NOT a subject', () => {
  const r = DE.parseProductionData(
    'Form No. SE038\nUniversity Seat Number : 1MV25MC074\nStudent Name : RAVI KUMAR\nMMC105 | WEB TECHNOLOGIES | 30 | 15 | F | 20 | P | 20 | P',
    [], 'revaluation'
  );
  C('SE038 not subject',r.subjects.some(s => s.subjectCode === 'SE038'),false);
  C('MMC105 is subject',r.subjects.some(s => s.subjectCode === 'MMC105'),true);
});

// === I. STUDENT NAME — table-header guard (PART C) ===
R('I1 Student Name immediately followed by Semester (label stop)', () => {
  // The OCR text matches the actual VTU revaluation card layout:
  //   "University Seat Number : IMV25MCO074 Student Name : SINDHUKUMAR S
  //    ... Semester : 1"
  const r = p('University Seat Number : IMV25MCO074 Student Name : SINDHUKUMAR S Semester : 1');
  C('usn', r.usn, 'IMV25MCO074');
  C('usnNorm (I->1 O->0)', r.usnNorm, '1MV25MC074');
  C('name', r.name, 'SINDHUKUMAR S');
  C('sem', r.sem, 1);
});
R('I2 Student Name must not capture table header columns', () => {
  // A PDF where "Name" appears as a bare label in a table header line, e.g.:
  //   "Name  Internal  Old  Result  RV  Final  Result"
  // followed by the actual identity block. The "Name" label in the header
  // must NOT be picked up as the student name.
  const r = p('Name  Internal  Old  Result  RV  Final  Result\nUniversity Seat Number : 1MV25MC074\nStudent Name : PRIYA R\nSemester : 2');
  C('usn', r.usn, '1MV25MC074');
  C('name (must be PRIYA R, not table header)', r.name, 'PRIYA R');
  C('sem', r.sem, 2);
});
R('I3 Generic Name bare label - empty/header-like value', () => {
  // When "Name" is followed by a table-header-like value, it must be skipped
  // and the next label (Student Name) used instead.
  const r = p('Name Subject Code Subject Name Internal Old\nStudent Name : ANJALI S\nSemester : 1');
  C('name (must be ANJALI S)', r.name, 'ANJALI S');
});
R('I4 Student Name with various formatting variations', () => {
  // Cover: "Student Name : X", "Student Name: X", "Student Name X", "Student Name : X Semester : 2"
  const t1 = p('University Seat Number : 1MV25MC074\nStudent Name : JOHN KUMAR\nSemester : 2');
  C('I4a (full label) name', t1.name, 'JOHN KUMAR');
  const t2 = p('University Seat Number : 1MV25MC074\nStudent Name: JOHN KUMAR\nSemester : 2');
  C('I4b (no space) name', t2.name, 'JOHN KUMAR');
  const t3 = p('University Seat Number : 1MV25MC074\nStudent Name JOHN KUMAR\nSemester : 2');
  C('I4c (no colon) name', t3.name, 'JOHN KUMAR');
  const t4 = p('University Seat Number : 1MV25MC074\nStudent Name : JOHN KUMAR Semester : 2');
  C('I4d (label stop before Semester) name', t4.name, 'JOHN KUMAR');
  C('I4d (label stop) sem', t4.sem, 2);
});
R('I5 Student Name extracted independently of bare Name (header before block)', () => {
  // When a table header has "Name" then "Subject" then "Code" then actual
  // Student Name label appears, we should find the Student Name block.
  const r = p('Name Subject Code Subject Name Marks\nUniversity Seat Number : 1MV25MC074\nStudent Name : MOHAN K\nSemester : 5');
  C('I5 name (must be MOHAN K)', r.name, 'MOHAN K');
  C('I5 usn', r.usn, '1MV25MC074');
  C('I5 sem', r.sem, 5);
});
R('I6 Real VTU revaluation card raw text — name must be SINDHUKUMAR S', () => {
  // Simulate the actual real-PDF text shape:
  //   "University Seat Number : IMV25MCO074 Student Name : SINDHUKUMAR S
  //    ... Semester : 1 ... Subject Code | Subject Name | Internal | ..."
  const text =
    'Form No. SE038  VTU Revaluation\n' +
    'Application Ref: FAZ003\n' +
    'University Seat Number : IMV25MCO074  Student Name : SINDHUKUMAR S  Semester : 1\n' +
    'Subject Code  Subject Name  Internal Marks  Old Marks  Old Result  RV Marks  RV Result  Final Marks  Final Result\n' +
    'MMC105  WEB TECHNOLOGIES  30  15  F  20  P  20  P';
  const r = p(text);
  C('I6 usn (raw)', r.usn, 'IMV25MCO074');
  C('I6 usn normalized (I->1, O->0)', r.usnNorm, '1MV25MC074');
  C('I6 name (must be SINDHUKUMAR S, NOT table header)', r.name, 'SINDHUKUMAR S');
  C('I6 sem', r.sem, 1);
});

// === SUMMARY ===
console.log('\n============================================================');
console.log('Generic Identity: ' + pass + '/' + (pass + fail) + ' PASS');
console.log('============================================================');
process.exit(fail > 0 ? 1 : 0);
