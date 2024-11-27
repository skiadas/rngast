// Attempt at validator for Pretext Documents using RelaxNG

import { Element, ElementContent, XastNode as XastNode } from 'xast';
import {
  Define,
  Grammar,
  Pattern,
  RngRoot as RngAstRoot,
  Start,
} from './rngast';

export const expected = {
  text: (found: string) => `Expected text but found ${found}`,
  noText: () => `Unexpected text in element`,
  elem: (name: string, found: string) =>
    `Expected element ${name} but found ${found}`,
  attr: (name: string) => `Expected attribute: ${name}`,
  attrText: (name: string, found: string) =>
    `Expected attribute value for ${name} to be text but was ${found}`,
  noChildren: (numMissed: number) =>
    `Expected no contents but found ${numMissed} children`,
  unexpectedElem: (name: string) => `Unexpected element: ${name}`,
  noMatch: () => 'Could not find matching choice',
};

// Reopen the xast Data interface to add a validation entry
declare module 'xast' {
  interface Data {
    validation?: Problem[];
  }
}

// Identifies a problem at a particular node
type Problem = string;
// A problem situated at a node
type ProblemNode = [XastNode, Problem];
// Indicates whether a particular rule was applicable
// at the given tag
type Applicable = boolean;
// The "context" of the recursive call. At any given time the
// validator is trying to match an array of ElementContent
// and a set of attributes on the parent node against an
// array of specifications.
type Context = [Element['children'], Element['attributes']];
// The result of validation of an array of patterns against
// a context. The triple indicates:
// - whether the top level matches are possible
// - problems associated with the top level matches
// - Any context that remained unmatched in the process
type ValidationResult = [Applicable, Problem[], Context];

function addProblems(target: XastNode, problems: Problem[]) {
  target.data ||= { validation: [] };
  target.data.validation ||= [];
  target.data.validation.push(...problems);
}

function endValidationOnNode(el: Element, result: ValidationResult) {
  const [, innerProbs1, ctx] = result;
  const innerProbs2 = unexpected(ctx);
  addProblems(el, innerProbs1);
  addProblems(el, innerProbs2);
}

function allGood(ctx: Context = [[], {}]): ValidationResult {
  return [true, [], ctx];
}
function invalid(ctx: Context, problem: Problem): ValidationResult {
  return [false, [problem], ctx];
}

function elemCtx(el: Element): Context {
  return [el.children, el.attributes];
}
// Combine results that are assumed to happen consecutively. The
// assumption is that each step continued where the last step left off
// - AND the Applicable parts
// - Join the problems
// - Last context remains
function concat2(
  result1: ValidationResult,
  result2: ValidationResult,
): ValidationResult {
  const [ok1, probs1] = result1;
  const [ok2, probs2, ctx2] = result2;
  return [ok1 && ok2, [...probs1, ...probs2], ctx2];
}

function concat(...results: ValidationResult[]): ValidationResult {
  if (results.length == 0) return allGood();
  return results.reduce(concat2);
}

function fallback(...options: (() => ValidationResult)[]): ValidationResult {
  let result: ValidationResult | undefined = undefined;
  for (const opt of options) {
    result = opt();
    const [ok] = result;
    if (ok) return result;
  }
  // Perhaps we can handle the case of no match better?
  if (!result) throw new Error('Fallback should have at least one case');
  return result;
}

// Chains a sequence of steps: Each step's result context is
// used as the context for the next step. Problems are collected.
function chain(
  initialCtx: Context,
  ...steps: ((ctx: Context) => ValidationResult)[]
): ValidationResult {
  let ctx = initialCtx;
  let result: ValidationResult | undefined = undefined;
  for (const step of steps) {
    result = result == undefined ? step(ctx) : concat2(result, step(ctx));
    const [, , newCtx] = result;
    ctx = newCtx;
  }
  return result!;
}

// Chains a sequence of steps: Each step's result context is
// used as the context for the next step. Problems are collected.
// Stops early if a step fails
function chainIfOk(
  initialCtx: Context,
  ...steps: ((ctx: Context) => ValidationResult)[]
): ValidationResult {
  let ctx = initialCtx;
  let result: ValidationResult | undefined = undefined;
  for (const step of steps) {
    result = result == undefined ? step(ctx) : concat2(result, step(ctx));
    const [ok, , newCtx] = result;
    if (!ok) return result;
    ctx = newCtx;
  }
  return result!;
}

// Collects the problems from current node and recurse if asked
export function collectProblems(
  node: XastNode,
  recursive: boolean = true,
): ProblemNode[] {
  const nodeProblems: ProblemNode[] = (node.data?.validation || []).map((p) => [
    node,
    p,
  ]);
  if (recursive && 'children' in node && Array.isArray(node.children)) {
    return [
      ...nodeProblems,
      ...node.children.flatMap((ch) => collectProblems(ch, recursive)),
    ];
  }
  return nodeProblems;
}

// Add problem message. This is called when no other specs
// are to be processed but there are still elements unaccounted for
function unexpected(ctx: Context): Problem[] {
  const [children, attrs] = ctx;
  const keys = Object.keys(attrs);
  return [
    ...keys.map((k) => `Unexpected attribute: ${k}`),
    ...children
      .map((ch) => {
        switch (ch.type) {
          case 'element':
            return expected.unexpectedElem(ch.name);
          case 'text':
            return expected.noText();
          default:
            return '';
        }
      })
      .filter((p) => p != ''),
  ];
}

// Creates a validator for the provided Relax NG spec
export class RelaxNgValidator {
  grammar: Grammar;
  specStart: Start;
  defs: Record<string, Define>;

  constructor(spec: RngAstRoot) {
    // TODO: Fix this "as"
    this.grammar = spec.children[0] as Grammar;
    const [specStart, ...defs] = this.grammar.children;
    if (specStart.type !== 'start')
      throw new Error('Grammar should begin with start');
    this.specStart = specStart;
    for (const def of defs) {
      if (def.type !== 'define')
        throw new Error('Should not have multiple starts');
    }
    this.defs = {};
    (defs as Define[]).forEach(this.addDef.bind(this));
  }
  addDef(def: Define) {
    this.defs[def.name] = def;
  }
  // Validate a given xml node against the specification described in
  // A given Relax NG definition
  // Side-effect: Sets the target.data.validation entry for target
  // and descendants with problems that apply to the each element
  // A response of true means this element is plausible but might have
  // some problems
  validateNode(target: XastNode, spec: Pattern): Applicable {
    const result = this.validateDetails(
      [[target as ElementContent], {}],
      [spec],
    );
    endValidationOnNode(target as Element, result);
    return result[0];
  }

  private _getRef(name: string) {
    if (!(name in this.defs)) {
      throw new Error(`Referencing unknown definition: ${name}`);
    }
    return this.defs[name].children;
  }
  private _getRefSingle(name: string) {
    if (!(name in this.defs)) {
      throw new Error(`Referencing unknown definition: ${name}`);
    }
    if (this.defs[name].children.length > 1) {
      throw new Error('Unsure how to apply definition with multiple patterns');
    }
    return this.defs[name].children[0];
  }

  // Helper that validates the children and attributes of a target node
  // against an array of specifications
  // Returns problems that pertain to the target itself
  // - children: The remaining children that haven't been matched yet
  // - attrs: The remaining attributes that haven't been matched yet
  // - specs: The remaining specs that haven't been applied yet
  validateDetails(ctx: Context, specs: Pattern[]): ValidationResult {
    const [children, attrs] = ctx;
    const [child, ...restChildren] = children;
    const [spec, ...restSpecs] = specs;

    if (spec == undefined) return allGood(ctx);

    switch (spec.type) {
      case 'empty':
        if (child == undefined) return allGood();
        return invalid(ctx, expected.noChildren(children.length));
      case 'text':
        if (child == undefined) {
          return concat2(
            invalid(ctx, expected.text('nothing')),
            this.validateDetails(ctx, restSpecs),
          );
        }
        if (child.type === 'text') {
          return this.validateDetails([restChildren, attrs], restSpecs);
        }
        return concat2(
          invalid(ctx, expected.text(child.type)),
          this.validateDetails(ctx, restSpecs),
        );
      case 'elementNamed':
        if (child == undefined) {
          return concat2(
            invalid(ctx, expected.elem(spec.name, 'nothing')),
            this.validateDetails(ctx, restSpecs),
          );
        }
        if (child.type !== 'element') {
          // Expected element but that's not what's here
          // We try the remaining specs to get more problems
          // May have to reconsider this and just break early
          return concat2(
            invalid(ctx, expected.elem(spec.name, child.type)),
            this.validateDetails(ctx, restSpecs),
          );
        }
        if (child.name !== spec.name) {
          // Name mismatch
          return concat2(
            invalid(ctx, expected.elem(spec.name, child.name)),
            this.validateDetails(ctx, restSpecs),
          );
        }
        // We try to match the spec's children to the node's contents
        // We note any problems in the node's data
        // Then consider this an acceptable match and continue
        endValidationOnNode(
          child,
          this.validateDetails(elemCtx(child), spec.children),
        );
        return this.validateDetails([restChildren, attrs], restSpecs);
      case 'attributeNamed':
        if (spec.name in attrs) {
          const { [spec.name]: attr, ...restAttrs } = attrs;
          return concat2(
            this.validateAttribute(spec.name, attr, spec.children[0]),
            this.validateDetails([children, restAttrs], restSpecs),
          );
        }
        return concat2(
          invalid(ctx, expected.attr(spec.name)),
          this.validateDetails(ctx, restSpecs),
        );
      case 'ref':
        return this.validateDetails(ctx, [
          ...this._getRef(spec.name),
          ...restSpecs,
        ]);
      // We attempt to use the optional. If it returns
      // an acceptable result we keep it, else we go without it
      case 'optional': {
        return fallback(
          () =>
            chain(
              ctx,
              (ctx) => this.validateDetails(ctx, spec.children),
              (ctx) => this.validateDetails(ctx, restSpecs),
            ),
          () => this.validateDetails(ctx, restSpecs),
        );
      }
      // We try each in turn, by combining it with rest.
      // Again, not ideal. It also collects all problems
      // whether they were from choice or not.
      case 'choice': {
        const allPaths = spec.children.map(
          (ch) => () =>
            chain(
              ctx,
              (ctx) => this.validateDetails(ctx, [ch]),
              (ctx) => this.validateDetails(ctx, restSpecs),
            ),
        );
        return fallback(...allPaths, () => invalid(ctx, expected.noMatch()));
      }
      // We have to choose between "using it and continuing"
      // and "not using it"
      case 'zeroOrMore':
        return fallback(
          () =>
            chainIfOk(
              ctx,
              (ctx) => this.validateDetails(ctx, spec.children),
              (ctx) => this.validateDetails(ctx, specs),
            ),
          () => this.validateDetails(ctx, restSpecs),
        );
      // Match the spec, then either the rest or all together
      case 'oneOrMore':
        return chain(
          ctx,
          (ctx) => this.validateDetails(ctx, spec.children),
          (ctx) =>
            fallback(
              () => this.validateDetails(ctx, restSpecs),
              () => this.validateDetails(ctx, specs),
            ),
        );
      case 'group':
        return this.validateDetails(ctx, [...spec.children, ...restSpecs]);
      // A zeroOrMore etc within interleave does not need to have its matches occur
      // consecutively!! This will be hard
      case 'interleave':
      default:
        throw new Error(`Unhandled validateDetails: ${spec.type}`);
    }
  }
  validateAttribute(
    attrName: string,
    attrValue: string | null | undefined,
    spec: Pattern,
  ): ValidationResult {
    switch (spec.type) {
      case 'ref':
        return this.validateAttribute(
          attrName,
          attrValue,
          expectAttrContent(this._getRefSingle(spec.name)),
        );
      case 'text':
        if (typeof attrValue == 'string') return allGood();
        return invalid([[], {}], expected.attrText(attrName, typeof attrValue));
      default:
        throw new Error(`Unhandled validateAttribute: ${spec.type}`);
    }
  }

  validate(target: XastNode): Applicable {
    // TODO: Not working well when 'root' is provided
    const [ok, problems] = this.validateDetails(
      [[target as ElementContent], {}],
      this.specStart.children,
    );
    return ok;
  }
}

// TODO: Probably redundant long-term
function expectAttrContent(content: Pattern): Pattern {
  switch (content.type) {
    case 'text':
    case 'value':
    case 'data':
    case 'choice':
    case 'ref':
      return content;
    default:
      throw new Error(`Cannot use in attribute context: ${content.type}`);
  }
}
