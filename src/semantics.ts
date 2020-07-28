import * as Parser from './ll-parser-except'
import { Either, Right, Left } from './utils'
import * as path from 'path'

export type Value = Unit | number | string | List | Dict | Closure | BuiltinClosure

class Unit {
  toString(): string {
    return '()'
  }
}
const unit = new Unit()

export class List {
  values: Value[]

  constructor(values: Value[]) {
    this.values = values
  }

  toString(): string {
    let s = `[`
    for (let i in this.values) {
      s += `${this.values[i]} `
    }
    s = s.trim()
    s += ']'
    return s
  }
}

export class Dict {
  data: Map<Value, Value>

  constructor(data: Map<Value, Value>) {
    this.data = data
  }

  toString(): string {
    let s = 'Dict {\n'
    let keyIter = this.data.keys()
    for (let key = keyIter.next(); !key.done; key = keyIter.next()) {
      s += `  (${key.value} ${this.data.get(key.value)})\n`
    }
    return s += '}'
  }
}

class ClosureMeta {
  id: string
  location: string

  constructor(id: string, location: string) {
    this.id = id
    this.location = location
  }
}

export class Closure {
  meta: ClosureMeta
  env: Env
  params: string[]
  body: Parser.Expr

  constructor(meta: ClosureMeta, env: Env, params: string[], body: Parser.Expr) {
    this.meta = meta
    this.env = env
    this.params = params
    this.body = body
  }

  toString(): string {
    let argList = `${this.params}`
    argList = argList.replace(/,/g, '')
    return `Closure (${this.meta.id} ${argList}) Expr {env}`
  }

  // refactor: let function itself decide whether to evaluate the arguments
  // call(args: Value[], location: string): Either<Value, string> {
  call(argEnv: Env, args: Parser.Expr[], location: string): Either<Value, string> {
    if (args.length !== this.params.length) {
      return new Right(`not enough argument: function '${this.meta.id}' defined${this.meta.location}: expected ${this.params.length}, got ${args.length}${location}`)
    }

    // current: user-defined functions must evaluate arguments in the beginning
    let vals: Value[] = []

    for (let i in args) {
      let val = evaluate(argEnv, args[i])
      if (val.isLeft()) {
        vals.push(val.unwrapLeft())
      } else {
        return val
      }
    }

    let env: Env = this.env
    for (let i in vals) {
      let p = this.params[i]
      let a = vals[i]
      env = env.pushed()
      env.set(p, a)
    }

    return evaluate(env, this.body)
  }
}

class BuiltinClosure {
  id: string
  params: string[]
  _call: (args: Value[], location: string, env?: Env) => Either<Value, string>

  constructor(id: string, params: string[], call: (args: Value[], location: string, env?: Env) => Either<Value, string>) {
    this.id = id
    this.params = params
    this._call = call
  }

  call(argEnv: Env, args: Parser.Expr[], location: string): Either<Value, string> {
    if (args.length !== this.params.length) {
      return new Right(`not enough argument: function '${this.id}': expected ${this.params.length}, got ${args.length}${location}`)
    }

    if (this === boolTrue) {
      return evaluate(argEnv, args[0])
    } else if (this === boolFalse) {
      return evaluate(argEnv, args[1])
    }

    let vals: Value[] = []

    for (let i in args) {
      let val = evaluate(argEnv, args[i])
      if (val.isLeft()) {
        vals.push(val.unwrapLeft())
      } else {
        return val
      }
    }

    return this._call(vals, location, argEnv)
  }

  toString(): string {
    return this.id
  }
}

const boolTrue: Value = new BuiltinClosure('#t', ['$0', '$1'], (args, _) => {
  return new Left(args[0])
})

const boolFalse: Value = new BuiltinClosure('#f', ['$0', '$1'], (args, _) => {
  return new Left(args[1])
})

function showValueType(v: Value): string {
  return typeof v === 'number' ? 'number' :
    typeof v === 'string' ? 'string' :
    v instanceof Unit ? '()' :
    v instanceof List ? 'List' :
    v instanceof Dict ? 'Dict' :
    v instanceof Closure ? 'Function' :
    v instanceof BuiltinClosure ? 'Function' :
      '(unknown)'
}

export const BUILTINS: {[keys: string]: () => Value} = {
  'add': () => 
    new BuiltinClosure('add', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l + r)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l + r)
      } else if (l instanceof List && r instanceof List) {
        return new Left(new List(l.values.concat(r.values)))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'add'${location}`)
      }
    })
  ,
  'sub': () =>
    new BuiltinClosure('sub', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l - r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'sub'${location}`)
      }
    })
  ,
  'mul': () =>
    new BuiltinClosure('mul', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l * r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'mul'${location}`)
      }
    })
  ,
  'div': () =>
    new BuiltinClosure('div', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l / r)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(path.join(l, r).replace(/\\/g, '/'))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'div'${location}`)
      }
    })
  ,
  'mod': () =>
    new BuiltinClosure('mod', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l % r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'mod'${location}`)
      }
    })
  ,
  'band': () =>
    new BuiltinClosure('band', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l & r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'band'${location}`)
      }
    })
  ,
  'bor': () =>
    new BuiltinClosure('bor', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l | r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'bor'${location}`)
      }
    })
  ,
  'bxor': () =>
    new BuiltinClosure('bxor', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l ^ r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'bxor'${location}`)
      }
    })
  ,
  'bcom': () =>
    new BuiltinClosure('add', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(~l)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'bcom'${location}`)
      }
    })
  ,
  '<<': () =>
    new BuiltinClosure('<<', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l << r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for '<<'${location}`)
      }
    })
  ,
  '>>': () =>
    new BuiltinClosure('>>', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l >> r)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for '>>'${location}`)
      }
    })
  ,
  '#t': () => boolTrue
  ,
  '#f': () => boolFalse
  ,
  '=': () =>
    new BuiltinClosure('=', ['$0', '$1'], (args, _) => {
      let [l, r] = args
      return new Left(l === r ? boolTrue : boolFalse)
    })
  ,
  '!=': () =>
    new BuiltinClosure('!=', ['$0', '$1'], (args, _) => {
      let [l, r] = args
      return new Left(l !== r ? boolTrue : boolFalse)
    })
  ,
  'lt': () =>
    new BuiltinClosure('lt', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l < r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l < r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l < r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'lt'${location}`)
      }
    })
  ,
  'gt': () =>
    new BuiltinClosure('gt', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l > r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l > r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l > r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'gt'${location}`)
      }
    })
  ,
  'le': () =>
    new BuiltinClosure('le', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l <= r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l <= r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l <= r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'le'${location}`)
      }
    })
  ,
  'ge': () =>
    new BuiltinClosure('ge', ['$0', '$1'], (args, location) => {
      let [l, r] = args
      if (typeof l === 'number' && typeof r === 'number') {
        return new Left(l >= r ? boolTrue : boolFalse)
      } else if (typeof l === 'string' && typeof r === 'string') {
        return new Left(l >= r ? boolTrue : boolFalse)
      } else if (l instanceof List && r instanceof List) {
        return new Left(l >= r ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)} ${showValueType(r)}) for 'ge'${location}`)
      }
    })
  ,
  '#int': () =>
    new BuiltinClosure('#int', ['$0'], (args, location) => {
      return new Right('not implemented: #int')
    })
  ,
  'trunc': () =>
    new BuiltinClosure('trunc', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.trunc(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'trunc'${location}`)
      }
    })
  ,
  'floor': () =>
    new BuiltinClosure('floor', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.floor(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'floor'${location}`)
      }
    })
  ,
  'ceil': () =>
    new BuiltinClosure('ceil', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.ceil(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'ceil'${location}`)
      }
    })
  ,
  'round': () =>
    new BuiltinClosure('round', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.round(l))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'round'${location}`)
      }
    })
  ,
  'abs': () =>
    new BuiltinClosure('abs', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'number') {
        return new Left(Math.abs(l))
      } else if (typeof l === 'string') {
        return new Left(path.resolve(l).replace(/\\/g, '/'))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'abs'${location}`)
      }
    })
  ,
  'show': () =>
    new BuiltinClosure('show', ['$0'], (args, location) => {
      let [l] = args
      return new Left(`${l}`)
    })
  ,
  'parse': () =>
    new BuiltinClosure('parse', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'string') {
        let f = parseFloat(l)
        if (isNaN(f)) {
          throw new Error('number NaN')
        } else {
          return new Left(parseFloat(l))
        }
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'parse'${location}`)
      }
    })
  ,
  'chars': () =>
    new BuiltinClosure('chars', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(new List(l.split('')))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'chars'${location}`)
      }
    })
  ,
  'empty?': () =>
    new BuiltinClosure('empty?', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(l.length === 0 ? boolTrue : boolFalse)
      } else if (l instanceof List) {
        return new Left(l.values.length === 0 ? boolTrue : boolFalse)
      } else if (l instanceof Dict) {
        return new Left(l.data.size === 0 ? boolTrue : boolFalse)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'empty?'${location}`)
      }
    })
  ,
  'len': () =>
    new BuiltinClosure('len', ['$0'], (args, location) => {
      let [l] = args
      if (typeof l === 'string') {
        return new Left(l.length)
      } else if (l instanceof List) {
        return new Left(l.values.length)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(l)}) for 'len'${location}`)
      }
    })
  ,
  'slice': () =>
    new BuiltinClosure('slice', ['iter', 'start', 'end'], (args, location) => {
      let [iter, st, ed] = args
      if (typeof iter === 'string' && typeof st === 'number' && typeof ed === 'number') {
        return new Left(iter.slice(st, ed))
      } else if (iter instanceof List && typeof st === 'number' && typeof ed === 'number') {
        return new Left(new List(iter.values.slice(st, ed)))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(iter)} ${showValueType(st)} ${showValueType(ed)}) for 'slice'${location}`)
      }
    })
  ,
  'del-ins': () =>
    new BuiltinClosure('del-ins', ['list', 'start', 'del-count', 'new-items'], (args, location) => {
      let [list, st, dc, ni] = args
      if (list instanceof List && typeof st === 'number' && typeof dc === 'number' && ni instanceof List) {
        list.values.splice(st, dc, ...ni.values)
        return new Left(list)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)} ${showValueType(st)} ${showValueType(dc)} ${showValueType(ni)}) for 'del-ins'${location}`)
      }
    })
  ,
  'get': () =>
    new BuiltinClosure('get', ['obj', 'attr'], (args, location) => {
      let [obj, attr] = args
      if (typeof obj === 'string' && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.length) {
          return new Right(`index out of range: ${attr} of String "${obj}"${location}`)
        }
        return new Left(obj[attr])
      } else if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Right(`index out of range: ${attr} of ${obj}${location}`)
        }
        return new Left(obj.values[attr])
      } else if (obj instanceof Dict) {
        let v = obj.data.get(attr)
        if (v === undefined) {
          return new Right(`key error: key '${attr}' not existing on ${obj}${location}`)
        }
        return new Left(v)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'get'${location}`)
      }
    })
  ,
  'tryget': () =>
    new BuiltinClosure('add', ['$0', '$1'], (args, location) => {
      let [obj, attr] = args
      if (typeof obj === 'string' && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.length) {
          return new Left(unit)
        }
        return new Left(obj[attr])
      } else if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Left(unit)
        }
        return new Left(obj.values[attr])
      } else if (obj instanceof Dict) {
        let v = obj.data.get(attr)
        if (v === undefined) {
          return new Left(unit)
        }
        return new Left(v)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'tryget'${location}`)
      }
    })
  ,
  'set': () =>
    new BuiltinClosure('set', ['obj', 'attr', 'val'], (args, location) => {
      let [obj, attr, val] = args
      if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Right(`index out of range: ${attr} of ${obj}${location}`)
        }
        obj.values[attr] = val
        return new Left(obj)
      } else if (obj instanceof Dict) {
        if (!obj.data.has(attr)) {
          return new Right(`key error: key '${attr}' not existing on ${obj}${location}`)
        }
        obj.data.set(attr, val)
        return new Left(obj)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'set'${location}`)
      }
    })
  ,
  'tryset': () =>
    new BuiltinClosure('tryset', ['obj', 'attr', 'val'], (args, location) => {
      let [obj, attr, val] = args
      if (obj instanceof List && typeof attr === 'number') {
        if (attr < 0 || attr >= obj.values.length) {
          return new Left(unit)
        }
        obj.values[attr] = val
        return new Left(obj)
      } else if (obj instanceof Dict) {
        if (!obj.data.has(attr)) {
          return new Left(unit)
        }
        obj.data.set(attr, val)
        return new Left(obj)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(obj)} ${showValueType(attr)}) for 'tryset'${location}`)
      }
    })
  ,
  'keys': () =>
    new BuiltinClosure('keys', ['dict'], (args, location) => {
      let [dict] = args
      if (dict instanceof Dict) {
        let col: Value[] = []
        let keyIter = dict.data.keys()
        for (let k = keyIter.next(); !k.done; k = keyIter.next()) {
          col.push(k.value)
        }
        return new Left(new List(col))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(dict)}) for 'keys'${location}`)
      }
    })
  ,
  'entries': () =>
    new BuiltinClosure('entries', ['dict'], (args, location) => {
      let [dict] = args
      if (dict instanceof Dict) {
        let ents: List[] = []
        let keyIter = dict.data.keys()
        for (let k = keyIter.next(); !k.done; k = keyIter.next()) {
          let v = dict.data.get(k.value)
          if (v !== undefined) {
            ents.push(new List([k.value, v]))
          } else {
            throw new Error('not possible')
          }
        }
        return new Left(new List(ents))
      } else {
        return new Right(`unaccepted arguments types (${showValueType(dict)}) for 'entries'${location}`)
      }
    })
  ,
  'push': () =>
    new BuiltinClosure('push', ['list', 'val'], (args, location) => {
      let [list, val] = args
      if (list instanceof List) {
        list.values.push(val)
        return new Left(list)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)} ${showValueType(val)}) for 'push'${location}`)
      }
    })
  ,
  'pop': () =>
    new BuiltinClosure('pop', ['list'], (args, location) => {
      let [list] = args
      if (list instanceof List) {
        if (list.values.length <= 0) {
          return new Right(`popping from empty list${location}`)
        }
        let val = list.values.pop()
        if (val !== undefined) {
          return new Left(val)
        } else {
          throw new Error('not possible')
        }
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)}) for 'pop'${location}`)
      }
    })
  ,
  'push-front': () =>
    new BuiltinClosure('push-front', ['list', 'val'], (args, location) => {
      let [list, val] = args
      if (list instanceof List) {
        list.values.unshift(val)
        return new Left(list)
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)} ${showValueType(val)}) for 'push-front'${location}`)
      }
    })
  ,
  'pop-front': () =>
    new BuiltinClosure('pop-front', ['list'], (args, location) => {
      let [list] = args
      if (list instanceof List) {
        if (list.values.length <= 0) {
          return new Right(`popping from empty list${location}`)
        }
        let val = list.values.pop()
        if (val !== undefined) {
          return new Left(val)
        } else {
          throw new Error('not possible')
        }
      } else {
        return new Right(`unaccepted arguments types (${showValueType(list)}) for 'pop-front'${location}`)
      }
    })
  ,
  'print': () =>
    new BuiltinClosure('print', ['x'], (args, location) => {
      let [x] = args
      process.stdout.write(`${x}`)
      return new Left(unit)
    })
  ,
  'println': () =>
    new BuiltinClosure('println', ['x'], (args, location) => {
      let [x] = args
      process.stdout.write(`${x}\n`)
      return new Left(unit)
    })
  ,
  'eval': () =>
    new BuiltinClosure('eval', ['src'], (args, location, env) => {
      let [src] = args
      if (typeof src !== 'string') {
        return new Right(`expected argument type (String) for 'eval'${location}`)
      }
      if (env === undefined) {
        throw new Error('empty env on BuiltinClosure call')
      }

      let parseResult = new Parser.Parser(src).parse()
      if (!parseResult.isLeft()) {
        return new Right(parseResult.unwrapRight())
      }
      let exprs = parseResult.unwrapLeft()

      let vals: Value[] = []
      for (let i in exprs) {
        let evalResult = evaluate(env, exprs[i])
        if (evalResult.isLeft()) {
          vals.push(evalResult.unwrapLeft())
        } else {
          return evalResult
        }
      }

      return new Left(vals[vals.length - 1])
    })
  ,
}

class Env {
  context: Map<string, Value>
  next: Env | undefined

  constructor(next?: Env) {
    this.context = new Map()
    this.next = next
  }

  pushed(): Env {
    return new Env(this)
  }

  /**
   * Tests whether the top context has an entry of the id.
   */
  topHas(id: string): boolean {
    return this.context.has(id)
  }

  set(id: string, value: Value): this {
    if (this.context.has(id)) {
      // in current version, let defines and reassigns variables. may change in future
      this.context.set(id, value)
      return this
    } else {
      this.context.set(id, value)
      return this
    }
  }

  lookup(id: string): Value | undefined {
    let env: Env | undefined = this
    while (env !== undefined) {
      let context = env.context
      if (context.has(id)) {
        return context.get(id)
      }
      env = env.next
    }

    return undefined
  }
}

function onceGetInitialEnv(): Env {
  let env = new Env()

  for (let id in BUILTINS) {
    env.set(id, BUILTINS[id]())
  }

  return env
}

const initialEnv = onceGetInitialEnv()

export function execute(source: string): Either<Value[], string> {
  const parser = new Parser.Parser(source)
  let ast = parser.parse()
  return ast.handle<Either<Value[], string>>(
    exprs => {
      let env = initialEnv
      let vals: Value[] = []
      for (let i = 0; i < exprs.length; i++) {
        let val = evaluate(env, exprs[i])
        if (val.isLeft()) {
          vals.push(val.unwrapLeft())
          // console.log('Internal result: ' + val.unwrapLeft()) // DEBUG
        } else {
          return new Right(val.unwrapRight())
        }
      }
      return new Left(vals)
    },
    err => new Right(err)
  )
}

const interpretEnv = initialEnv
// executes, but preserves the environment
export function interpret(source: string): Either<Value[], string> {
  const parser = new Parser.Parser(source)
  let ast = parser.parse()
  return ast.handle<Either<Value[], string>>(
    exprs => {
      let vals: Value[] = []
      for (let i = 0; i < exprs.length; i++) {
        let val = evaluate(interpretEnv, exprs[i])
        if (val.isLeft()) {
          vals.push(val.unwrapLeft())
        } else {
          return new Right(val.unwrapRight())
        }
      }
      return new Left(vals)
    },
    err => new Right(err)
  )
}

function evaluate(env: Env, expr: Parser.Expr): Either<Value, string> {
  if (typeof expr === 'number') { // => Number
    return new Left(expr)
  } else if (typeof expr === 'string') { // => String
    return new Left(expr)
  } else if (expr instanceof Parser.Var) { // => *
    let val = env.lookup(expr.id)
    if (val === undefined) {
      return new Right(`undefined variable '${expr.id}'${expr.location}`)
    } else {
      return new Left(val)
    }
  } else if (expr instanceof Parser.SExpr) {
    let caller = expr.caller
    if (caller === undefined) {
      return new Left(unit)
    } else {
      let callerVal = evaluate(env, caller)
      if (callerVal.isLeft()) {
        let clos = callerVal.unwrapLeft()
        if (clos instanceof Closure || clos instanceof BuiltinClosure) {
          // let functions themselves decide whether to evaluate the arguments
          return clos.call(env, expr.args, expr.location)
        } else {
          return new Right(`not callable: result of the first item of this s-expression is not a closure${expr.location}; result was ${clos}`)
        }
      } else {
        return callerVal
      }
    }
  } else if (expr instanceof Parser.ListExpr) {
    let vals: Value[] = []

    for (let i = 0; i < expr.items.length; i++) {
      let item = expr.items[i]
      let val = evaluate(env, item)
      if (val.isLeft()) {
        vals.push(val.unwrapLeft())
      } else {
        return val
      }
    }

    return new Left(new List(vals))
  } else if (expr instanceof Parser.DictExpr) {
    let map: Map<Value, Value> = new Map()

    for (let i = 0; i < expr.entries.length; i++) {
      let entry = expr.entries[i]
      let keyVal = evaluate(env, entry.key)
      let valVal = evaluate(env, entry.value)
      if (keyVal.isLeft() && valVal.isLeft()) {
        map.set(keyVal.unwrapLeft(), valVal.unwrapLeft())
      } else {
        if (!keyVal.isLeft()) {
          return keyVal
        } else {
          return valVal
        }
      }
    }

    return new Left(new Dict(map))
  } else if (expr instanceof Parser.ExprLetVar) {
    let bodyVal = evaluate(env, expr.expr)
    if (bodyVal.isLeft()) {
      env.set(expr.id, bodyVal.unwrapLeft())
      return new Left(bodyVal.unwrapLeft())
    } else {
      return new Right(bodyVal.unwrapRight())
    }
  } else if (expr instanceof Parser.ExprLetFunc) {
    let clos = new Closure(
      new ClosureMeta(expr.id, expr.location),
      env,
      expr.params,
      expr.body
    )
    env.set(expr.id, clos)
    return new Left(clos)
  } else if (expr instanceof Parser.ExprLambda) {
    let clos = new Closure(
      new ClosureMeta('(lambda)', expr.location),
      env,
      expr.args,
      expr.body
    )
    return new Left(clos)
  } else if (expr instanceof Parser.ExprDo) {
    let exprs = expr.exprs
    let v: Either<Value, string> = new Right('never here')
    for (let i = 0; i < exprs.length; i++) {
      let e = exprs[i]
      v = evaluate(env, e)
      if (!v.isLeft()) {
        return v
      }
    }
    return v
  } else {
    throw new Error('never here')
  }
}
