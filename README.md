# RumLisp

A Lisp dialect for file system processing. Source file extension: .risp.

Some useful info is in examples/rumlisp_lang_spec.md. Full language specification will come out later.



## Installation

Clone this project to somewhere, enter the project folder, and:



Install typescript at global (if not):

```sh
$ npm i -g typescript
```



Build the project by:

```sh
$ tsc
```



And then use either of the following way to start a RumLisp REPL:

1.

```sh
$ node build/index.js
```

2.

(This builds the project again)

```sh
$ npm start
```



You can compile and run a RumLisp file by:

```sh
$ node build/index.js <filename>
```

The extension of RumLisp source file is `.risp`.



## Use as a library

You can see `src/index.ts` for how to use the lib.
