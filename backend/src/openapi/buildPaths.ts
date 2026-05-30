import type { RouteCatalogEntry, HttpMethod } from './routeCatalog.js';

type OpenApiPaths = Record<string, Record<string, unknown>>;

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function authSecurity(auth: RouteCatalogEntry['auth']) {
  if (auth === 'none') return undefined;
  return [{ bearerAuth: [] }];
}

function defaultResponses(
  method: HttpMethod,
  auth: RouteCatalogEntry['auth'],
  hasRequestBody: boolean
): Record<string, { description: string }> {
  const responses: Record<string, { description: string }> = {
    '200': { description: 'Success' },
  };

  if (method === 'post') {
    responses['201'] = { description: 'Created' };
  }

  if (hasRequestBody || method === 'put') {
    responses['400'] = { description: 'Bad request' };
    responses['422'] = { description: 'Validation error' };
  }

  if (auth !== 'none') {
    responses['401'] = { description: 'Unauthorized — missing or invalid JWT' };
  }

  if (auth === 'jwt-admin') {
    responses['403'] = { description: 'Forbidden — admin role required' };
  }

  if (method === 'get' || method === 'put' || method === 'delete') {
    responses['404'] = { description: 'Resource not found' };
  }

  responses['500'] = { description: 'Internal server error' };

  return responses;
}

function successStatusForPost(path: string): '200' | '201' {
  const createsResource =
    path.endsWith('/register') ||
    path === '/api/portfolio' ||
    path === '/api/watchlist' ||
    path === '/api/calendar/reminders' ||
    path === '/api/user/api-keys' ||
    path === '/api/user/create-account';
  return createsResource ? '201' : '200';
}

function buildOperation(entry: RouteCatalogEntry): Record<string, unknown> {
  const hasRequestBody =
    (entry.method === 'post' || entry.method === 'put') && entry.requestExample !== undefined;
  const security = authSecurity(entry.auth);

  const operation: Record<string, unknown> = {
    tags: [entry.tag],
    summary: entry.summary,
    ...(entry.notes ? { description: entry.notes } : {}),
    ...(security ? { security } : {}),
    responses: defaultResponses(entry.method, entry.auth, hasRequestBody),
  };

  const pathParams = [...entry.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  if (pathParams.length > 0) {
    operation.parameters = pathParams.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: {
        type:
          name === 'id' || name === 'keyId' || name === 'orderId' ? 'integer' : 'string',
      },
    }));
  }

  if (entry.requestExample) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          example: entry.requestExample,
        },
      },
    };
  }

  if (entry.responseExample !== undefined) {
    const responseCode =
      entry.method === 'post' ? successStatusForPost(entry.path) : '200';

    (operation.responses as Record<string, unknown>)[responseCode] = {
      description: 'Success',
      content: {
        'application/json': {
          example: entry.responseExample,
        },
      },
    };
  }

  return operation;
}

export function buildPathsFromCatalog(catalog: RouteCatalogEntry[]): OpenApiPaths {
  const paths: OpenApiPaths = {};

  for (const entry of catalog) {
    const openApiPath = toOpenApiPath(entry.path);
    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }
    paths[openApiPath][entry.method] = buildOperation(entry);
  }

  return paths;
}
