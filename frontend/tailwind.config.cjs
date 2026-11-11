const fs = require('node:fs');
const path = require('node:path');
const preset = require('../theme/tailwind.preset.js');

function collectContentFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      collectContentFiles(full, out);
    } else if (entry.isFile() && /\.(html|tsx|ts|jsx|js)$/.test(entry.name)) {
      out.push({
        raw: fs.readFileSync(full, 'utf8'),
        extension: path.extname(entry.name).slice(1) || 'tsx',
      });
    }
  }
  return out;
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: collectContentFiles(__dirname),
};
