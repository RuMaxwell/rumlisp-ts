import { Either, Right, Left } from "./utils"

class SourcePosition {
  source: string
  line: number
  column: number

  constructor(source: string) {
    this.source = source.trim()
    this.line = 1
    this.column = 1
  }

  get eof(): boolean {
    return this.source.length === 0
  }

  /**
   * @returns `false` if at the EOF
   */
  private advance1(): boolean {
    if (!this.eof) {
      if (this.source[0] === '\n') {
        this.source = this.source.slice(1)
        this.line++
        this.column = 1
      } else {
        this.source = this.source.slice(1)
        this.column++
      }
      return true
    } else {
      return false
    }
  }

  /**
   * @returns `false` if at the EOF
   */
  advance(step: number = 1): boolean {
    for (let i = 0; i < step; i++) {
      let ok = this.advance1()
      if (!ok) {
        return false
      }
    }
    return true
  }

  toString(): string {
    return `line ${this.line}, column ${this.column}`
  }
}

/**
 * Benign EOF error.
 */
export class EOF implements Error {
  name: string
  message: string
  stack?: string | undefined

  constructor() {
    this.name = 'EOF'
    this.message = ''
    this.stack = undefined
  }
}

export class SyntaxError implements Error {
  name: string
  message: string
  stack?: string | undefined

  constructor(message: string) {
    this.name = 'syntax error'
    this.message = message
  }

  toString() {
    return `${this.name}: ${this.message}`
  }
}

export enum TokenType {
  init,
  number,
  string,
  symbol,
  identifier,
  eof,
  err
}

class UncheckedToken {
  token: Token

  constructor(token: Token) {
    this.token = token
  }

  check(): Token {
    if (this.token.type === TokenType.eof) {
      throw new SyntaxError(`unexpected EOF${this.token.locate()}`)
    } else if (this.token.type === TokenType.err) {
      throw new SyntaxError(this.toString())
    }

    return this.token
  }

  softCheck(): this {
    if (this.token.type === TokenType.err) {
      throw new Error(this.toString())
    }

    return this
  }
}

export class Token {
  type: TokenType
  literal: string
  line?: number
  column?: number

  constructor(type: TokenType, literal: string, line?: number, column?: number) {
    this.type = type
    this.literal = literal
    this.line = line
    this.column = column
  }

  toString(): string {
    return `[${this.type}]:${this.literal}` + (this.line != undefined ? ` at line ${this.line}, column ${this.column}` : '')
  }

  locate(): string {
    return this.line !== undefined ? ` at line ${this.line}, column ${this.column}` : ''
  }
}

const eofToken = new Token(TokenType.eof, "")
const initToken = new Token(TokenType.init, "")

type Generator = (literal: string, line?: number, column?: number) => Token

class Rule {
  pattern: RegExp
  generator: Generator

  constructor(pattern: RegExp, generator: Generator) {
    this.pattern = pattern
    this.generator = generator
  }
}

function makeGenerator(tokenType: TokenType): Generator {
  return function (literal: string, line?: number, column?: number) {
    return new Token(tokenType, literal, line, column)
  }
}

const rumlispLexRules: Rule[] = [
  // number and identifier
  new Rule(/^[^ \t\r\n()\[\]{};`%"]+/, (literal, line, column) => {
    if (/^-?\d+(\.\d+)?$/.test(literal)) {
      return new Token(TokenType.number, literal, line, column)
    } else {
      return new Token(TokenType.identifier, literal, line, column)
    }
  }),
  // "hello" (strings can contain line breaks)
  new Rule(/^".*?"/s, makeGenerator(TokenType.string)),
  new Rule(/^\(/, makeGenerator(TokenType.symbol)),
  new Rule(/^\)/, makeGenerator(TokenType.symbol)),
  new Rule(/^\[/, makeGenerator(TokenType.symbol)),
  new Rule(/^\]/, makeGenerator(TokenType.symbol)),
  new Rule(/^{/, makeGenerator(TokenType.symbol)),
  new Rule(/^}/, makeGenerator(TokenType.symbol)),
  new Rule(/^`/, makeGenerator(TokenType.symbol)),
  new Rule(/^%/, makeGenerator(TokenType.symbol)),
  new Rule(/^"/, makeGenerator(TokenType.symbol)),
  new Rule(/^;/, makeGenerator(TokenType.symbol)),
]

class ParenCounter {
  private _paren = 0
  private _brack = 0
  private _curly = 0
  private _hadErr = false

  constructor(paren = 0, brack = 0, curly = 0) {
    this._paren = paren
    this._brack = brack
    this._curly = curly
  }

  get paren() { return this._paren }
  get brack() { return this._brack }
  get curly() { return this._curly }

  get zero() {
    return this._paren === 0 && this._brack === 0 && this._curly === 0
  }

  incParen(): number { return ++this._paren }
  decParen(): number { let r = --this._paren; if (this._paren < 0) this._hadErr = true; return r }
  incBrack(): number { return ++this._brack }
  decBrack(): number { let r = --this._brack; if (this._paren < 0) this._hadErr = true; return r }
  incCurly(): number { return ++this._curly }
  decCurly(): number { let r = --this._curly; if (this._paren < 0) this._hadErr = true; return r }

  copy() {
    return new ParenCounter(this._paren, this._brack, this._curly)
  }

  eq(o: ParenCounter) {
    return this._paren === o._paren && this._brack === o._brack && this._curly === o._curly
  }

  hadErr() {
    return this._hadErr
  }
}

export class Lexer {
  private sp: SourcePosition
  private rules: Rule[]
  private _parenCounter = new ParenCounter()

  constructor(source: string, rules: Rule[] = rumlispLexRules) {
    this.sp = new SourcePosition(source)
    this.rules = rules
  }

  get eof(): boolean {
    return this.sp.eof
  }

  get line(): number {
    return this.sp.line
  }

  get column(): number {
    return this.sp.column
  }

  get parenCounter(): ParenCounter {
    return this._parenCounter
  }

  saveParenCounter(): ParenCounter {
    return this._parenCounter.copy()
  }

  lookNext(): UncheckedToken {
    if (this.sp.eof) {
      return new UncheckedToken(eofToken)
    }

    if (!this.skipWhites()) {
      return new UncheckedToken(eofToken)
    }

    for (let i in this.rules) {
      let rule = this.rules[i]
      let matches = this.sp.source.match(rule.pattern)
      if (matches !== null && matches.length > 0) {
        let literal = matches[0]
        let tk = rule.generator(literal, this.sp.line, this.sp.column)
        // this.sp.advance(literal.length)
        return new UncheckedToken(tk)
      }
    }

    return new UncheckedToken(new Token(TokenType.err, `unexpected character series`, this.sp.line, this.sp.column))
  }

  /**
   * Resolves the next token.
   */
  next(): UncheckedToken {
    if (this.sp.eof) {
      return new UncheckedToken(eofToken)
    }

    if (!this.skipWhites()) {
      return new UncheckedToken(eofToken)
    }

    let token = this.matchFirst()

    // count parentheses
    if (token.type === TokenType.symbol) {
      switch (token.literal) {
        case '(':
          this._parenCounter.incParen()
          break
        case ')':
          this._parenCounter.decParen()
          if (this._parenCounter.hadErr()) {
            return new UncheckedToken(new Token(TokenType.err, 'unmatched parentheses', this.sp.line, this.sp.column))
          }
          break
        case '[':
          this._parenCounter.incBrack()
          break
        case ']':
          this._parenCounter.decBrack()
          if (this._parenCounter.hadErr()) {
            return new UncheckedToken(new Token(TokenType.err, 'unmatched parentheses', this.sp.line, this.sp.column))
          }
          break
        case '{':
          this._parenCounter.incCurly()
          break
        case '}':
          this._parenCounter.decCurly()
          if (this._parenCounter.hadErr()) {
            return new UncheckedToken(new Token(TokenType.err, 'unmatched parentheses', this.sp.line, this.sp.column))
          }
          break
        default:
          break
      }
    }

    return new UncheckedToken(token)
  }

  /**
   * Gets the initial state token.
   */
  get init(): Token {
    return initToken
  }

  /**
   * @returns `false` if at EOF
   */
  private skipWhites(): boolean {
    while (true) {
      // eof
      if (this.sp.eof) {
        return false
      }
      // white characters
      else if (isWhiteChar(this.sp.source[0])) {
        this.sp.advance()
      }
      // inline comment
      else if (this.sp.source.startsWith(';')) {
        while (!this.sp.eof) {
          if (this.sp.source[0] !== '\n') {
            this.sp.advance()
          } else {
            this.sp.advance()
            break
          }
        }
      }
      // non-white characters
      else {
        return true
      }
    }
  }

  private matchFirst(): Token {
    // if (this.sp.eof) {
    //   return eofToken
    // }

    for (let i in this.rules) {
      let rule = this.rules[i]
      let matches = this.sp.source.match(rule.pattern)
      if (matches !== null && matches.length > 0) {
        let literal = matches[0]
        let tk = rule.generator(literal, this.sp.line, this.sp.column)
        this.sp.advance(literal.length)
        return tk
      }
    }

    return new Token(TokenType.err, `unexpected character series`, this.sp.line, this.sp.column)
  }
}

function isWhiteChar(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n'
}
