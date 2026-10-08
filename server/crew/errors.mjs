// server/crew/errors.mjs
/**
 * Something the crew backend refuses to do, said in words a person can act on.
 *
 * `code` is for the page to branch on, `status` is the HTTP status the API answers with.
 * Anything that is not a CrewError is a fault, and is reported as one.
 */
export class CrewError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'CrewError'
    this.code = code
    this.status = status
  }
}
