import { visit } from 'unist-util-visit';
import { Pattern, RngRoot as RelaxNgRoot } from './rngast';
import * as b from './relaxng-builder';
import { Root as XastRoot, XastNode, Element, ElementContent } from 'xast';
import { fromXml } from 'xast-util-from-xml';

// HELPERS
function ensureAttr(el: Element, key: string, message: string): string {
  if (typeof el.attributes[key] !== 'string') throw new Error(message);
  return el.attributes[key];
}

function ensureAtMostOneChild(el: Element, message: string) {
  if (el.children.length === 0) return undefined;
  if (el.children.length > 1) throw new Error(message);
  return el.children[0];
}

export function removeWhiteSpaceNodes(tree: XastRoot) {
  const isValid = (ch: ElementContent) =>
    ch.type !== 'text' || ch.value.trim() != '';
  const filterChildren = (node: XastNode) => {
    if ('children' in node && Array.isArray(node.children)) {
      node.children = node.children.filter(isValid);
    }
  };
  visit(tree, (n: XastNode) => n.type != 'text', filterChildren);
}

export function removeDocumentationNodes(tree: XastRoot) {
  const isValid = (ch: XastNode) =>
    ch.type == 'element' && (ch as Element).name != 'a:documentation';
  const filterChildren = (node: XastNode) => {
    if ('children' in node && Array.isArray(node.children)) {
      node.children = node.children.filter(isValid);
    }
  };
  visit(tree, (n: XastNode) => n.type == 'element', filterChildren);
}

export function dropPositions(tree: XastRoot) {
  visit(tree, (node) => {
    delete node.position;
  });
}

export function parsePreTextSpec(specData: string): RelaxNgRoot {
  const tree = fromXml(specData);
  removeWhiteSpaceNodes(tree);
  removeDocumentationNodes(tree);
  dropPositions(tree);
  if (tree.children[0].type == 'instruction') {
    tree.children.splice(0, 1);
  }
  return convertXastToRngAst(tree);
}

// Converts the simplified tree from parsePreTextSpec into
// a RelaxNgRoot tree.
export function convertXastToRngAst(tree: XastRoot): RelaxNgRoot {
  const child = tree.children[0];
  if (child.type !== 'element')
    throw new Error('top element must be a grammar element');
  return { type: 'root', children: [convertToGrammarElement(child)] };
}

function convertToGrammarElement(node: Element) {
  const [start, ...defs] = node.children;
  return b.grammar(
    convertToStart(start),
    defs.map((def) => convertToDef(def)),
  );
}

function convertToStart(node: ElementContent) {
  if (node.type !== 'element' || node.name !== 'start')
    throw new Error('Grammar must begin with <start>');
  return b.start(convertPatternNode(node.children[0]));
}

function convertToDef(node: ElementContent) {
  if (node.type !== 'element' || node.name !== 'define')
    throw new Error('Grammar must consist of <start> and <define>s only.');
  const name = node.attributes.name;
  if (typeof name !== 'string')
    throw new Error('Each <define> must have a @name');
  return b.define(name, ...node.children.map((nd) => convertPatternNode(nd)));
}

function convertPatternNode(node: XastNode): Pattern {
  if (node.type !== 'element')
    throw new Error(`Expected an element but found ${node.type}`);
  const el = node as Element;
  switch (el.name) {
    case 'empty':
      return b.empty();
    case 'text':
      return b.text();
    case 'value':
      return convertToValue(el);
    case 'ref':
      return convertToRef(el);
    case 'choice':
      return b.choice(...el.children.map(convertPatternNode));
    case 'group':
      return b.group(...el.children.map(convertPatternNode));
    case 'oneOrMore':
      return b.oneOrMore(...el.children.map(convertPatternNode));
    case 'zeroOrMore':
      return b.zeroOrMore(...el.children.map(convertPatternNode));
    case 'interleave':
      return b.interleave(...el.children.map(convertPatternNode));
    case 'mixed':
      return b.mixed(...el.children.map(convertPatternNode));
    case 'element':
      return b.elemNamed(
        ensureAttr(el, 'name', 'Element elements must have name'),
        ...el.children.map(convertPatternNode),
      );
    case 'optional':
      return b.optional(...el.children.map(convertPatternNode));
    case 'attribute':
      return b.attrNamed(
        ensureAttr(el, 'name', 'Attribute elements must have name'),
        convertAttributeContent(
          ensureAtMostOneChild(el, 'Attribute must contain at most one child'),
        ),
      );
    default:
      throw new Error(`unknown pattern: ${el.name}`);
  }
}

function convertAttributeContent(node?: XastNode) {
  if (node == undefined) return undefined;
  if (node.type !== 'element')
    throw new Error('Attribute content must be element');
  const el = node as Element;
  switch (el.name) {
    case 'choice':
      return b.choice(...el.children.map(convertPatternNode));
    case 'value':
      return convertToValue(el);
    case 'ref':
      return convertToRef(el);
    case 'text':
    case 'data':
      return b.data(ensureAttr(el, 'type', 'Data elements must have @type'));
    default:
      throw new Error(`Invalid node type ${el.name}`);
  }
}

function convertToRef(el: Element) {
  return b.ref(ensureAttr(el, 'name', 'Ref elements must have name.'));
}

function convertToValue(el: Element) {
  if (el.children.length == 0) return b.value('');
  if (el.children[0].type !== 'text')
    throw new Error('Value elements should have single text node');
  return b.value(el.children[0].value);
}
