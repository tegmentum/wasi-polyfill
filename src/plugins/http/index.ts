/**
 * HTTP plugin exports
 *
 * Provides HTTP client and server support for WASI Preview 2 components.
 */

// Plugin definitions
export {
  HTTP_TYPES_INTERFACE,
  HTTP_OUTGOING_HANDLER_INTERFACE,
  HTTP_INCOMING_HANDLER_INTERFACE,
  httpTypesPlugin,
  httpOutgoingHandlerPlugin,
  httpIncomingHandlerPlugin,
  httpPlugins,
} from './plugin.js'

// Types
export {
  type Method,
  type Scheme,
  type HttpError,
  type DnsErrorPayload,
  type TlsAlertReceivedPayload,
  type FieldSizePayload,
  type RequestOptions,
  HttpErrorCode,
  methodToString,
  stringToMethod,
  schemeToString,
  stringToScheme,
  mapFetchError,
} from './types.js'

// Fields resource
export {
  type FieldEntry,
  Fields,
  FieldsRegistry,
  globalFieldsRegistry,
} from './fields.js'

// Outgoing handler
export {
  type OutgoingHandlerConfig,
  type OutgoingRequest,
  type IncomingResponse,
  type FutureIncomingResponse,
  type RequestOptionsResource,
  OutgoingRequestRegistry,
  IncomingResponseRegistry,
  FutureIncomingResponseRegistry,
  RequestOptionsRegistry,
  globalOutgoingRequestRegistry,
  globalIncomingResponseRegistry,
  globalFutureIncomingResponseRegistry,
  globalRequestOptionsRegistry,
  fetchOutgoingHandlerImplementation,
  fetchHttpTypesImplementation,
} from './outgoing-handler.js'

// Incoming handler
export {
  type IncomingHandlerConfig,
  type IncomingRequestHandler,
  type IncomingRequestData,
  type ResponseOutparam,
  type OutgoingResponseData,
  type IncomingRequest,
  type OutgoingResponse,
  type ResponseOutparamResource,
  IncomingRequestRegistry,
  OutgoingResponseRegistry,
  ResponseOutparamRegistry,
  globalIncomingRequestRegistry,
  globalOutgoingResponseRegistry,
  globalResponseOutparamRegistry,
  stubIncomingHandlerImplementation,
  callbackIncomingHandlerImplementation,
  incomingRequestTypesImplementation,
} from './incoming-handler.js'

// Service Worker integration
export {
  type ServiceWorkerHandlerConfig,
  type ServiceWorkerFetchHandler,
  ServiceWorkerHandler,
  ServiceWorkerAdapter,
  createServiceWorkerHandler,
  registerServiceWorkerHandler,
  isServiceWorkerContext,
  serviceWorkerIncomingHandlerImplementation,
} from './service-worker.js'
