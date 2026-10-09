// A script's keys on this machine: the repo's .env file (gitignored; .env.example lists what goes in it),
// read into process.env if it's there. On GitHub the workflows set the same names from the repo's secrets,
// and a key already set wins over the file. Import it first: import '../env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (fs.existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}
