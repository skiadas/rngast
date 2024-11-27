# rngast

![Branches](https://github.com/skiadas/rngast/blob/badges/badges/coverage-branches.svg)
![Functions](https://github.com/skiadas/rngast/blob/badges/badges/coverage-functions.svg)
![Lines](https://github.com/skiadas/rngast/blob/badges/badges/coverage-lines.svg)
![Statements](https://github.com/skiadas/rngast/blob/badges/badges/coverage-statements.svg)
![Coverage total](https://github.com/skiadas/rngast/blob/badges/badges/coverage-total.svg)

Rngast is a collection of ASTs and utilities for working with [Relax NG](https://relaxng.org/) grammars in the [unified](https://unifiedjs.com/) ecosystem.

This is work in progress.

Current parts include:

- [rngast](src/rngast.ts): A [https://github.com/syntax-tree/unist](https://github.com/syntax-tree/unist) implementing abstract syntax tree for [Relax NG](https://relaxng.org/spec-20011203.html#full-syntax) grammars.
- [simple-rngast](src/simple-rngast.ts): An AST for the [simplified Relax NG syntax](https://relaxng.org/spec-20011203.html#simple-syntax)
- [rngast-simplify](src/rngast-simplify.ts): A converter from rngast to simple-rngast
- [xast-to-rngast](src/xast-to-rngast.ts): A converter from the [xast](https://github.com/syntax-tree/xast) tree produced from RelaxNG grammar files to an rngast form
- [relaxng-builder](src/relaxng-builder.ts): Convenience functions for creating rngast and simple-rngast trees
- (Not working yet) [rngast-validate](src/rngast-validate.ts): A validator that applies a rngast grammar against the xast representation of an XML file


