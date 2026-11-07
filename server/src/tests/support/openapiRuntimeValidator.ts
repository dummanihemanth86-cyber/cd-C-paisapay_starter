import { expect } from 'vitest';

type Schema = {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  required?: string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: boolean | Schema;
};
type Spec = {
  paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>;
  components: { schemas: Record<string, Schema> };
};
type HttpResponse = { status: number; headers: Record<string, string>; body: unknown };

function validateValue(value: unknown, schema: Schema, pointer: string, spec: Spec): void {
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1)!;
    const target = spec.components.schemas[name];
    expect(target, `${pointer} schema ref ${schema.$ref}`).toBeDefined();
    validateValue(value, target, pointer, spec);
    return;
  }
  if (value === null) {
    expect(schema.nullable, `${pointer} nullability`).toBe(true);
    return;
  }
  if (schema.type === 'object') {
    expect(value, `${pointer} object`).not.toBeNull();
    expect(typeof value, `${pointer} object`).toBe('object');
    expect(Array.isArray(value), `${pointer} object`).toBe(false);
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) expect(record, `${pointer}.${name} required`).toHaveProperty(name);
    for (const [name, child] of Object.entries(record)) {
      const property = schema.properties?.[name];
      if (property) validateValue(child, property, `${pointer}.${name}`, spec);
      else if (schema.additionalProperties === false) throw new Error(`${pointer}.${name} is not allowed by the OpenAPI schema`);
      else if (typeof schema.additionalProperties === 'object') validateValue(child, schema.additionalProperties, `${pointer}.${name}`, spec);
    }
  } else if (schema.type === 'array') {
    expect(Array.isArray(value), `${pointer} array`).toBe(true);
    if (schema.items) for (const [index, item] of (value as unknown[]).entries()) validateValue(item, schema.items, `${pointer}[${index}]`, spec);
  } else if (schema.type === 'integer') {
    expect(Number.isSafeInteger(value), `${pointer} integer`).toBe(true);
  } else if (schema.type === 'number') {
    expect(typeof value === 'number' && Number.isFinite(value), `${pointer} number`).toBe(true);
  } else if (schema.type === 'boolean') {
    expect(typeof value, `${pointer} boolean`).toBe('boolean');
  } else if (schema.type === 'string') {
    expect(typeof value, `${pointer} string`).toBe('string');
  }
  if (schema.enum) expect(schema.enum, `${pointer} enum`).toContain(value);
}

export function assertOpenApiResponse(spec: Spec, method: string, path: string, response: HttpResponse): void {
  const normalizedPath = path.split('?')[0];
  const operation = spec.paths[normalizedPath]?.[method.toLowerCase()] ?? Object.entries(spec.paths).find(([template]) => {
    const pattern = new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^/]+\\\}/g, '[^/]+')}$`);
    return pattern.test(normalizedPath);
  })?.[1]?.[method.toLowerCase()];
  expect(operation, `${method} ${path} operation`).toBeDefined();
  const responseSpec = operation?.responses?.[String(response.status)];
  expect(responseSpec, `${method} ${path} ${response.status} documented status`).toBeDefined();
  if (response.status === 204) return;
  const content = responseSpec?.content;
  expect(content, `${method} ${path} ${response.status} documented content`).toBeDefined();
  const contentType = response.headers['content-type'] ?? '';
  const mediaType = Object.keys(content ?? {}).find((type) => contentType.includes(type));
  expect(mediaType, `${method} ${path} response content type ${contentType}`).toBeDefined();
  const schema = content?.[mediaType!]?.schema;
  expect(schema, `${method} ${path} response schema`).toBeDefined();
  if (schema) validateValue(response.body, schema, `${method} ${path} ${response.status}`, spec);
}
