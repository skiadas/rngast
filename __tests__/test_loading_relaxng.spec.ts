import { expect, test, describe } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePreTextSpec } from '../src/xast-to-rngast';

const specPath = readFileSync(
  join(__dirname, '..', 'src', 'pretext.rng'),
  'utf-8',
);

// writeFileSync(join(__dirname, '..','spec.json'), JSON.stringify(parsePreTextSpec(specPath)))

describe('Relax NG Pretext parse syntax', () => {
  test('whole file parsed without errors', () => {
    expect(parsePreTextSpec(specPath)).not.toBeNull();
  });
});
