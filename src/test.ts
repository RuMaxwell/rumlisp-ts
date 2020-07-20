import { Lexer, TokenType } from "./lexer"
import fs from "fs"
import { Parser } from "./ll-parser"

const source = fs.readFileSync('examples/test.risp').toString()

class Tests {
  static tokenizer_test() {
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
    const parser = new Parser(source)
    let ast = parser.parse()
    ast.handle(
      exprs => console.log(exprs),
      err => console.error(err)
    )
  }
}

Tests.parser_test()
