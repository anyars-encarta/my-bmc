export interface paths {
    "/public/hosting-renewal/reference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a server-priced hosting renewal reference */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        quantityInMonths: number;
                    };
                };
            };
            responses: {
                /** @description Server-priced renewal and payment reference */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success?: boolean;
                            data?: {
                                reference?: string;
                                quantityInMonths?: number;
                                exchangeRate?: number;
                                totalCediEquivalent?: number;
                                /** Format: date */
                                startDate?: string;
                                /** Format: date */
                                endDate?: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/hosting-renewal/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm a server-issued hosting renewal payment */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        quantityInMonths: number;
                        totalCediEquivalent: number;
                        payment: {
                            reference: string;
                            amount: number;
                            /** @constant */
                            currency: "GHS";
                            status?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description Hosting renewal confirmed */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid quote or payment */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description No stored renewal matches the payment reference */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description The stored renewal is not awaiting confirmation */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/staff/{staffId}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Staff assignment history */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    staffId: components["parameters"]["StaffId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Assignment history */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data?: components["schemas"]["AssignmentRecord"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Create a temporary or cover assignment */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    staffId: components["parameters"]["StaffId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TemporaryAssignmentRequest"];
                };
            };
            responses: {
                /** @description Assignment created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AssignmentResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/{staffId}/effective-unit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Resolve a staff member's effective unit on a date */
        get: {
            parameters: {
                query?: {
                    on?: string;
                };
                header?: never;
                path: {
                    staffId: components["parameters"]["StaffId"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Effective assignment */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data?: {
                                /** Format: date */
                                on?: string;
                                assignment?: components["schemas"]["AssignmentRecord"] | null;
                            };
                        };
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
    "/staff/{staffId}/transfers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Schedule a permanent staff transfer */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    staffId: components["parameters"]["StaffId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TransferRequest"];
                };
            };
            responses: {
                /** @description Transfer scheduled */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AssignmentResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/staff/{staffId}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deactivate a staff member and cancel future work */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    staffId: components["parameters"]["StaffId"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["StaffDeactivationRequest"];
                };
            };
            responses: {
                /** @description Staff member deactivated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transfer-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List transfer batches */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Transfer batches */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data?: components["schemas"]["TransferBatch"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Create a transfer batch draft */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TransferBatchRequest"];
                };
            };
            responses: {
                /** @description Draft created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TransferBatchResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transfer-batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit a transfer batch draft */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TransferBatchRequest"];
                };
            };
            responses: {
                /** @description Draft updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TransferBatchResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/transfer-batches/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preview transfer batch coverage impact */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Coverage preview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data?: components["schemas"]["TransferBatchPreview"];
                        };
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
    "/transfer-batches/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a transfer batch */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Batch approved */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transfer-batches/{id}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Atomically apply an approved transfer batch */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Batch applied */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/transfer-batches/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel an approved transfer batch */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Batch cancelled */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Batch not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Batch is not approved */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/unit-staffing-requirements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List minimum staffing requirements */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Staffing requirements */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data?: components["schemas"]["StaffingRequirement"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Create a minimum staffing requirement */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["StaffingRequirementRequest"];
                };
            };
            responses: {
                /** @description Requirement created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/unit-staffing-requirements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a minimum staffing requirement */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Requirement deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        /** Update a minimum staffing requirement */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["StaffingRequirementRequest"];
                };
            };
            responses: {
                /** @description Requirement updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AssignmentRecord: {
            /** Format: uuid */
            id?: string;
            /** Format: uuid */
            orgUnitId?: string;
            unitName?: string;
            unitCode?: string;
            /** @enum {string} */
            assignmentType?: "PRIMARY" | "TEMPORARY" | "COVER";
            /** Format: date */
            effectiveFrom?: string;
            /** Format: date */
            effectiveTo?: string | null;
            reason?: string;
            note?: string | null;
        };
        AssignmentResponse: {
            data?: components["schemas"]["AssignmentRecord"];
        };
        TemporaryAssignmentRequest: {
            /** Format: uuid */
            orgUnitId: string;
            /** @enum {string} */
            assignmentType: "TEMPORARY" | "COVER";
            /** Format: date */
            effectiveFrom: string;
            /** Format: date */
            effectiveTo: string;
            /** @enum {string} */
            reason?: "SECONDMENT" | "COVER";
            note?: string;
        };
        TransferRequest: {
            /** Format: uuid */
            toUnitId: string;
            /** Format: date */
            effectiveFrom: string;
            /** @enum {string} */
            reason?: "TRANSFER" | "RESHUFFLE" | "PROMOTION" | "RETURN";
            note?: string;
        };
        StaffDeactivationRequest: {
            reason: string;
        };
        TransferBatchItemRequest: {
            /** Format: uuid */
            staffId: string;
            /** Format: uuid */
            toUnitId: string;
            /** @enum {string} */
            reason?: "RESHUFFLE" | "TRANSFER" | "PROMOTION" | "RETURN";
            note?: string;
        };
        TransferBatchRequest: {
            title: string;
            /** Format: date */
            effectiveFrom: string;
            items: components["schemas"]["TransferBatchItemRequest"][];
        };
        TransferBatch: {
            /** Format: uuid */
            id?: string;
            title?: string;
            /** Format: date */
            effectiveFrom?: string;
            /** @enum {string} */
            status?: "DRAFT" | "APPROVED" | "APPLIED" | "CANCELLED";
            items?: Record<string, never>[];
        };
        TransferBatchResponse: {
            data?: components["schemas"]["TransferBatch"];
        };
        TransferBatchPreview: {
            /** Format: uuid */
            batchId?: string;
            title?: string;
            /** Format: date */
            effectiveFrom?: string;
            moves?: Record<string, never>[];
            coverage?: Record<string, never>[];
        };
        StaffingRequirement: {
            /** Format: uuid */
            id?: string;
            /** Format: uuid */
            orgUnitId?: string;
            unitName?: string;
            unitCode?: string;
            /** Format: uuid */
            shiftTypeId?: string;
            shiftName?: string;
            /** Format: uuid */
            jobRoleId?: string | null;
            roleName?: string | null;
            minStaff?: number;
        };
        StaffingRequirementRequest: {
            /** Format: uuid */
            orgUnitId: string;
            /** Format: uuid */
            shiftTypeId: string;
            /** Format: uuid */
            jobRoleId?: string | null;
            minStaff: number;
        };
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
    parameters: {
        Id: string;
        StaffId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
