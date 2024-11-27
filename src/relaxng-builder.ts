import * as R from './rngast';

export function elemNamed(
  elemName: string,
  ...children: R.Pattern[]
): R.ElementNamed {
  if (children.length == 0) children = [empty()];
  return { type: 'elementNamed', name: elemName, children };
}

export function elem(
  elemNameClass: R.NameClass,
  ...children: R.Pattern[]
): R.Element {
  if (children.length == 0) children = [empty()];
  return { type: 'element', children: [elemNameClass, ...children] };
}

export function empty(): R.Empty {
  return { type: 'empty' };
}
export function text(): R.Text {
  return { type: 'text' };
}

export function value(value: string): R.Value {
  return { type: 'value', value: value };
}

export function attrNamed(
  attrName: string,
  child: R.Pattern = text(),
): R.AttributeNamed {
  return { type: 'attributeNamed', name: attrName, children: [child] };
}

export function attr(
  nameClass: R.NameClass,
  child: R.Pattern = text(),
): R.Attribute {
  return { type: 'attribute', children: [nameClass, child] };
}

export function grammar(start: R.Start, defs: R.Define[]): R.Grammar {
  return { type: 'grammar', children: [start, ...defs] };
}

export function start(child: R.Pattern): R.Start {
  return { type: 'start', children: [child] };
}

export function define(name: string, ...children: R.Pattern[]): R.Define {
  return { type: 'define', name: name, children: children };
}

export function choice(...children: R.Pattern[]): R.Choice {
  return { type: 'choice', children: children };
}

export function group(...children: R.Pattern[]): R.Group {
  return { type: 'group', children: children };
}

export function oneOrMore(...children: R.Pattern[]): R.OneOrMore {
  return { type: 'oneOrMore', children: children };
}

export function zeroOrMore(...children: R.Pattern[]): R.ZeroOrMore {
  return { type: 'zeroOrMore', children: children };
}

export function interleave(...children: R.Pattern[]): R.Interleave {
  return { type: 'interleave', children: children };
}

export function mixed(...children: R.Pattern[]): R.Mixed {
  return { type: 'mixed', children: children };
}

export function ref(name: string): R.Ref {
  return { type: 'ref', name: name };
}

export function optional(...children: R.Pattern[]): R.Optional {
  return { type: 'optional', children: children };
}

function isDataType(s: string): s is R.DataType {
  return ['integer', 'double', 'string'].includes(s);
}

export function data(dataType: string): R.Data {
  if (!isDataType(dataType)) throw new Error(`Unknown data type: ${dataType}`);
  return { type: 'data', dataType: dataType };
}

export function name(name: string): R.NameClass {
  return { type: 'name', name: name };
}
export function notAllowed(): import('unist').Node {
  return { type: 'notAllowed' };
}
