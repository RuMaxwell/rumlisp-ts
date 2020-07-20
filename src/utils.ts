export interface Either<L, R> {
  isLeft(): boolean
  unwrapLeft(): L
  unwrapRight(): R
  handle<T>(leftHandler: (value: L) => T, rightHandler: (value: R) => T): T
}

export class Left<L, R> implements Either<L, R> {
  value: L

  constructor(value: L) {
    this.value = value
  }

  isLeft(): boolean {
    return true
  }

  unwrapLeft(): L {
    return this.value
  }

  unwrapRight(): R {
    throw new Error('in instance of type `Either`: not a left value')
  }

  handle<T>(leftHandler: (value: L) => T, _rightHandler: (value: R) => T): T {
    return leftHandler(this.value)
  }
}

export class Right<L, R> implements Either<L, R> {
  value: R

  constructor(value: R) {
    this.value = value
    throw new Error(`${this.value}`)
  }

  isLeft(): boolean {
    return false
  }

  unwrapLeft(): L {
    throw new Error('in instance of type `Either`: not a right value')
  }

  unwrapRight(): R {
    return this.value
  }

  handle<T>(_leftHandler: (value: L) => T, rightHandler: (value: R) => T): T {
    return rightHandler(this.value)
  }
}
