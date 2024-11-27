import { expect, test, describe } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { x } from 'xastscript';
import { XastNode } from 'xast';
import { fromXml } from 'xast-util-from-xml';
import {
  collectProblems,
  expected,
  RelaxNgValidator,
} from '../src/rngast-validate';
import { parsePreTextSpec } from '../src/xast-to-rngast';
import * as r from '../src/relaxng-builder';
import { Pattern } from '../src/rngast';

const specPath = readFileSync(
  join(__dirname, '..', 'src', 'pretext.rng'),
  'utf-8',
);
const ptxExample = fromXml(
  readFileSync(join(__dirname, 'example.ptx'), 'utf-8'),
);

// writeFileSync(join(__dirname, '..','spec.json'), JSON.stringify(parsePreTextSpec(specPath)))

function expectErrorMatch(problems: [unknown, string][], errors: string[]) {
  problems.forEach((p) => expect(errors).toContain(p[1]));
  expect(problems.length).toEqual(errors.length);
}

describe('Validator', () => {
  const spec = parsePreTextSpec(specPath);
  const checker = new RelaxNgValidator(spec);
  function check(
    node: XastNode,
    spec: Pattern,
  ): [boolean, ReturnType<typeof collectProblems>] {
    const ok = checker.validateNode(node, spec);
    const problems = collectProblems(node);
    return [ok, problems];
  }
  test('is created', () => {
    checker.validate(ptxExample);
    expect(checker).not.toBeNull();
  });
  test('validates a basic element on its name', () => {
    const [ok, problems] = check(x('p'), r.elemNamed('p'));
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('validates a basic element on its name (wrong name)', () => {
    const [ok, problems] = check(x('p'), r.elemNamed('moo'));
    expect(ok).toBeFalsy();
    expectErrorMatch(problems, [
      expected.elem('moo', 'p'),
      expected.unexpectedElem('p'),
    ]);
  });
  test('matches the contents of basic element to empty expectation', () => {
    // Elements created by the elem constructor automatically include an <empty>
    // child restriction. So a text in the paragraph would be invalid.
    // Note that this would still report the whole node as ok, but
    // with problems inside it
    const [ok, problems] = check(x('p', 'text'), r.elemNamed('p'));
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.noChildren(1), expected.noText()]);
  });
  test('matches the contents of basic element to text expectation', () => {
    const [ok, problems] = check(x('p'), r.elemNamed('p', r.text()));
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.text('nothing')]);
  });
  test('detects if expected attribute is missing', () => {
    const [ok, problems] = check(x('p'), r.elemNamed('p', r.attrNamed('foo')));
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.attr('foo')]);
  });
  test('detects based on choice pattern and reports sub-problems', () => {
    const [ok, problems] = check(
      x('p'),
      r.choice(r.elemNamed('b'), r.elemNamed('p', r.attrNamed('foo'))),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.attr('foo')]);
  });
  test('detects using a referenced defininition', () => {
    checker.addDef(r.define('paragraph', r.elemNamed('p')));
    const [ok, problems] = check(x('p'), r.ref('paragraph'));
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test("detects using a referenced definition that doesn't match", () => {
    checker.addDef(r.define('paragraph', r.elemNamed('b')));
    const [ok, problems] = check(x('p'), r.ref('paragraph'));
    expect(ok).toBeFalsy();
    expectErrorMatch(problems, [
      expected.elem('b', 'p'),
      expected.unexpectedElem('p'),
    ]);
  });
  test('detects using a referenced definition in attribute content', () => {
    checker.addDef(r.define('textAttr', r.text()));
    const [ok, problems] = check(
      x('p', { foo: 'something' }),
      r.elemNamed('p', r.attrNamed('foo', r.ref('textAttr'))),
    );

    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers multi-step definition in child spot', () => {
    checker.addDef(
      r.define(
        'twoAttrs',
        r.attrNamed('foo', r.text()),
        r.attrNamed('bar', r.text()),
      ),
    );
    const [ok, problems] = check(
      x('p', { foo: 'something' }),
      r.elemNamed('p', r.ref('twoAttrs')),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.attr('bar')]);
  });
  test('considers multi-step definition in child spot (no errors)', () => {
    checker.addDef(
      r.define(
        'twoAttrs',
        r.attrNamed('foo', r.text()),
        r.attrNamed('bar', r.text()),
      ),
    );
    const [ok, problems] = check(
      x('p', { foo: 'something', bar: 'else' }),
      r.elemNamed('p', r.ref('twoAttrs')),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers optional in child spot', () => {
    const [ok, problems] = check(
      x('p', { bar: 'something' }),
      r.elemNamed(
        'p',
        r.optional(r.attrNamed('foo', r.text())),
        r.attrNamed('bar', r.text()),
      ),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers choice in details', () => {
    const [ok, problems] = check(
      x('p', { bar: 'something' }),
      r.elemNamed(
        'p',
        r.choice(r.attrNamed('foo', r.text()), r.attrNamed('bar', r.text())),
      ),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers choice in details (no match)', () => {
    const [ok, problems] = check(
      x('p'),
      r.elemNamed(
        'p',
        r.choice(r.attrNamed('foo', r.text()), r.attrNamed('bar', r.text())),
      ),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.noMatch()]);
  });
  test('considers a zero-or-more case (many matches)', () => {
    const [ok, problems] = check(
      x('sec', [x('p'), x('p'), x('p')]),
      r.elemNamed('sec', r.zeroOrMore(r.elemNamed('p'))),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers a zero-or-more case (no matches)', () => {
    const [ok, problems] = check(
      x('sec', [x('b')]),
      r.elemNamed('sec', r.zeroOrMore(r.elemNamed('p')), r.elemNamed('b')),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers a one-or-more case (one match)', () => {
    const [ok, problems] = check(
      x('sec', [x('p'), x('b')]),
      r.elemNamed('sec', r.oneOrMore(r.elemNamed('p')), r.elemNamed('b')),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers a one-or-more case (multiple matches)', () => {
    const [ok, problems] = check(
      x('sec', [x('p'), x('p'), x('b')]),
      r.elemNamed('sec', r.oneOrMore(r.elemNamed('p')), r.elemNamed('b')),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  test('considers a one-or-more case (no matches)', () => {
    const [ok, problems] = check(
      x('sec', [x('b')]),
      r.elemNamed('sec', r.oneOrMore(r.elemNamed('p')), r.elemNamed('b')),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, [expected.elem('p', 'b')]);
  });
  test('considers a group case', () => {
    const [ok, problems] = check(
      x('sec', [x('p'), x('b')]),
      r.elemNamed('sec', r.group(r.elemNamed('p'), r.elemNamed('b'))),
    );
    expect(ok).toBeTruthy();
    expectErrorMatch(problems, []);
  });
  // The next test is meant to be a "catchall"
  test('works on example doc', () => {
    const ok = checker.validate(ptxExample.children[0]);
    const problems = collectProblems(ptxExample.children[0]);
    expect(ok).toBeTruthy();
    // console.log(problems);
  });
});
