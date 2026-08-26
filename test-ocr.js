const Tesseract = require('tesseract.js');

async function test() {
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: message => {
      console.log('Tesseract:', message);
    }
  });

  const imagePath =
    './uploads/results/result_1787588978582_Ravi_1st_sem_MCA__h804on.jpeg';

  const { data } = await worker.recognize(
    imagePath,
    {},
    {
      tsv: true,
      hocr: true,
      blocks: true
    }
  );

  // ============================================
  // PARSE TSV INTO WORD OBJECTS
  // ============================================
  const tsv = data.tsv;
  const lines = tsv
    .split('\n')
    .slice(1)
    .map(line => line.split('\t'))
    .filter(row => row[0] === '5' && row.length >= 12);

  const words = lines.map(row => ({
    level: Number(row[0]),
    page: Number(row[1]),
    block: Number(row[2]),
    paragraph: Number(row[3]),
    line: Number(row[4]),
    word: Number(row[5]),
    left: Number(row[6]),
    top: Number(row[7]),
    width: Number(row[8]),
    height: Number(row[9]),
    confidence: Number(row[10]),
    text: row[11].trim()
  }));

  // Group words by OCR line
  const groupedLines = {};
  for (const word of words) {
    if (!groupedLines[word.line]) {
      groupedLines[word.line] = [];
    }
    groupedLines[word.line].push(word);
  }
  for (const line in groupedLines) {
    groupedLines[line].sort((a, b) => a.left - b.left);
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  function isSubjectCode(text) {
    if (!text) return false;
    const value = text.replace(/\|/g, '').trim().toUpperCase();
    return /^MMC[A-Z0-9]{3,4}$/.test(value);
  }

  function cleanSubjectCode(text) {
    if (!text) return null;
    let value = text.replace(/\|/g, '').trim().toUpperCase();
    // Common OCR mistakes
    value = value.replace(/^MMCI0S$/, 'MMC105');
    return value;
  }

  const COLUMN = {
    CODE: { min: 0, max: 140 },
    NAME: { min: 140, max: 340 },
    INTERNAL: { min: 340, max: 400 },
    EXTERNAL: { min: 400, max: 460 },
    TOTAL: { min: 460, max: 520 },
    RESULT: { min: 520, max: 575 },
    ANNOUNCED: { min: 575, max: 700 }
  };

  function inRange(x, range) {
    return x >= range.min && x < range.max;
  }

  function mergeDigitsFromRange(words, range) {
    const nums = words
      .filter(w => inRange(w.left, range) && /^\d+$/.test(w.text))
      .map(w => w.text);
    if (nums.length === 0) return null;
    const merged = nums.join('');
    return /^\d+$/.test(merged) ? parseInt(merged, 10) : null;
  }

  function cleanTableValue(text) {
    if (!text) return null;
    let value = text.replace(/\|/g, '').trim();
    // OCR corrections
    value = value
      .replace(/^El$/i, '31')
      .replace(/^a0$/i, '40')
      .replace(/^Ig$/i, '19')
      .replace(/^a$/i, '33');
    return value;
  }

  function isResult(text) {
    return /^[PFAW]$/i.test(text);
  }

  // ============================================
  // BUILD SUBJECT ROWS
  // ============================================
  const resultRows = [];
  let currentRow = null;

  for (const lineNumber of Object.keys(groupedLines)) {
    const line = Number(lineNumber);
    if (line < 15 || line > 26) continue;

    const rowWords = groupedLines[line];
    const codeWord = rowWords.find(
      word => word.left < 140 && isSubjectCode(word.text)
    );

    if (codeWord) {
      if (currentRow) resultRows.push(currentRow);
      currentRow = {
        subjectCode: cleanSubjectCode(codeWord.text),
        subjectName: [],
        internal: null,
        external: null,
        total: null,
        result: null,
        announced: null
      };
    }

    if (!currentRow) continue;

    // Subject name, result, announced
    for (const word of rowWords) {
      const x = word.left;
      const text = cleanTableValue(word.text);
      if (word === codeWord || !text || text.includes('|')) continue;

      if (inRange(x, COLUMN.NAME)) {
        currentRow.subjectName.push(text);
      } else if (inRange(x, COLUMN.RESULT) && isResult(text)) {
        currentRow.result = text.toUpperCase();
      } else if (inRange(x, COLUMN.ANNOUNCED)) {
        currentRow.announced = text;
      }
    }

    // Marks with hybrid extraction
    currentRow.internal =
      mergeDigitsFromRange(rowWords, COLUMN.INTERNAL) ||
      rowWords.find(w => {
        const val = cleanTableValue(w.text);
        return inRange(w.left, COLUMN.INTERNAL) && /^\d+$/.test(val);
      })?.text || null;

    currentRow.external =
      mergeDigitsFromRange(rowWords, COLUMN.EXTERNAL) ||
      rowWords.find(w => {
        const val = cleanTableValue(w.text);
        return inRange(w.left, COLUMN.EXTERNAL) && /^\d+$/.test(val);
      })?.text || null;

    currentRow.total =
      mergeDigitsFromRange(rowWords, COLUMN.TOTAL) ||
      rowWords.find(w => {
        const val = cleanTableValue(w.text);
        return inRange(w.left, COLUMN.TOTAL) && /^\d+$/.test(val);
      })?.text || null;

    // Correction step
    if (currentRow.internal !== null && currentRow.external !== null) {
      const recomputed =
        parseInt(currentRow.internal, 10) + parseInt(currentRow.external, 10);
      if (currentRow.total === null || parseInt(currentRow.total, 10) !== recomputed) {
        currentRow.total = recomputed;
        currentRow.corrected = true;
      }
    }
  }

  if (currentRow) resultRows.push(currentRow);

  // ============================================
  // DEBUG OUTPUT
  // ============================================
  console.log('\nMARK DEBUG');
  for (const row of resultRows) {
    console.log(
      `${row.subjectCode} Internal: ${row.internal} External: ${row.external} Total: ${row.total}`
    );
  }

  // Combine multi-line subject names
  for (const row of resultRows) {
    row.subjectName = row.subjectName.join(' ').replace(/\s+/g, ' ').trim();
  }

  console.log('\n==============================');
  console.log('EXTRACTED RESULT TABLE');
  console.log('==============================');
  console.dir(resultRows, { depth: null });

  await worker.terminate();
}

test();