import bodyParser from '@koa/bodyparser'

/**
 * Parse every request shape used by the local APIs. `text` is required by the
 * Hermes Studio command-provider bridge, which posts the TTS input file as
 * `text/plain`.
 */
export function createRequestBodyParser() {
  return bodyParser({
    encoding: 'utf-8',
    enableTypes: ['json', 'form', 'text'],
    jsonLimit: '100mb',
    formLimit: '100mb',
    textLimit: '100mb',
    parsedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  })
}
