/**
 * Simplified JSON Schema type for filter configuration validation.
 * This is a subset of JSON Schema Draft 2020-12.
 */
export interface JSONSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;

  type?: JSONSchemaType | JSONSchemaType[];
  enum?: unknown[];
  const?: unknown;

  // String
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // Number
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // Array
  items?: JSONSchema | JSONSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  contains?: JSONSchema;

  // Object
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  patternProperties?: Record<string, JSONSchema>;
  propertyNames?: JSONSchema;
  minProperties?: number;
  maxProperties?: number;

  // Composition
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;

  // Conditionals
  if?: JSONSchema;
  then?: JSONSchema;
  else?: JSONSchema;

  // Metadata
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
}

export type JSONSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';
