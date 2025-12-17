/**
 * wasi:http plugin definitions
 *
 * Includes:
 * - wasi:http/types - HTTP types (request, response, headers)
 * - wasi:http/outgoing-handler - Make outgoing HTTP requests
 * - wasi:http/incoming-handler - Handle incoming HTTP requests
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { fetchHttpTypesImplementation, fetchOutgoingHandlerImplementation } from './outgoing-handler.js'
import {
  stubIncomingHandlerImplementation,
  callbackIncomingHandlerImplementation,
  incomingRequestTypesImplementation,
} from './incoming-handler.js'
import { serviceWorkerIncomingHandlerImplementation } from './service-worker.js'

/**
 * WASI http/types interface definition
 */
export const HTTP_TYPES_INTERFACE: WasiInterface = {
  package: 'wasi:http',
  name: 'types',
  version: '0.2.0',
}

/**
 * WASI http/outgoing-handler interface definition
 */
export const HTTP_OUTGOING_HANDLER_INTERFACE: WasiInterface = {
  package: 'wasi:http',
  name: 'outgoing-handler',
  version: '0.2.0',
}

/**
 * WASI http/incoming-handler interface definition
 */
export const HTTP_INCOMING_HANDLER_INTERFACE: WasiInterface = {
  package: 'wasi:http',
  name: 'incoming-handler',
  version: '0.2.0',
}

/**
 * wasi:http/types plugin
 *
 * Provides HTTP types including request, response, headers (fields),
 * and related resources.
 */
export const httpTypesPlugin: WasiPlugin = createPlugin(
  HTTP_TYPES_INTERFACE,
  {
    fetch: fetchHttpTypesImplementation,
    incoming: incomingRequestTypesImplementation,
  },
  'fetch'
)

/**
 * wasi:http/outgoing-handler plugin
 *
 * Provides the ability to make outgoing HTTP requests.
 * Uses the browser Fetch API in the browser environment.
 */
export const httpOutgoingHandlerPlugin: WasiPlugin = createPlugin(
  HTTP_OUTGOING_HANDLER_INTERFACE,
  {
    fetch: fetchOutgoingHandlerImplementation,
  },
  'fetch'
)

/**
 * wasi:http/incoming-handler plugin
 *
 * Provides the ability to handle incoming HTTP requests.
 * In browsers, this integrates with Service Workers.
 *
 * Implementations:
 * - stub: Returns 501 Not Implemented
 * - callback: Allows registering a callback handler
 * - service-worker: Service Worker integration for browser fetch events
 */
export const httpIncomingHandlerPlugin: WasiPlugin = createPlugin(
  HTTP_INCOMING_HANDLER_INTERFACE,
  {
    stub: stubIncomingHandlerImplementation,
    callback: callbackIncomingHandlerImplementation,
    'service-worker': serviceWorkerIncomingHandlerImplementation,
  },
  'stub'
)

/**
 * All HTTP plugins for convenient registration
 */
export const httpPlugins: WasiPlugin[] = [
  httpTypesPlugin,
  httpOutgoingHandlerPlugin,
  httpIncomingHandlerPlugin,
]
