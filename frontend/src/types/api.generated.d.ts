export interface paths {
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current authenticated profile */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current user profile and permissions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MeResponseEnvelope"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users */
        get: {
            parameters: {
                query?: {
                    page?: number;
                    limit?: number;
                    sort?: string;
                    q?: string;
                    status?: string;
                    role?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated users */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserListResponseEnvelope"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
            hasMore: boolean;
        };
        ProblemError: {
            type: string;
            title: string;
            status: number;
            error: string;
            message: string;
            code?: string;
            requestId: string;
            details?: unknown;
        };
        MePayload: {
            user: {
                id: string;
                name: string;
                /** Format: email */
                email: string;
                status: string;
            };
            roles: string[];
            unitScopes: Record<string, never>[];
            permissions: string[];
        };
        MeResponseEnvelope: {
            data: components["schemas"]["MePayload"];
        };
        UserListResponseEnvelope: {
            data: {
                id: string;
                name: string;
                /** Format: email */
                email: string;
                status: string;
                roles: string[];
                permissions: string[];
            }[];
            pagination: components["schemas"]["Pagination"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
