// Types for the ast for an RelaxNG specification after simplification
// https://relaxng.org/spec-20011203.html#simple-syntax

import * as R from './rngast';

export interface NonEmptyPatternMap {
  text: R.Text;
  data: R.Data;
  value: R.Value;
  // Missing: list
  attribute: Attribute;
  ref: R.Ref;
  oneOrMore: OneOrMore;
  choice: Choice;
  group: Group;
  interleave: Interleave;
}

export interface NameClassMap {
  anyName: AnyName;
  name: R.Name;
  // missing: nsName
  nameChoice: NameChoice;
}

export type NonEmptyPattern = NonEmptyPatternMap[keyof NonEmptyPatternMap];
export type NameClass = NameClassMap[keyof NameClassMap];
export type Pattern = R.Empty | NonEmptyPattern;

export type Content = Grammar | Pattern | NameClass;

export interface Root extends R.Parent {
  type: 'root';
  children: [Grammar];
}

export type Grammar = R.Grammar & {
  children: [Start, ...Array<Define>];
};

export type Start = R.Start & {
  children: [R.NotAllowed | Pattern];
};

export type Define = R.Define & {
  children: [Element];
};

export type Element = R.Element & {
  children: [NameClass, Pattern | R.NotAllowed];
};

export type Attribute = R.Attribute & {
  children: [NameClass, Pattern];
};

export type OneOrMore = R.OneOrMore & {
  children: [NonEmptyPattern];
};

export type Choice = R.Choice & {
  children: [Pattern, NonEmptyPattern];
};

export type Group = R.Group & {
  children: [NonEmptyPattern, NonEmptyPattern];
};

export type Interleave = R.Interleave & {
  children: [NonEmptyPattern, NonEmptyPattern];
};

export type AnyName = R.AnyName & {
  except?: ExceptNameClass;
};

export type NameChoice = R.NameChoice & {
  children: [NameClass, NameClass];
};

export type ExceptNameClass = R.ExceptNameClass & {
  children: [NameClass];
};

// Validators
export function isRoot(tree: R.RngRoot): tree is Root {
  return tree.children.length == 1 && isGrammar(tree.children[0]);
}

function isGrammar(node: R.Pattern): node is Grammar {
  if (node.type != 'grammar') return false;
  if (node.children.length == 0) return false;
  const [start, ...rest] = node.children;
  return isStart(start) && rest.every((ch) => isDefine(ch));
}

function isStart(node: R.GrammarContent): node is Start {
  return (
    node.type == 'start' && node.children.length == 1 && isTop(node.children[0])
  );
}

function isTop(node: R.Pattern): boolean {
  return isNotAllowed(node) || isPattern(node);
}

function isNotAllowed(node: R.Pattern): node is R.NotAllowed {
  return node.type == 'notAllowed';
}

function isPattern(node: R.Pattern): node is Pattern {
  return isEmpty(node) || isNonEmptyPattern(node);
}
function isEmpty(node: R.Pattern): node is R.Empty {
  return node.type == 'empty';
}

function isNonEmptyPattern(node: R.Pattern): node is NonEmptyPattern {
  switch (node.type) {
    case 'text':
    case 'data':
    case 'value':
    case 'ref':
      return true;
    case 'attribute':
      return isAttribute(node);
    case 'oneOrMore':
      return isOneOrMore(node);
    case 'choice':
      return isChoice(node);
    case 'group':
      return isGroup(node);
    case 'interleave':
      return isInterleave(node);
    default:
      return false;
  }
}

function isAttribute(node: R.Attribute): node is Attribute {
  return (
    node.children.length == 2 &&
    isNameClass(node.children[0]) &&
    isPattern(node.children[1])
  );
}

function isOneOrMore(node: R.OneOrMore): node is OneOrMore {
  return node.children.length == 1 && isNonEmptyPattern(node.children[0]);
}

function isChoice(node: R.Choice): node is Choice {
  return (
    node.children.length == 2 &&
    isPattern(node.children[0]) &&
    isNonEmptyPattern(node.children[1])
  );
}

function isGroup(node: R.Group): node is Group {
  return (
    node.children.length == 2 &&
    isNonEmptyPattern(node.children[0]) &&
    isNonEmptyPattern(node.children[1])
  );
}

function isInterleave(node: R.Interleave): node is Interleave {
  return (
    node.children.length == 2 &&
    isNonEmptyPattern(node.children[0]) &&
    isNonEmptyPattern(node.children[1])
  );
}

function isNameClass(node: R.NameClass): node is NameClass {
  return true;
  // TODO: nameChoice case is not currently handled by the simplifier
  // so we need to revisit this.
}

function isDefine(node: R.GrammarContent): node is Define {
  return (
    node.type == 'define' &&
    node.children.length == 1 &&
    isElement(node.children[0])
  );
}

function isElement(node: R.Pattern): node is Element {
  return (
    node.type == 'element' &&
    node.children.length == 2 &&
    isNameClass(node.children[0]) &&
    isTop(node.children[1])
  );
}
