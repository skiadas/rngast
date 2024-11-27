// Converts a Relax-NG grammar to a simplified form

import * as U from 'unist';
import { visit, EXIT, SKIP } from 'unist-util-visit';
import { visitParents } from 'unist-util-visit-parents';
import * as R from './rngast';
import * as S from './simple-rngast';
import * as r from './relaxng-builder';
import { selectAll } from 'unist-util-select';

// Note: Changes the root tree and simply returns it as a S.Root
// Numbering refers to spec: https://relaxng.org/spec-20011203.html#simplification
export function simplifyRngAst(tree: R.RngRoot): S.Root {
  // 4.8
  moveNameAttributeToChild(tree);
  // 4.12
  controlChildren(tree);
  // 4.13, 4.14, 4.15
  replaceMixedOptionalAndZeroOrMore(tree);
  // 4.16 skipped
  // 4.17 eliminate combine attribute
  eliminateCombineAttribute(tree);
  // 4.18 onlyOneGrammar
  ensureOnlyOneGrammarElement(tree);
  // 4.19 define and element
  canonicalDefineAndElement(tree);
  // 4.20 notAllowed only as child of start or element
  limitLocationsOfNotAllowed(tree);
  // 4.21
  avoidEmptyInGroupSpots(tree);
  // Validate
  if (S.isRoot(tree)) return tree;
  throw new Error('Not valid as simplified RelaxNG');
}

// Make sure element/attribute has nameClass child instead of name property
function moveNameAttributeToChild(three: R.RngRoot): void {
  visit(three, ['elementNamed', 'attributeNamed'], (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    if (node.type == 'elementNamed') {
      parent.children.splice(
        index,
        1,
        r.elem(r.name(node.name), ...node.children),
      );
    } else if (node.type == 'attributeNamed') {
      parent.children.splice(
        index,
        1,
        r.attr(r.name(node.name), ...node.children),
      );
    }
  });
}

// Makes sure that the following happens:
// - define, oneOrMore, zeroOrMore, optional, list or mixed have only one child
//      using group
// - element have two children (name + pattern)
// - if attribute has no non-name child add </text>
// - (n/a) multiple children of except are wrapped in choice
// - choice/group/interleave exactly two children
function controlChildren(tree: R.RngRoot): void {
  const builders = {
    group: r.group,
    interleave: r.interleave,
    choice: r.choice,
  } as const;
  visit(tree, (node, index, parent) => {
    switch (node.type) {
      case 'define':
      case 'oneOrMore':
      case 'zeroOrMore':
      case 'optional':
      case 'mixed':
        if (node.children.length > 1) {
          node.children = [r.group(...node.children)];
        }
        return;
      case 'element':
        if (node.children.length > 2) {
          const [nameClass, ...rest] = node.children;
          node.children = [nameClass, r.group(...rest)];
        }
        return;
      case 'attribute':
        if (node.children.length == 1) {
          node.children = [...node.children, r.text()];
        }
        return;
      case 'choice':
      case 'group':
      case 'interleave':
        if (index == undefined || parent == undefined) return;
        if (node.children.length == 1) {
          parent.children.splice(index, 1, node.children[0]);
        } else if (node.children.length > 2) {
          const builder = builders[node.type];
          parent.children.splice(
            index,
            1,
            node.children.reduce((p1, p2) => builder(p1, p2)),
          );
        }
        return;
    }
  });
}

// Makes sure that any mixed, optional, and zeroormore nodes get transformed away
// Node that this runs after the previous function. As such, these nodes have a single child
function replaceMixedOptionalAndZeroOrMore(tree: R.RngRoot) {
  visit(tree, ['mixed', 'optional', 'zeroOrMore'], (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    if (node.type == 'mixed') {
      const newNode = r.interleave(node.children[0], r.text());
      parent.children.splice(index, 1, newNode);
    } else if (node.type == 'optional') {
      const newNode = r.choice(node.children[0], r.empty());
      parent.children.splice(index, 1, newNode);
    } else if (node.type == 'zeroOrMore') {
      const newNode = r.choice(r.oneOrMore(node.children[0]), r.empty());
      parent.children.splice(index, 1, newNode);
    }
  });
}

function eliminateCombineAttribute(tree: R.RngRoot) {
  visit(tree, 'grammar', (node) => {
    // First collect the "define" children based on their name, and all "start" children
    // together
    const starts: R.Start[] = [];
    const definesByName = new Map<string, R.Define[]>();
    for (const child of node.children) {
      if (child.type == 'start') {
        starts.push(child);
      } else if (child.type == 'define') {
        const name = child.name;
        if (definesByName.has(name)) definesByName.get(name)?.push(child);
        else definesByName.set(name, [child]);
      }
    }
    if (starts.length == 0) {
      throw new Error('A grammar must have a start element');
    }
    const collectedStarts = combine(starts, r.start, 'start elements');
    const collectedDefines = [...definesByName.entries()].map(([k, defs]) =>
      combine(defs, (...defs) => r.define(k, ...defs), `defines for name ${k}`),
    );
    node.children = [collectedStarts, ...collectedDefines];
  });
}

// Simplifies the grammar so that only one element remains, as follows:
// 1. Start by turning top element into grammar if it isn't
// 2. Look for defines with the same name. If found, must change names:
//    - Keep track of global names. Increment to make new names when needed
//    - If name changed, look within the grammar for refs to it. Also look
//        at any next level grammars for parentRefs to it (only 1 level in)
// 3. Move all defines to top grammar
// 4. Replace each following grammar element with its start's child
// 5. Replace all parentRef with Ref
function ensureOnlyOneGrammarElement(tree: R.RngRoot) {
  const topGrammar = ensureTopLevelGrammar(tree);
  const allGrammars = selectAll('grammar', tree) as R.Grammar[];
  const names = new Set<string>();
  // Contains maps of old name to new grammar and new name
  const substitutions = new Map<string, [R.Grammar, string][]>();
  // Collect all the rename substitutions needed
  for (const parent of allGrammars) {
    for (const node of parent.children) {
      if (node.type == 'define') {
        const name = node.name;
        if (!names.has(name)) {
          names.add(name);
        } else {
          const newName = determineNewName(name, names);
          node.name = newName;
          // Store the substitution for a later pass
          if (!substitutions.has(name)) substitutions.set(name, []);
          substitutions.get(name)?.push([parent, newName]);
        }
      }
    }
  }
  // We visit all 'ref' and 'parentRef' nodes and fix them
  visitParents(tree, (node, ancestors) => {
    if (node.type != 'ref' && node.type != 'parentRef') return;
    if (!substitutions.has(node.name)) return; // No need to do work
    const grammar = findClosestGrammar(ancestors, node.type);
    const relevantSubs = substitutions.get(node.name);
    if (relevantSubs == undefined)
      throw new Error('Logic error! Should not happen.');
    for (const [gr, newName] of relevantSubs) {
      if (gr == grammar) {
        node.name = newName;
        if (node.type == 'parentRef') (node as unknown as R.Ref).type = 'ref';
        return;
      }
    }
    throw new Error(`Should have found a substitution for ${node.name}`);
  });
  // Now we need to revisit all grammars and supplant them
  visit(tree, 'grammar', (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    if (node == topGrammar || node.type != 'grammar') return;
    // Relocate all def children to top
    for (const child of node.children) {
      if (child.type == 'define') topGrammar.children.push(child);
    }
    // Replace with start's child element
    parent.children.splice(index, 1, node.children[0].children[0]);
  });
}

// Transform top grammar so that every Element is the child of a Define,
// and the child of every Define is an Element.
// 1. Remove unreachable defines
// 2. For every Element not child of define: Put a ref and create a define for it
// 3. Substitute refs whose defines are not Element, then expand within those
//      - This must not result in a loop. But we will NOT check for it.
// 4. Remove the defines that are not Element
function canonicalDefineAndElement(tree: R.RngRoot) {
  // 1. Remove defines that are unreachable
  removeUnreachableDefines(tree);
  // 2. Set all Elements as new defines.
  createDefinesForEachElement(tree);
  // 3. Substitute refs. We will assume no loops are possible
  const topGrammar = ensureTopLevelGrammar(tree);
  const definesByName = getMapOfDefines(topGrammar);
  visit(tree, 'ref', (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    if (node.type == 'ref') {
      const defineChild = definesByName.get(node.name)!.children[0];
      // Don't substitute defines that are Elements
      if (defineChild.type !== 'element')
        parent.children.splice(index, 1, defineChild);
    }
  });
  // 4. Remove defines that are not Element
  topGrammar.children = topGrammar.children.filter(
    (ch) => ch.type !== 'define' || ch.children[0].type == 'element',
  );
}

function removeUnreachableDefines(tree: R.RngRoot) {
  const topGrammar = ensureTopLevelGrammar(tree);
  const reachedNames = new Set<string>();
  const definesByName = getMapOfDefines(topGrammar);
  // We visit the tree, starting with start. The defines are only examined after start
  visit(tree, (node, index) => {
    if (node.type == 'ref' && !reachedNames.has(node.name)) {
      reachedNames.add(node.name);
      // We must move the corresponding define earlier in the list to make sure
      // reachable defines are visited first. We place it after all
      // "already marked as visited" defines
      const defineToMove = definesByName.get(node.name)!;
      const oldIndex = topGrammar.children.indexOf(defineToMove);
      const newIndex = reachedNames.size; // We count entry for start. So 1st define goes at 1
      topGrammar.children.splice(oldIndex, 1);
      topGrammar.children.splice(newIndex, 1, defineToMove);
    } else if (node.type == 'define' && !reachedNames.has(node.name)) {
      // All the defines that are reachable are visited first. If a define is not
      // reachable by now then all remaining defines are not reachable, and we can
      // remove them and end the visit. Otherwise we visit it normally. Otherwise continue as normal
      // We don't need the parent here as we know all defines are in the topGrammar
      topGrammar.children.slice(0, index);
      return EXIT;
    }
  });
}

function createDefinesForEachElement(tree: R.RngRoot) {
  const topGrammar = ensureTopLevelGrammar(tree);
  let createdCount = 0;
  visit(tree, 'element', (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    if (node.type == 'element' && parent.type != 'define') {
      // We create and add a new define. As new defines are added to
      // the end of topGrammar children, the visit algorithm will visit
      // them later. So we just need to create them here.
      createdCount += 1;
      const newName = `elem__${createdCount}`;
      topGrammar.children.push(r.define(newName, node));
      parent.children.splice(index, 1, r.ref(newName));
      // The created element will be revisited as part of the define
      // So we skip its children for now
      return SKIP;
    }
  });
}

// Eliminate notAllowed if not child of Element or Start
function limitLocationsOfNotAllowed(tree: R.RngRoot) {
  visitPostOrder(tree, (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    const replace = () => parent.children.splice(index, 1, r.notAllowed());
    const el = node as R.Content;
    switch (el.type) {
      case 'attribute':
        if (el.children[1]!.type == 'notAllowed') replace();
        break;
      // Unaccounted case: 'list'
      case 'group':
      case 'interleave':
      case 'oneOrMore':
        if (el.children.some((ch) => ch.type == 'notAllowed')) replace();
        break;
      case 'choice':
        if (el.children[0].type == 'notAllowed')
          parent.children.splice(index, 1, el.children[1]);
        else if (el.children[1].type == 'notAllowed')
          parent.children.splice(index, 1, el.children[0]);
        break;
      // Unaccounted case: 'except'
    }
  });
  // Now more defines may have become unreachable
  removeUnreachableDefines(tree);
}

// transformed so that an empty element does not occur as a child of
// a group, interleave, or oneOrMore element or as the second child of a choice element
function avoidEmptyInGroupSpots(tree: R.RngRoot) {
  visitPostOrder(tree, (node, index, parent) => {
    if (index == undefined || parent == undefined) return;
    const replace = () => parent.children.splice(index, 1, r.empty());
    const el = node as R.Content;
    switch (el.type) {
      case 'group':
      case 'interleave':
        if (el.children[0].type === 'empty')
          parent.children.splice(index, 1, el.children[1]);
        else if (el.children[1].type == 'empty')
          parent.children.splice(index, 1, el.children[0]);
        break;
      case 'choice':
        if (el.children[1].type === 'empty') {
          const temp = el.children[1];
          el.children[1] = el.children[0];
          el.children[0] = temp;
        }
        break;
      case 'oneOrMore':
        if (el.children[0].type === 'empty') replace();
    }
  });
}

// HELPERS

// Helpers for grammar collapsing
function compare(a: string | undefined, b: string | undefined): number {
  if (a == undefined) return -1;
  if (b == undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Collects items if they have the same "combine" attribute else throw error
function combine(
  items: R.Start[] | R.Define[],
  builder:
    | ((...args: R.Pattern[]) => R.Start)
    | ((...args: R.Pattern[]) => R.Define),
  errorName: string,
) {
  // We start by sorting on the combine attribute. This way multiple starts without
  // combine will be together at the start.
  items.sort((a, b) => compare(a.combine, b.combine));
  if (items.length == 0)
    throw new Error('Cannot have a grammar without a start');
  return items.reduce((p1, p2) => {
    if (p1.combine == undefined && p2.combine == undefined) {
      throw new Error(
        `Cannot have multiple ${errorName} without specifying combine`,
      );
    }
    if (p1.combine == undefined) p1.combine = p2.combine;
    if (p2.combine == undefined) p2.combine = p1.combine;
    if (p1.combine != p2.combine) {
      throw new Error(
        'Cannot have multiple ${errorName} with different combine values',
      );
    }
    const result =
      p1.combine == 'choice'
        ? builder(r.choice(p1.children[0], p2.children[0]))
        : builder(r.interleave(p1.children[0], p2.children[0]));
    result.combine = p1.combine;
    return result;
  });
}

function determineNewName(name: string, names: Set<string>) {
  // Determines a new name by continuously increasing a constant
  let n = 0;
  let newName;
  do {
    n += 1;
    newName = `${name}__${n}`;
  } while (names.has(newName));
  return newName;
}

function ensureTopLevelGrammar(tree: R.RngRoot) {
  if (tree.children.length !== 1)
    throw new Error('Must have exactly one top level element');
  if (tree.children[0].type != 'grammar')
    tree.children[0] = r.grammar(r.start(tree.children[0]), []);
  return tree.children[0];
}

function findClosestGrammar(
  ancestors: (R.RngRoot | R.Content)[],
  refType: 'ref' | 'parentRef',
): R.Grammar {
  let skip = refType == 'parentRef'; // Skip the first
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const el = ancestors[i];
    if (el.type == 'grammar') {
      if (skip) {
        skip = false;
        continue;
      }
      return el;
    }
  }
  throw new Error('Each ref or parentRef must be within a grammar');
}

function getMapOfDefines(grammar: R.Grammar) {
  const definesByName = new Map<string, R.Define>();
  const [, _defines] = grammar.children as [R.Start, Array<R.Define>];
  for (const define of _defines) definesByName.set(define.name, define);
  return definesByName;
}

// Custom unist post order visitor as none could be found
// Assumes children are never removed. If a node is replaced,
// the new node's children are not visited.
// TODO: Need to type this better so we don't have to cast in its usages
function visitPostOrder(
  tree: U.Node,
  visitor: (
    node: U.Node,
    index: number | undefined,
    parent: U.Parent | undefined,
  ) => void,
) {
  // Pass indicates how many times we've encountered the node:
  // When the node comes out with a given pass number, it means that many of its children have
  // been processed already
  type Pass = number;
  // third entry represents the parent and the node's index within the children
  const stack: [U.Node, Pass, [U.Parent, Pass] | undefined][] = [
    [tree, 0, undefined],
  ];
  while (stack.length > 0) {
    const [node, pass, parentCtx] = stack.pop()!;
    if (
      'children' in node &&
      Array.isArray(node.children) &&
      pass < node.children.length
    ) {
      // Node not ready. Must push in node and next child
      stack.push([node, pass + 1, parentCtx]);
      stack.push([node.children[pass], 0, [node as U.Parent, pass]]);
    } else {
      // all children are processed. We can visit the node
      const [parent, index] = parentCtx || [];
      visitor(node, index, parent);
    }
  }
}
