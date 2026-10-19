/** Single source for published JSON Schemas and the structural validator.
 * Only this deliberately small standard-JSON-Schema vocabulary is used. */
type Schema = {
    type?: string | string[];
    const?: unknown;
    enum?: unknown[];
    pattern?: string;
    minLength?: number;
    minimum?: number;
    properties?: Record<string, Schema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: Schema;
    uniqueItems?: boolean;
    minItems?: number;
    anyOf?: Schema[];
    $schema?: string;
    $id?: string;
};
export declare const manifestSchema: Schema;
export declare const returnSchema: Schema;
export declare function matchesSchema(schema: Schema, value: unknown): boolean;
export {};
