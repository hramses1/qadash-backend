const fs = require('fs');
const path = require('path');

const DELIMS = [
  { char: '\t', name: 'tab' },
  { char: ';', name: 'semicolon' },
  { char: ',', name: 'comma' },
  { char: '|', name: 'pipe' }
];

function splitLines(content) {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .filter(l => l.trim().length > 0);
}

// Score a delimiter: lines must split into >1 column with a consistent column count.
function scoreDelimiter(lines, char) {
  const counts = lines.map(l => l.split(char).length).filter(n => n > 1);
  if (counts.length === 0) return { score: 0, columns: 0 };
  const mode = {};
  for (const n of counts) mode[n] = (mode[n] || 0) + 1;
  let best = 0, bestCols = 0;
  for (const [cols, freq] of Object.entries(mode)) {
    if (freq > best) { best = freq; bestCols = Number(cols); }
  }
  // score = how many lines share the dominant column count
  return { score: best / lines.length, columns: bestCols };
}

function looksKeyValue(lines) {
  const kv = lines.filter(l => /^[^:]{1,60}:\s*.*$/.test(l)).length;
  return kv / lines.length >= 0.6;
}

// Parse one file → { rows: [{...}], columns: Set-like array }
function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const lines = splitLines(content);
  if (lines.length === 0) return { rows: [], columns: [] };

  // 1) Best delimiter
  let bestDelim = null, bestScore = 0, bestCols = 0;
  for (const d of DELIMS) {
    const { score, columns } = scoreDelimiter(lines, d.char);
    if (columns > 1 && score > bestScore) {
      bestScore = score; bestDelim = d.char; bestCols = columns;
    }
  }

  // Delimited mode: confident if a delimiter splits most lines consistently
  if (bestDelim && bestScore >= 0.6 && bestCols > 1) {
    return parseDelimited(lines, bestDelim, fileName);
  }

  // 2) Key:value mode (one record per file)
  if (looksKeyValue(lines)) {
    return parseKeyValue(lines, fileName);
  }

  // 3) Plain text: one row per line
  return parsePlain(lines, fileName);
}

function parseDelimited(lines, delim, fileName) {
  const header = lines[0].split(delim).map(h => h.trim());
  // Heuristic: if header cells look like data (all numeric), synthesize column names
  const headerIsData = header.every(h => h !== '' && !isNaN(Number(h)));
  let cols, dataLines;
  if (headerIsData) {
    cols = header.map((_, i) => `col_${i + 1}`);
    dataLines = lines;
  } else {
    cols = header.map((h, i) => h || `col_${i + 1}`);
    dataLines = lines.slice(1);
  }
  const rows = dataLines.map(line => {
    const cells = line.split(delim);
    const row = { _archivo: fileName };
    cols.forEach((c, i) => { row[c] = (cells[i] ?? '').trim(); });
    return row;
  });
  return { rows, columns: ['_archivo', ...cols] };
}

function parseKeyValue(lines, fileName) {
  const row = { _archivo: fileName };
  const cols = [];
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    if (!cols.includes(key)) cols.push(key);
    row[key] = val;
  }
  return { rows: [row], columns: ['_archivo', ...cols] };
}

function parsePlain(lines, fileName) {
  const rows = lines.map((line, i) => ({
    _archivo: fileName,
    _linea: i + 1,
    contenido: line.trim()
  }));
  return { rows, columns: ['_archivo', '_linea', 'contenido'] };
}

// Read folder, parse all .txt, unify into one table (column union).
function parseFolder(folderPath) {
  if (!folderPath) throw new Error('No se ha configurado la carpeta de archivos .txt');
  if (!fs.existsSync(folderPath)) throw new Error('La carpeta no existe: ' + folderPath);
  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) throw new Error('La ruta no es una carpeta: ' + folderPath);

  const txtFiles = fs.readdirSync(folderPath)
    .filter(f => f.toLowerCase().endsWith('.txt'))
    .sort();

  const allRows = [];
  const colOrder = [];
  const seenCols = new Set();
  const addCol = c => { if (!seenCols.has(c)) { seenCols.add(c); colOrder.push(c); } };

  const errors = [];
  for (const f of txtFiles) {
    try {
      const { rows, columns } = parseFile(path.join(folderPath, f));
      columns.forEach(addCol);
      allRows.push(...rows);
    } catch (e) {
      errors.push({ file: f, error: e.message });
    }
  }

  // Ensure meta columns lead
  const meta = ['_archivo', '_linea'].filter(c => seenCols.has(c));
  const rest = colOrder.filter(c => !meta.includes(c));
  const columns = [...meta, ...rest];

  // Normalize rows so every row has every column
  const rows = allRows.map(r => {
    const out = {};
    for (const c of columns) out[c] = r[c] ?? '';
    return out;
  });

  return { folder: folderPath, files: txtFiles, fileCount: txtFiles.length, columns, rows, errors };
}

module.exports = { parseFolder, parseFile };
