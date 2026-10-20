import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const file of ['plugin.json', 'mcp.json']) {
  const document = JSON.parse(await readFile(`plugins/leetcode/${file}`, 'utf8'));
  const response = await fetch(document.$schema, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Could not fetch the official ${file} schema.`);
  const validate = ajv.compile(await response.json());
  if (!validate(document)) throw new Error(`${file}: ${JSON.stringify(validate.errors)}`);
  console.log(`${file} conforms to its official Agent Plugins schema.`);
}
