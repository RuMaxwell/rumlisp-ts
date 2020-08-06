# RumLisp Language Specification

RumLisp: A Lisp dialect for file system processing. Source file extension: .risp.

*Genre: Rum Programming Languages Plan - RumLisp*



## Features

* Dynamic typing, slightly strong typed;
* Easy syntax for file system access;
* Adaptable conversion from/to JSON;
* Powerful macro programming;
* Concurrency capability.



[TOC]



## Syntax

### 1. Lexeme and Data Type

#### Number

A Number is either an integer or a real number, which are not distinguished by either the compiler or the runtime.

Integer are written by several digital numbers and prefixing an optional negative sign, like `0` `-125` `999999999`, they are implicitly converted into 64-bit floating-point numbers.

Real numbers are written by several digital numbers followed by a numeric dot and other several digital numbers, prefixing an optional negative sign, like `0.0` `-0.0023` `30101.21039`, they are implicitly converted into 64-bit floating-point numbers.

Numbers can perform arithmetic operations (`+`, `-`, `*`, `/`, modulation `mod`), bitwise operations (and `b&`, or `b|`, xor `b^`, complement `b~`, shift `<<` `>>`) and comparison. While some operations treat the number as its original, others have to change it to fit into the operation. Details are in [Numbers chapter](#2. Numbers) and [Operators chapter](#1. Operators).

Numbers are directly stored in memory and are copied whenever reused.

TODO: Support various way to represent numbers.



#### String and URI

A String is a series of ASCII characters enclosed by a pair of quotes (`"`), like `"Hello, world!"`. Strings are used to represent URIs, i.e. the resources in a file system.

Strings can perform concatenation (`+`), path join (`/`), indexing, substitution, and many built-in operations. Details are in [Strings chapter](#3. Strings) and [Operators chapter](#1. Operators).

Strings are allocated on the heap and copied whenever reused. They are stored in 8-bit integer arrays.

TODO: Support UTF-8. Support escape characters.



#### List/Array

A List is a collection of arbitrary number of values. To directly create a List containing certain values, use brackets to enclosed them, like `[1, 2, "Good"]`. `[]` is a special constructor, it creates an empty list.

Lists can perform concatenation (`+`), indexing, mapping, and many operations. Details are in [Lists chapter](#4. Lists) and [Operators chapter](#1. Operators).

Lists are allocated on the heap and are implemented by arrays storing values of predictable data types. Lists are shared by references and will never copied on reuse. However, its contents can be cloned into a new list.



#### Dictionary

A Dictionary records maps from keys to values, where keys are nonredundant values and values are arbitrary values. Such a key-value pair is called a entry of the Dictionary.

A Dictionary can be directly created by `{}` syntax. Detailed are in [Dictionaries chapter](#5. Dictionaries).

Dictionaries support addition and deletion of entries, get entries from keys, set values of entries and traversal of keys and values and others. Details are in [Dictionaries chapter](#5. Dictionaries).

Dictionaries are allocated on the heap and are implemented by red-black trees. Dictionaries are shared by references and will never copied on reuse. However, its contents can be cloned into a new list.



#### Boolean

A Boolean is one of `#t` and `#f`, corresponding to the true and false Boolean values. It is the result of a comparison operation or a logical operation.

Boolean type is actually a function type (written as `a b -> a`). So a Boolean can be used as a conditional directive, like `(bool branch_a branch_b)`. When it is `#t` the first branch will be evaluated and the second will not; when it is `#f` the contrast will be performed. To clarify we can also use conditional expressions. Details are in [Expressions chapter](#Conditional Expression).



#### Function Type

A function type is written like `a b -> c`, with the argument types at the left of `->` and the result type at the right of `->`. Usually, we use only one lowercase letter to represent a specific but arbitrary existing type, and `any` to represent any existing type. For example, the `plus` function adds one number and another, so its type can be written as `Number Number -> Number`. Notice that function types are only used for documentation, function does not constraint their argument types.

The format of function type is also used to represent macros' "types". Macro types indicates its input and output type. Special format is used for it, such as `*` `+` and `?` meta-symbols. This will be evident after the introduction of macro definition.



### 2. Variable

A variable has a name (identifier) and stores a value. An identifier can be formed by any characters except for braces (`(` `)` `[` `]` `{` `}`), whitespaces (` ` `\t` `\n` `\r`), quote (`"`) and semicolon (`;`), and cannot be recognized as other values.

A variable can be declared and assigned by `let` directive, using `(let variable_name value)`. Its value can be used by directly writing down its name.

Values actually carries type information used to validate operations and do runtime checks, and therefore variables do not need it. Variables are stored in the stack, directly or indirectly contains their value.



### 3. Function call and S-Expression

A function is a special variable that can be called with arguments. Functions are also created by `let` directive, using `(let (function_name arg ...) body)`. Its takes arbitrary number of parameters/arguments and when called, evaluated to new values according to how it is defined in the body.

An S-Expression is a nested structure that several atomic tokens or expressions are separated and listed in double parenthesis. Namely, `(1 2 3)` `(+ 1 2)` `(f (+ 1 2) (* 3 (g 1)))` are S-Expressions. In facts, all RumLisp and other Lisp dialects have is S-Expression. A RumLisp program consists of one or more S-Expressions on the root. Specially, `()` which is called a *unit*, is also defined as an S-Expression and represent nothingness. It can be used, on function result value to represent no result, or be used on variable definition to represent uninitialized state.

To call a function we have to write an S-Expression, where the first item is the function's name, followed by one and another arguments, like `(func_name arg ...)`. Functions with zero arguments is allowed, and implicitly implemented as functions only taking `()` as input. To define and call them, use `(let (func_name) body)` and `(func_name)`, and the equivalent form `(let (func_name ()) body)` and `(func_name ())`.

If in an S-Expression the first item is not a function, a runtime error will arise.



### 4. Comments

A semicolon (`;`) starts an inline comment. It continues until the end of the line.



### 5. Expressions

In RumLisp, most of things are expressions, and every expression evaluates to a value.

**Notation**

| code snippet | meaning |
| --- | --- |
| `plain text` | Directly write it down |
| `...` | Repeats of the previous pattern (at least once) |
| `Type` | Represents a specific type |
| `*` | Represents any type |
| `function sig`| A function with `sig` signature, which specifies how many input argument &#10;and what type of output is expected. A signature writes as `arg:Type ... -> Type` |
| `name:Type` | A variable named by `name` and has `Type` type |
| `<expression>` | Any expression |
| `<id>` | An identifier |
| `<Type>` | An expression that when evaluated, the result should be of type `Type`.&#10;e.g. `<Boolean>` represents an expression that is expected to be of type `Boolean` |
| `<name:Type>` | Names the expression |
| `<syntax>index` | This should be replaced by actual expression or syntax structure named by `syntax`,&#10;and is the index-th appearance in current rule |
| `expression` -> `Type` | Specifies the expected type of the expression when evaluated |
| `expression` -> `function sig` | Specifies that the expected type of the expression when evaluated is a function |



#### Atomic Expression

Numbers, Strings, Lists, Dictionaries, Boolean, variables and an S-Expression itself belong to atomic expression. They can be seen as undividable units in their outer S-Expression.



#### Conditional Expression

**`(if <Boolean> then <expression>0 else <expression>1)`**

If the `<Boolean>` expression evaluates to `#t` then `<expression>0` will be evaluated and `<expression>1` will not; if it evaluates to `#f`, the contrast will be performed.



**`(if <Boolean> then <expression>)`**

Shortcut of `(if <Boolean> then <expression> else ())`.



#### Procedural Expression

**`(do <expression> ... )`**

Sequentially evaluates arbitrary number of expressions, and the whole procedure expression evaluates to the last inner expression's value.



**`(do)`**

Same as `()`.



## Functionalities

### 1. Operators

**`+`: `Number ... -> Number` **

**`String ... -> String` **

**`List ... -> List` **

**`List of Number -> Number` **

**`List of String -> String`**

Numeric addition, string concatenation and list concatenation. It can have arbitrary number (**>= 1**) of operands to calculate a sum, but only in the same type.

```rumlisp
(+ 1)                     ; 1
(+ 1 -2)                  ; -1
(+ 1.5 2.5 3)             ; 7

(+ "1" "3")               ; "13"
(+ "Hello" ", " "world")  ; "Hello, world"

(+ [] [1])                ; [1]
(+ ["ak"] [47])           ; ["ak" 47]

(+ [])                    ; ERROR, not enough operands
(+ [1])                   ; 1
(+ [1 -2])                ; -1
(+ ["1" "3"])             ; "13"
(+ [[1] [3]])             ; [1 3]

(+)                       ; ERROR, not enough operands
(+ 1 "1")                 ; ERROR, mismatched types
(+ ["1" 1])               ; ERROR, mismatched types
```



**`-`: `Number ... -> Number` **

**`List of Number -> Number`**

Numeric subtraction and negative sign. It can have arbitrary number (**>= 1**) of operands to do multiple subtractions on the first operand.

```rumlisp
(- 1)         ; -1
(- 0 -1)      ; 1
(- 10 2 4 6)  ; -2

(-)           ; ERROR, not enough operands
```



**`*`: `Number Number ... -> Number` **

**`List of Number -> Number`**

Numeric multiplication. It can have arbitrary number (**>= 2**) of operands to calculate a product.



**`/`: `Number Number ... -> Number` **

**`String String ... -> String` **

**`List of Number -> Number` **

**`List of String -> String`**

Numeric division and path join. It can have arbitrary number (**>= 2**) of operands to do multiple divisions, or join multiple paths.

```rumlisp
(/ 1 2)                     ; 0.5
(/ [1 2])                   ; 0.5
(/ 1 0)                     ; Inf
(/ -1 0)                    ; -Inf
(/ 0 0)                     ; NaN
(/ 36 2 2 3 3)              ; 1
(/ [36 2 2 3 3])            ; 1

(/ "/usr" "bin")            ; "/usr/bin"
(/ "/usr" ".." "mnt" ".")   ; "/mnt"
(/ ["/usr" ".." "mnt" "."]) ; "/mnt"

(/)                         ; ERROR, not enough operands
(/ 1)                       ; ERROR, not enough operands
(/ "./src" 1)               ; ERROR, mismatched types
```



**`%`: `Number Number -> Number`**

Integer modulation (find remainder). Arguments are casted into integer by `trunc` function.

```rumlisp
(% 1 1)   ; 0
(% 5 3)   ; 2

(% 3 0)   ; ERROR, divided by 0
```



**`b&`: `Number Number ... -> Number`   `List of Number -> Number`**
**`b|`: `Number Number ... -> Number`   `List of Number -> Number`**
**`b^`: `Number Number ... -> Number`   `List of Number -> Number`**
**`b~`: `Number Number ... -> Number`   `List of Number -> Number`**



**`>>`: `Number Number -> Number`**
**`<<`: `Number Number -> Number`**



**`&&`: `Boolean Boolean ... -> Boolean`   `List of Boolean -> Boolean`**
**`||`: `Boolean Boolean ... -> Boolean`   `List of Boolean -> Boolean`**
**`not`: `Boolean -> Boolean`**



**`=`: `* * -> Boolean`**
**`!=`: `* * -> Boolean`**
**`>`: `Number Number ... -> Boolean`   `String String ... -> Boolean`   `List List ... -> Boolean`**
**`<`: `Number Number ... -> Boolean`   `String String ... -> Boolean`   `List List ... -> Boolean`**
**`>=`: `Number Number ... -> Boolean`   `String String ... -> Boolean`   `List List ... -> Boolean`**
**`<=`: `Number Number ... -> Boolean`   `String String ... -> Boolean`   `List List ... -> Boolean`**



### 2. Numbers

**`(trunc <Number>)` -> `Number`**

Returns the integral part of the a numeric expression, x, removing any fractional digits.



**`(floor <Number>)` -> `Number`**

Returns the greatest integer less than or equal to its numeric argument.



**`(ceil <Number>)` -> `Number`**

Returns the smallest integer greater than or equal to its numeric argument.



**`(round <Number>)` -> `Number`**

Returns a supplied numeric expression rounded to the nearest integer.



**`(abs <Number>)` -> `Number`**

Returns the absolute value of a number (the value without regard to whether it is positive or negative).



***Not Implemented*** `(#int <Number>)` -> `#Int`

Forces a number to be an integer. `#Int` is a built-in type representing 64-bit integer.



### 3. Strings

**`(show <*>)` -> `String`**

Gives the string representation of a value.



**`(parse <String>)` -> `Number`**

Parses a string to get a number out of it.



**`(chars <String>)` -> `List of String`**

Returns a list containing every character in the string.



**`(abs <String>)` -> `String`**

Calculates the absolute path.



**`(slice <String> <start:Number> <end:Number>)` -> `String`**

Gets a slice of the string.

Negative index numbers are from the last element. e.g. `-1` = `(len <String>) - 1`.



### 4. Lists

**`[ <expression> ... ]`**

Creates a List.



**`(len <List>)` -> `Number`**

Gets how many values are stored in the list.



**`(push <List> <expression>)` -> `List`**

Appends a value to the list and returns the resultant list.



**`(pop <List>)` -> `*`**

Removes the last value of the list and returns it.



**`(push-front <List> <expression>)` -> `List`**

Prepends a value to the list and returns the resultant list.



**`(pop-front <List>)` -> `*`**

Removes the first value of the list and returns it.

If no value to be removed, a runtime error will arise.



**`(get <List> <index:Number>)` -> `*`**

Get the value at the index in the list. (Read: get an element from the `List` at the index `index`)

The index will be implicitly converted to integer, using `trunc` function, which directly cut off the fractional part of the number.



**`(set <List> <index:Number> <value:expression>)` -> `*`**

Set the value at the index in the list. (Read: set a value of the `List` at the index `index` with value `value`)

The index will be implicitly converted to integer, using `trunc` function, which directly cut off the fractional part of the number.



**`(slice <List> <start:Number> <end:Number>)` -> `<List>`**

Gets a slice of the list.



**`(del-ins <List> <start:Number> <count:Number> <insert:List>)` -> `<List>`**

Deletes a number of items of the list at a point, and then insert several items at the same point.



**`(+ <List>...)` -> `List`**

Concatenates lists to form a new list.

The input lists are not modified.



**`(append <List>0 <List>1)` -> `List`**

Appends `<List>1` to `<List>0`.

`<List>0` is modified, while `<List>1` is not.



**`(map <List> <function val -> res>)` -> `List`**   *(will be in std)*

For each value in the list, applies a function to it and returns a new list containing all the results in the same order. (Read: map the list with the function)

e.g. `(map [1 2 3] (\ x (+ x 1))` => `[2 3 4]`



**`(filter <List> <function val -> Boolean>` -> `List`**   *(will be in std)*

Filters out all values not satisfying the given constraint (i.e. when called by the function, results in `#f`) in the list, returns a new list only containing values satisfying the constraint. (Read: filter the list with the predicate)

e.g. `(filter [-1 0 2 3] (\ x (> x 0))` => `[2 3]`



***Not Implemented***  **`(contains <List>0 <List>1)` `(contains-ne <List>0 <List>1)` `(eq <List>0 <List>1)` `(neq <List>0 <List>1)`**



### 5. Dictionaries

Dictionaries are implemented by red-black trees, and keys are compared using built-in `==` `>` `<` `!=` operator, which compares Numbers, Booleans, Strings and Lists by their values, and others by their memory address.

**`{ (<key:expression> <value:expression>) ... }`** (Lisp style) or

***Not Implemented*** **`{ <key:expression> : <value:expression>` `, <key:expression> : <value:expression>`* `,`? `}`** (JSON style)

Creates a dictionary with given entries.



**`(get <Dictionary> <key:expression>)` -> `*`**



**`(tryget <Dictionary> <key:expression> <default_value:expression>)` -> `Option of *`**



**`(set <Dictionary> <key:expression> <value:expression>)` -> `Dict`**



**`(tryset <Dictionary> <key:expression> <value:expression>)` -> `Dict`**



**`(keys <Dictionary>)` -> `List of key-type`**



**`(entries <Dictionary>)` -> `List of Pair`**

```rumlisp
; Pair: [key value]
(let es (entries { "id" : 123 , "name" : "Jean" }))
(map (\ ent (fmt "{}: {}" (get ent 0) (get ent 1))) es)  ; ["id: 123" "name: Jean"]
```



**`(proto { <key:String> ... })`**



**`(new <proto:id> { (<key:String> <value:expression>) ... })`**



### 6. Functions and Closures

**`(let (<name:id> <arg:id> ...) <body:expression>)`**



**`(\ (<arg:id> ...) <body:expression>)`**



**`(\ <arg:id> <body:expression>)`**



**`(\ () <body:expression>)`**



**`(<func:function A ... -> R> <arg:A> ...)` -> `R`**



**`(<func:function () -> T>)` -> `T`**



**`(call <func:function A ... -> R> <args:List>)` -> `R`**





### 7. Library functions

#### JSON conversions

**`(->JSON <expression>)` -> `String`**



**`(<-JSON <String>)` -> `*`**



#### Others

**`(eval <String>)` -> `*`**

Treats the string as a piece of RumLisp program and evaluates it.



### 8. Macros

Macro definitions use a lot of meta-symbols, so its syntax will be introduced by concrete examples.



**`(macro (if %cond{expr} then %then{expr} else %else{expr}) (%cond %then %else))`**

This defines a macro named `if` and its use format. `if`, `then` and `else` are static symbols used to trace the position at which the macro is expanding. Items enclosed in `%name{` and `}` will be replaced by RumLisp syntactic structures,  where in this case `%cond{expr}` will be replaced by an atomic expression, which can be accessed by its name `%cond` in macro definition. In this syntax, `expr` is called a *syntax structure*. Parentheses not accompanied by a `%` are parsed just as is. Syntax structures that can be used in macro definitions are listed below.

As you can see, the above `if` macro defines the standard conditional structure. A use of it is `(if (= (% x 2) 0) then (/ x 2) else (+ (* x 3) 1))`.


| syntax structure | meaning                                        | example                   |
| ---------------- | ---------------------------------------------- | ------------------------- |
| expr             | expression (atomic expression or s-expression) | `1` `#t` `()` `(+ 1 2 3)` |
| token            | any token                                      | `1` `#t` `(` `)` `"str"`  |
| number           | a number literal                               | `1` `2.5` `-3`            |
| string           | a string literal                               | `""` `"hello"`            |
| ident            | an identifier                                  | `_` `a` `any-Thing@375`   |



**`(macro (+ %terms{expr}+) (foldl1 %%terms add))`**

As you can see, the operator `+` is defined as an macro. Its format contains a repeatable structure `%terms{expr}+`. The use of `+` here is just as in regular expressions, which indicates the former structure can be repeated once or more. In comparison, `*` indicates the absence of a structure, or repetition of once or more. `?` indicates zero or once appearance of a structure. When using `?`, `%exists` directive can be used to test whether specific structure exists. 

In definition, we can use a struct followed by `+` and `*` as an ordinary list by use `%%`. Details are at [the end of this section](#Macro Full Syntax).



**`(macro (if %cond{expr} then %then{expr} %clause(else %else{expr})? ) (`**

&nbsp;&nbsp;&nbsp;&nbsp;**`(%exists %clause) (%cond %then %else) (%cond %then ())))`**

This is similar to the above `if` macro, but the else-branch can be omitted. We use `%name(` `)` to enclose a section as a whole and name it, and then we can append `+` `*` `?` selectors to indicates repetition pattern of the section. So the use of this `if` macro will be either `(if sth. then sth. else sth.)` or `(if sth. then sth.)`.

When using `%clause` inside the definition body, it is replaced by the whole section. Sections and structures inside a section have nothing different from the outsides, we can directly use their names to reference them.



For clarity, `+` and `*` tries to match more as possible. For example, see another macro:

**`(macro (#cat %(# %cats{token}+ # %addi{token}?)+ ) (...))`**

There's nothing new. Notice `#`s inside the `%(` `)` pair are static symbols that must be written. Consider a use of this macro like this:

`(#cat # list 1 # and # list 2 #)`

How do we expand the macro use? Shall we group `# list 1 #` and `# list 2 #` separately, or group `# list 1 # and # list 2 #` as a whole? The latter is right, because `+` and `*` are greedy. To match least possible structures, use `+?` and `*?`. Changing the above definition to `(macro (#cat %(# %cats{token}+? # %addi{token}?)+ ) (...))` will solve this problem.



**`(macro (port! %port[token.number token.string]) (%switch port (token.number %port) (token.string (parse %port))))`**

`%name[` `]` is a selector, it encloses multiple structure choices, and can be selected by `%switch` directives inside the definition.



#### Built-in Macros

Let's explore some funny and useful macros. To be clear, the `(macro )` keyword and definition bodies are neglected.



**`(prec= %term{expr}+)`**

Compute arithmetic (operator-infix) expressions (operator precedence are documented in the source file). Functions with one or two parameters can be used without surrounded parentheses, and binary functions can be called in infix notation.

```rumlisp
(prec= 1 + 2)                            ; 3
(prec= -1 + 2 * 3)                       ; 5
(prec= 1 + len (show (prec= 2 pow 10)))  ; 5
```



**`(polish= %term{expr}+)`**

Compute polish notation (operator-prefix) expressions. Functions can be called without parentheses.

```rumlisp
(polish= + 1 2)                           ; 3
(polish= + -1 * 2 3)                      ; 5
(polish= + 1 len show (polish= ** 2 10))  ; 5
```



**`(revpol= %term{expr}+)`**

Compute reverse-polish notation (operator-prefix) expressions. Functions can be called without parentheses.

```rumlisp
(revpol= 1 2 +)                         ; 3
(revpol= 2 3 * -1 +)                    ; 5
(revpol= (revpol= 2 10 **) show len +)  ; 5
```



#### Macro Full Syntax

##### Binding Directives

**`(%let ... ... ...)`**

If the second argument results in an unnamed macro content, bind the structure to a name (the first argument) that can be used later inside the third argument.

The name must be an identifier with a `%` prefix, and not conflicting with other macro names. e.g. `%x`.

Use cases

```rumlisp
; an argument list version of filter
; The %let bindings below are unnecessary. (%head %xs) and (%tail %xs) can be directly used anywhere the bindings are need.
(macro (filter! %pred{expr} %xs{expr}*)
    (%if (%empty %xs)
         %xs
         (%let %H (%head %xs)
         (%let %T (%tail %xs)
             (%if (%pred %H)
                  (filter! %pred %xs)
                  (filter! %pred %T))))))
```



##### Conditional Directives

**`%t` and `%f`**

These are macro Booleans, representing results of some macro directives. They can be used by `%if` directive to control macro branches.



**`(%and ... ...)` `(%or ... ...)` and `(%not ...)`**

These operates on macro Booleans, just as their names expressing.



**`(%if ... ... ...)`**

Macro conditional directive. When the first argument results in `%t`, the macro will expand according to the second argument, or else expand according to the third argument.



Use cases

```rumlisp
(macro (if-args! %args{expr}* then! %then{expr} else! %else{expr}) (
    (%if (%not (%empty %args)) %then %else)))

(if-args! then! 1 else! 2)      ; 2
(if-args! a b then! 1 else! 2)  ; 1
```



##### Selectors

**`?` selector**

It generates an optional structure, and some specific directives can be performed on it.

In declaration: `%x{...}?`

In definition:

**`%x`**: Directly replaced by a structure, or nothing.

**`(%exists %x)`**: Tests if there actually exists a structure. The result is a macro Boolean value.

Use cases

```rumlisp
(macro (card-game %player-count{number}?) (
    (%if (%exists %player-count) (show %player-count) (show 4))))

(card-game)    ; "4"
(card-game 2)  ; "2"
```



While `?` selector generates an optional structure, `*` and `+` selectors generates internal argument lists. This data structure is only used by the macro resolver, representing the discrete list of macro arguments that can be directly used in a multi-argument call. Multiple specific macro directives can perform on it. A trivial fact is that an argument list with only one argument is equivalent with the argument itself. And an empty argument list means literally nothing.



**`*` and `+` selector**

In declaration: `%xs{...}*` or `%xs{...}+`

In definition:

**`%xs`**: Directly replaced by the original argument list.

**`%%xs`**: Converts the argument list to a real list.

**`(%list %xs)`**: Converts the argument list to a real list.

**`(%empty %xs)`**: Judges whether the argument list is empty. The result is a macro Boolean value.

**`(%head %xs)`**: Retrieves the first structure of the argument list. The result is an unnamed structure that can be bound using `%let` directive.

**`(%tail %xs)`**: Retrieves the tail (whole without the first) of the argument list. The result is an unnamed argument list that can be bound using `%let` directive.

**`(%map %xs ...)`**: Maps the argument list to form a new argument list using the macro directive at the second argument of `%map`. e.g. `(%map %tokens %str)`.

**`(%cons ... %xs)`**: Constructs a new argument list by prepending one to the old argument list. The result is an unnamed argument list that can be bound using %let directive.

Use cases

```rumlisp
(macro (show-args %args{expr}*) (%str %args))
(macro (show-args-list %args{expr}*) (show %%args))

(show-args)                 ;
(show-args 1 (+ 3 1))       ; 1 (+ 3 1)
(show-args-list)            ; []
(show-args-list 1 (+ 3 1))  ; [1 4]

(macro (join-str %sep{string} %args{string}*)
    (%if (%empty %args)
         ""
         (+ (%head %args) %sep (join-str %sep (%tail %args)))))

(join-str ",")                                             ; ""
(join-str ", " "Hello" "world")                            ; "Hello, world "
(join-str " " "The" "red" "cat" "ate" "the" "fat" "rat.")  ; "The red cat ate the fat rat. "

; a better join-str (with trailing separator removed)
(macro (join-str %sep{string} %args{string}*)
    (%if (%empty %args)
         ""
         (%if (%empty (%tail %args))
              %args
              (+ (%head %args) %sep (join-str %sep (%tail %args))))))
```



##### Structures

**1. expr**

In declaration: `%x{expr}`

In definition: **`%x`**

Use instance

```rumlisp
(macro (show! %x{expr}) (show %x))

(show! (+ 1 (do (let f 3) f)))  ; expanded: (show (+ 1 (do (let f 3) f))), eval: "4"
```

**2. token**

In declaration: `%x{token}`

In definition:

**`%x`**  Direct use.

**`(%str %x)`**  Converts the token to its representation quoted in string.

**`(%cat %x %y...)`**  Concatenates tokens into one token.

Token structures number, string, and ident also supports all directives above.

Use instance

```rumlisp
(macro (show-token! %x{token}) (show %x))

(show-token! 1)      ; (show 1)
(show-token! "str")  ; (show "str")
(show-token! var)    ; (show var)

(macro (show-repr! %x{token}) (show (%str %x)))

(show-repr! 1)      ; (show "1")
(show-repr! "str")  ; (show "\"str\"")
(show-repr! var)    ; (show "var")

(macro (join! %sep{token} %tokens{token}+)
    (%let %T (%tail %tokens)
        (%if (%empty %T)
             %tokens  ; Only one token, so %tokens = (%head %tokens)
             (%cat (%head %tokens) %sep %T)))))

(join! - string sum 1)  ; string-sum-1
(join! . 192.168 0.1)   ; 192.168.0.1
```

**3. string**

Except all those of token, string supports these additional directives:

**`(%ident %s)`**: Converts the string literal to an identifier.

Use cases

```rumlisp
(macro (interpret-ident %id{string}) (%ident %id))

(interpret-ident "x")          ; x
(interpret-ident (+ "x" "2"))  ; x2
```

Expressions that evaluate to strings cannot use `%ident` directive to convert to identifiers. In that case, `eval` function is handy and sufficient.



##### Macro Experimental Features

\*\**Experimental*\*\*: Higher-level macros: taking macro as input.

```rumlisp
(macro ($m-map %mac[macro] %tokens[token]*) (
    (%map %tokens %mac)))

(macro ($str %token[token]) (%str %token))

(fmt "{}-{}-{}" ($m-map $str abc 1 "good"))  ; "abc-1-good"
```



\*\**Experimental*\*\*: `!macro-call!`: `call` in macro.

Because Lists are dynamic object, you cannot turn it into argument list in macro. `!macro-call!` is here to solve this problem. It tries to assume that the list have those structures that the macro needs, and then expands the macro at compile time and binds the values when called.

```rumlisp
(macro (m! %a{token} %b{string} %c{expr}) (+ (%str %a) (%str b) (%str %c)))

(!macro-call! m! [1 "abc" (+ 1 2)])
; it turns into:
; ((\ (m `late-macro-check token`a `late-macro-check string`b `late-macro-check expr`c)
;     (+ (`str` a) (`str` b) (`str` c))
;  )
;  1 "abc" (+ 1 2))
```

`!macro-call!` has to bring all the macro directives (such as `%str` `%cat` `%head` etc.) to the runtime, with some extra features (<code>\`late-macro-check\`</code>). So unless without this feature you can't implement something (quite impossible) or will make the code much more complicated, don't use it.

