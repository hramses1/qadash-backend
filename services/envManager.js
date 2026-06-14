const fs = require('fs');

function readEnv(envPath) {
  const content = fs.readFileSync(envPath, 'utf-8');
  const vars = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      vars.push({ key: '', value: '', comment: line, isComment: true });
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      vars.push({ key: trimmed, value: '', isComment: false });
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars.push({ key, value, isComment: false });
  }

  return vars;
}

function writeEnv(envPath, vars) {
  const lines = vars
    .filter(v => v.key || v.isComment)
    .map(v => {
      if (v.isComment) return v.comment;
      // Quote values containing spaces or special chars
      const val = v.value.includes(' ') ? `"${v.value}"` : v.value;
      return `${v.key}=${val}`;
    });

  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

module.exports = { readEnv, writeEnv };
