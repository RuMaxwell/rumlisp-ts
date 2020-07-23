import fs from "fs"
import { Lexer, TokenType } from "./lexer"
import { Parser } from "./ll-parser"
import { execute } from "./semantics"

class Tests {
  static tokenizer_test() {
    const source = fs.readFileSync('examples/lexer_test.risp').toString()
    const lexer = new Lexer(source)
    let token = lexer.init

    while (token.type !== TokenType.eof) {
      token = lexer.next()
      switch (token.type) {
        case TokenType.err:
          console.error(`lexical error: ${token.literal} at line ${token.line}, column ${token.column}`)
          break
        case TokenType.eof:
          break
        default:
          console.log(token)
          break
      }
    }
  }

  static parser_test() {
    const source = fs.readFileSync('examples/parser_test.risp').toString()
    const parser = new Parser(source)
    let ast = parser.parse()
    ast.handle(
      exprs => console.log(exprs),
      err => console.error(err)
    )
  }

  static semantics_test() {
    const source = fs.readFileSync('examples/semantics_test.risp').toString()
    let values = execute(source)
    values.handle(
      vals => {
        for (let i in vals) {
          console.log(`${vals[i]}`)
        }
      },
      err => console.error(err)
    )
  }
}

Tests.semantics_test()
