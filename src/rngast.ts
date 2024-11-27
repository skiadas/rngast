// Types for the ast for an RelaxNG specification
import { Literal as UnistLiteral, Node, Parent as UnistParent } from 'unist';

export { UnistLiteral as Literal, RngRoot as Root };

export type DataType = 'integer' | 'double' | 'string';
export type CombineMethod = 'choice' | 'interleave';

export interface GrammarContentMap {
  start: Start;
  define: Define;
  // Missing: <div> grammarContent* </div>
  // Missing: <include href="anyURI"> includeContent* </include>
  // includeContent  ::=  start
  //    | define
  //    | <div> includeContent* </div>
}

// These are the elements that represent patterns that may be used in a match
export interface PatternMap {
  elementNamed: ElementNamed;
  element: Element;
  attributeNamed: AttributeNamed;
  attribute: Attribute;
  group: Group;
  interleave: Interleave;
  choice: Choice;
  optional: Optional;
  zeroOrMore: ZeroOrMore;
  oneOrMore: OneOrMore;
  // Missing: list
  mixed: Mixed;
  ref: Ref;
  parentRef: ParentRef;
  empty: Empty;
  text: Text;
  value: Value;
  data: Data;
  notAllowed: NotAllowed;
  // Missing: externalRef
  grammar: Grammar;
}

// TODO: Add nsName
export interface NameClassMap {
  name: Name;
  anyName: AnyName;
  nameChoice: NameChoice;
}

// The first element in the grammar is expected to be a Start
// And subsequent elements will be Definition.
export interface Grammar extends Parent {
  type: 'grammar';
  children: GrammarContent[];
}

export type GrammarContent = GrammarContentMap[keyof GrammarContentMap];
export type Pattern = PatternMap[keyof PatternMap];
export type NameClass = NameClassMap[keyof NameClassMap];

export type Content = GrammarContent | Pattern | NameClass;

export interface Parent extends UnistParent {
  children: Content[];
}

export interface PatternParent extends Parent {
  children: Pattern[];
}

export interface NameClassParent extends Parent {
  children: NameClass[];
}

export interface RngRoot extends UnistParent {
  type: 'root';
  children: [Pattern];
}

// PATTERNS
export interface ElementNamed extends PatternParent {
  type: 'elementNamed';
  name: string;
}

export interface Element extends Parent {
  type: 'element';
  children: [NameClass, ...Array<Pattern>];
}

export interface AttributeNamed extends UnistParent {
  type: 'attributeNamed';
  name: string;
  children: [] | [Pattern];
}

export interface Attribute extends UnistParent {
  type: 'attribute';
  children: [NameClass] | [NameClass, Pattern];
}

export interface Group extends PatternParent {
  type: 'group';
}

export interface Interleave extends PatternParent {
  type: 'interleave';
}

export interface Choice extends PatternParent {
  type: 'choice';
}

export interface Optional extends PatternParent {
  type: 'optional';
}

export interface ZeroOrMore extends PatternParent {
  type: 'zeroOrMore';
}

export interface OneOrMore extends PatternParent {
  type: 'oneOrMore';
}

export interface Mixed extends PatternParent {
  type: 'mixed';
}

export interface Ref extends Node {
  type: 'ref';
  name: string;
}

export interface ParentRef extends Node {
  type: 'parentRef';
  name: string;
}

export interface Empty extends Node {
  type: 'empty';
}

export interface Text extends Node {
  type: 'text';
}

export interface Value extends Node {
  type: 'value';
  value: string;
}

export interface Data extends Node {
  type: 'data';
  dataType: DataType;
  // Needs more to match spec:
  // <data type="NCName"> param* [exceptPattern] </data>
  // param ::=  <param name="NCName"> string </param>
  params?: Record<string, string>; // Currently ignored
}

export interface NotAllowed extends Node {
  type: 'notAllowed';
}

// GRAMMAR CONTENT
// Start contains a single Pattern
export interface Start extends Parent {
  type: 'start';
  combine?: CombineMethod;
  children: [Pattern];
}

export interface Define extends Node {
  type: 'define';
  name: string;
  combine?: CombineMethod;
  children: Pattern[];
}

/// NAME CLASSES
export interface Name extends Node {
  type: 'name';
  name: string;
}

export interface AnyName extends Node {
  type: 'anyName';
  except?: ExceptNameClass;
}

export interface NameChoice extends NameClassParent {
  type: 'nameChoice';
}

export interface ExceptNameClass extends NameClassParent {
  type: 'exceptNameClass';
}
