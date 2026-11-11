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
    "/patients": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search patients
         * @description Exact lookups by MRN, phone and identifier number plus trigram name search, widening to sound-alike surnames when nothing matches. RESTRICTED/VIP rows are masked unless the caller holds a break-glass grant.
         */
        get: {
            parameters: {
                query?: {
                    page?: number;
                    limit?: number;
                    q?: string;
                    sort?: "lastName" | "-lastName" | "registeredAt" | "-registeredAt" | "mrn" | "-mrn";
                    status?: "ACTIVE" | "INACTIVE" | "DECEASED" | "MERGED";
                    status__in?: string;
                    sex?: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
                    confidentiality?: "NORMAL" | "RESTRICTED" | "VIP";
                    isUnidentified?: "true" | "false";
                    registeredAt__gte?: string;
                    registeredAt__lte?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated patients */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientSummary"][];
                            pagination: components["schemas"]["Pagination"];
                            meta: {
                                /** @description Set when the search matched the MRN of a merged record; the row is the surviving patient. */
                                mergedFromMrn: string | null;
                            };
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Register a patient
         * @description Runs the duplicate detector first. Send `unidentified: true` for the emergency unknown-patient flow.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatientRegistrationRequest"] | components["schemas"]["UnidentifiedPatientRequest"];
                };
            };
            responses: {
                /** @description Registered */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientDetail"];
                            meta?: {
                                acknowledgedDuplicates: number;
                            };
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description `PATIENT_DUPLICATE_CANDIDATES` (details.candidates, details.blocking) or `PATIENT_IDENTIFIER_IN_USE` */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Pick-list data for the registry screens */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Units, consent witnesses and registry settings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientReferences"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/duplicate-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Live duplicate check for the registration wizard */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DuplicateCheckRequest"];
                };
            };
            responses: {
                /** @description Candidates */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["DuplicateCheckResult"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/duplicates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Duplicate review queue */
        get: {
            parameters: {
                query?: {
                    page?: number;
                    limit?: number;
                    status?: "PENDING" | "DISMISSED" | "MERGED";
                    sort?: "-score" | "-detectedAt";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Candidate pairs */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["DuplicatePair"][];
                            pagination: components["schemas"]["Pagination"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/duplicates/sweep": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run the duplicate sweep now */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        sinceDays?: number;
                    };
                };
            };
            responses: {
                /** @description Sweep result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                scanned: number;
                                queued: number;
                            };
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/duplicates/{candidateId}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark a candidate pair as different patients */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    candidateId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Dismissed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                status: string;
                            };
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Already reviewed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/merge/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Side-by-side comparison and merge pre-checks */
        get: {
            parameters: {
                query: {
                    survivorId: string;
                    mergedId: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Preview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["MergePreview"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Merge a duplicate into the surviving record */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MergeRequest"];
                };
            };
            responses: {
                /** @description Merged; module re-pointing is tracked by merge tasks */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["MergeResult"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description A pre-check failed (`PATIENT_MERGE_*`) or a record changed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Open a patient chart */
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
                /** @description Chart header, or a pointer to the survivor when the record was merged */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientChart"] | components["schemas"]["PatientMergedPointer"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update demographics, status or confidentiality */
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
                    "application/json": components["schemas"]["PatientUpdateRequest"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientChart"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description `CONCURRENT_MODIFICATION` */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/patients/{id}/identify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Identify an unidentified patient, or merge it into an existing record */
        post: {
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
                    "application/json": components["schemas"]["PatientIdentifyRequest"] | components["schemas"]["PatientIdentifyByMergeRequest"];
                };
            };
            responses: {
                /** @description Identified */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientDetail"] | components["schemas"]["PatientIdentifyByMergeResult"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Already identified, duplicate candidates or a concurrent change */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/identifiers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a patient's identifiers */
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
                /** @description Patient identifiers */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientIdentifier"][];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        /** Add a patient identifier */
        post: {
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
                    "application/json": components["schemas"]["PatientIdentifierInput"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientIdentifier"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/identifiers/{identifierId}": {
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
        /** Update a patient identifier */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                    identifierId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatientIdentifierUpdate"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientIdentifier"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/patients/{id}/contacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a patient's contacts */
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
                /** @description Patient contacts */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientContact"][];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        /** Add a patient contact */
        post: {
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
                    "application/json": components["schemas"]["PatientContactInput"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientContact"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/contacts/{contactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a patient contact */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                    contactId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                success: boolean;
                            };
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** Update a patient contact */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                    contactId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatientContactUpdate"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientContact"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/patients/{id}/allergies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a patient's allergies */
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
                /** @description Patient allergies */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientAllergy"][];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        /** Add a patient allergie */
        post: {
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
                    "application/json": components["schemas"]["PatientAllergyInput"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientAllergy"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/allergies/{allergyId}": {
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
        /** Update a patient allergie */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                    allergyId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatientAllergyUpdate"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientAllergy"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/patients/{id}/conditions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List a patient's conditions */
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
                /** @description Patient conditions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientCondition"][];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        /** Add a patient condition */
        post: {
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
                    "application/json": components["schemas"]["PatientConditionInput"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientCondition"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/conditions/{conditionId}": {
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
        /** Update a patient condition */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                    conditionId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatientConditionUpdate"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientCondition"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/patients/{id}/consents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Effective consents and consent history */
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
                /** @description Consents */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientConsents"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
            };
        };
        put?: never;
        /** Record a consent decision */
        post: {
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
                    "application/json": components["schemas"]["PatientConsentInput"];
                };
            };
            responses: {
                /** @description Recorded */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientConsentRecord"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Visits, encounters, results and admissions */
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
                /** @description Timeline, newest first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientTimelineEvent"][];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/photo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Save or remove the patient photo
         * @description Saving a photo needs a granted PHOTOGRAPHY consent (`403 CONSENT_REQUIRED`).
         */
        post: {
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
                    "application/json": components["schemas"]["PatientPhotoRequest"];
                };
            };
            responses: {
                /** @description Saved */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientPhotoResult"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description `CONCURRENT_MODIFICATION` */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/wristband": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Wristband PDF with the Code 128 MRN */
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
                /** @description Wristband PDF */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/pdf": string;
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/card": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Patient card PDF with the Code 128 MRN */
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
                /** @description Patient card PDF */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/pdf": string;
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/patients/{id}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audit trail of a patient record */
        get: {
            parameters: {
                query?: {
                    page?: number;
                    limit?: number;
                    action?: string;
                    action__in?: string;
                };
                header?: never;
                path: {
                    id: components["parameters"]["Id"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Audit entries */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["PatientAuditEntry"][];
                            pagination: components["schemas"]["Pagination"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/merge-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent merges and their re-pointing status */
        get: {
            parameters: {
                query?: {
                    page?: number;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Merges */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["MergeSummary"][];
                            pagination: components["schemas"]["Pagination"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/merge-tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Status of one merge */
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
                /** @description Merge status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["MergeSummary"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Merge not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/merge-tasks/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry the unfinished re-pointing tasks of a merge */
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
                /** @description Merge status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["MergeSummary"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Merge not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/break-glass": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request break-glass access to a restricted record
         * @description Grants 4 hours of access, audits the reason and notifies the DPO and unit manager.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["BreakGlassRequest"];
                };
            };
            responses: {
                /** @description An active grant already exists */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["BreakGlassGrant"];
                        };
                    };
                };
                /** @description Granted */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["BreakGlassGrant"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Patient not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description `BREAK_GLASS_NOT_REQUIRED` */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/privacy/break-glass-reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Break-glass review queue
         * @description The DPO and auditors see every grant; unit managers see grants for patients registered in their unit subtree.
         */
        get: {
            parameters: {
                query?: {
                    page?: number;
                    limit?: number;
                    status?: "PENDING" | "REVIEWED" | "ALL";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Grants */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: components["schemas"]["BreakGlassReviewItem"][];
                            pagination: components["schemas"]["Pagination"];
                        };
                    };
                };
                /** @description Role not permitted, or a restricted record without break-glass (`code=BREAK_GLASS_REQUIRED`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
    "/privacy/break-glass-reviews/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Record the review outcome of a break-glass access */
        post: {
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
                    "application/json": components["schemas"]["BreakGlassReviewRequest"];
                };
            };
            responses: {
                /** @description Reviewed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            data: {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                reviewOutcome: "JUSTIFIED" | "UNJUSTIFIED" | "ESCALATED";
                                /** Format: date-time */
                                reviewedAt: string;
                            };
                        };
                    };
                };
                /** @description Not permitted, or reviewing your own access (`BREAK_GLASS_SELF_REVIEW`) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Already reviewed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
                    };
                };
                /** @description Validation failure or business rule; `code` identifies the rule */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemError"];
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
        PatientSummary: {
            /** Format: uuid */
            id: string;
            mrn: string | null;
            firstName: string | null;
            middleName: string | null;
            lastName: string | null;
            preferredName: string | null;
            fullName: string;
            /** @enum {string|null} */
            sex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN" | null;
            /** Format: date */
            dateOfBirth: string | null;
            dobEstimated: boolean;
            estimatedAgeYears: number | null;
            ageYears: number | null;
            isMinor: boolean;
            photoUrl: string | null;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE" | "DECEASED" | "MERGED";
            /** Format: date-time */
            deceasedAt: string | null;
            /** @enum {string} */
            confidentiality: "NORMAL" | "RESTRICTED" | "VIP";
            isUnidentified: boolean;
            /** Format: date-time */
            registeredAt: string | null;
            /** @description True when the identity is hidden because the record is RESTRICTED/VIP and the caller holds no break-glass grant. */
            masked: boolean;
            /** @description Fields withheld from the caller's role. */
            redacted: string[];
            phone?: string | null;
        };
        PatientDetail: {
            /** Format: uuid */
            id: string;
            mrn: string | null;
            firstName: string | null;
            middleName: string | null;
            lastName: string | null;
            preferredName: string | null;
            fullName: string;
            /** @enum {string|null} */
            sex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN" | null;
            /** Format: date */
            dateOfBirth: string | null;
            dobEstimated: boolean;
            estimatedAgeYears: number | null;
            ageYears: number | null;
            isMinor: boolean;
            photoUrl: string | null;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE" | "DECEASED" | "MERGED";
            /** Format: date-time */
            deceasedAt: string | null;
            /** @enum {string} */
            confidentiality: "NORMAL" | "RESTRICTED" | "VIP";
            isUnidentified: boolean;
            /** Format: date-time */
            registeredAt: string | null;
            /** @description True when the identity is hidden because the record is RESTRICTED/VIP and the caller holds no break-glass grant. */
            masked: boolean;
            /** @description Fields withheld from the caller's role. */
            redacted: string[];
            /** @enum {string|null} */
            maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | "OTHER" | null;
            nationality?: string | null;
            religion?: string | null;
            occupation?: string | null;
            /** @enum {string|null} */
            bloodGroup?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | null;
            phone?: string | null;
            altPhone?: string | null;
            email?: string | null;
            addressLine?: string | null;
            town?: string | null;
            district?: string | null;
            region?: string | null;
            digitalAddress?: string | null;
            photoPublicId?: string | null;
            /** Format: uuid */
            mergedIntoId?: string | null;
            /** Format: uuid */
            registeredUnitId?: string | null;
            version?: number;
            /** Format: date-time */
            updatedAt?: string;
        };
        PatientAllergySummary: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            category: "DRUG" | "FOOD" | "LATEX" | "ENVIRON" | "OTHER";
            substance: string;
            reaction: string | null;
            /** @enum {string|null} */
            severity: "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" | null;
        };
        PatientBreakGlassState: {
            /** Format: date-time */
            expiresAt: string;
            reason: string;
        } | null;
        PatientChart: components["schemas"]["PatientDetail"] & {
            allergies: components["schemas"]["PatientAllergySummary"][];
            /** @enum {string|null} */
            restriction: "RESTRICTED" | "VIP" | "SELF" | null;
            breakGlass: components["schemas"]["PatientBreakGlassState"];
        };
        PatientMergedPointer: {
            /** Format: uuid */
            id: string;
            mrn: string;
            /** @enum {string} */
            status: "MERGED";
            /** Format: uuid */
            mergedIntoId: string | null;
        };
        PatientIdentifierInput: {
            /** @enum {string} */
            idType: "NHIS" | "GHANA_CARD" | "PASSPORT" | "DRIVERS_LICENCE" | "VOTER_ID" | "SSNIT" | "STAFF_ID" | "EXTERNAL_MRN";
            idValue: string;
            issuer?: string | null;
            /** Format: date */
            validTo?: string | null;
        };
        PatientContactInput: {
            /** @enum {string} */
            contactType: "NEXT_OF_KIN" | "EMERGENCY" | "GUARDIAN" | "EMPLOYER";
            name: string;
            relationship?: string | null;
            phone?: string | null;
            address?: string | null;
            isPrimary?: boolean;
            canConsent?: boolean;
        };
        PatientConsentEntry: {
            /** @enum {string} */
            consentType: "TREATMENT" | "DATA_PROCESSING" | "SMS_CONTACT" | "INSURER_SHARING" | "PHOTOGRAPHY" | "RESEARCH";
            /** @enum {string} */
            status: "GRANTED" | "WITHDRAWN" | "DECLINED";
            note?: string | null;
        };
        PatientRegistrationRequest: {
            firstName: string;
            middleName?: string | null;
            lastName: string;
            preferredName?: string | null;
            /** @enum {string} */
            sex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
            /** Format: date */
            dateOfBirth?: string | null;
            dobEstimated?: boolean;
            estimatedAgeYears?: number | null;
            /** @enum {string|null} */
            maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | "OTHER" | null;
            nationality?: string | null;
            religion?: string | null;
            occupation?: string | null;
            /** @enum {string|null} */
            bloodGroup?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | null;
            phone?: string | null;
            altPhone?: string | null;
            email?: string | null;
            addressLine?: string | null;
            town?: string | null;
            district?: string | null;
            region?: string | null;
            digitalAddress?: string | null;
            identifiers?: components["schemas"]["PatientIdentifierInput"][];
            contacts?: components["schemas"]["PatientContactInput"][];
            consents?: components["schemas"]["PatientConsentEntry"][];
            /** @enum {string} */
            captureMethod?: "PAPER" | "ELECTRONIC" | "VERBAL_WITNESSED";
            /** Format: uuid */
            witnessStaffId?: string | null;
            /** @description Set after the registrar has reviewed the duplicate candidates. */
            acknowledgeDuplicates?: boolean;
            /** @description Required (min 10 characters) when a BLOCK-level candidate is overridden. */
            duplicateOverrideReason?: string | null;
            /** @enum {boolean} */
            unidentified?: false;
            /** @enum {string} */
            confidentiality?: "NORMAL" | "RESTRICTED" | "VIP";
            /** Format: uuid */
            registeredUnitId?: string | null;
        };
        UnidentifiedPatientRequest: {
            /** @enum {boolean} */
            unidentified: true;
            /** @enum {string} */
            sex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
            estimatedAgeYears: number;
            /** Format: uuid */
            registeredUnitId?: string | null;
        };
        PatientIdentifyRequest: {
            firstName: string;
            middleName?: string | null;
            lastName: string;
            preferredName?: string | null;
            /** @enum {string} */
            sex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
            /** Format: date */
            dateOfBirth?: string | null;
            dobEstimated?: boolean;
            estimatedAgeYears?: number | null;
            /** @enum {string|null} */
            maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | "OTHER" | null;
            nationality?: string | null;
            religion?: string | null;
            occupation?: string | null;
            /** @enum {string|null} */
            bloodGroup?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | null;
            phone?: string | null;
            altPhone?: string | null;
            email?: string | null;
            addressLine?: string | null;
            town?: string | null;
            district?: string | null;
            region?: string | null;
            digitalAddress?: string | null;
            identifiers?: components["schemas"]["PatientIdentifierInput"][];
            contacts?: components["schemas"]["PatientContactInput"][];
            consents?: components["schemas"]["PatientConsentEntry"][];
            /** @enum {string} */
            captureMethod?: "PAPER" | "ELECTRONIC" | "VERBAL_WITNESSED";
            /** Format: uuid */
            witnessStaffId?: string | null;
            /** @description Set after the registrar has reviewed the duplicate candidates. */
            acknowledgeDuplicates?: boolean;
            /** @description Required (min 10 characters) when a BLOCK-level candidate is overridden. */
            duplicateOverrideReason?: string | null;
            version?: number;
        };
        PatientIdentifyByMergeRequest: {
            /** Format: uuid */
            mergeIntoPatientId: string;
            reason: string;
        };
        PatientIdentifyByMergeResult: {
            /** Format: uuid */
            mergedIntoId: string;
            /** Format: uuid */
            mergeLogId: string;
            /** @enum {string} */
            status: "IN_PROGRESS" | "DONE" | "FAILED" | "MANUAL_REVIEW";
        };
        /** @description Only the fields that are sent are changed. */
        PatientUpdateRequest: {
            firstName?: string;
            middleName?: string | null;
            lastName?: string;
            preferredName?: string | null;
            /** @enum {string} */
            sex?: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
            /** Format: date */
            dateOfBirth?: string | null;
            dobEstimated?: boolean;
            estimatedAgeYears?: number | null;
            /** @enum {string|null} */
            maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | "OTHER" | null;
            nationality?: string | null;
            religion?: string | null;
            occupation?: string | null;
            /** @enum {string|null} */
            bloodGroup?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | null;
            phone?: string | null;
            altPhone?: string | null;
            email?: string | null;
            addressLine?: string | null;
            town?: string | null;
            district?: string | null;
            region?: string | null;
            digitalAddress?: string | null;
            /** @enum {string} */
            confidentiality?: "NORMAL" | "RESTRICTED" | "VIP";
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE" | "DECEASED";
            /** Format: date-time */
            deceasedAt?: string | null;
            /** Format: uuid */
            registeredUnitId?: string | null;
            version?: number;
        };
        DuplicateCheckRequest: {
            firstName: string;
            middleName?: string | null;
            lastName: string;
            /** Format: date */
            dateOfBirth?: string | null;
            phone?: string | null;
            identifiers?: {
                /** @enum {string} */
                idType: "NHIS" | "GHANA_CARD" | "PASSPORT" | "DRIVERS_LICENCE" | "VOTER_ID" | "SSNIT" | "STAFF_ID" | "EXTERNAL_MRN";
                idValue: string;
            }[];
            /** Format: uuid */
            excludePatientId?: string | null;
        };
        DuplicateCandidate: {
            patient: components["schemas"]["PatientSummary"];
            score: number;
            /** @enum {string} */
            level: "BLOCK" | "WARN";
            reasons: ("IDENTIFIER" | "NAME" | "DATE_OF_BIRTH" | "PHONE" | "SURNAME_SOUNDS_ALIKE")[];
        };
        DuplicateCheckResult: {
            blocking: boolean;
            identifierInUse: boolean;
            candidates: components["schemas"]["DuplicateCandidate"][];
        };
        PatientIdentifier: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            idType: "NHIS" | "GHANA_CARD" | "PASSPORT" | "DRIVERS_LICENCE" | "VOTER_ID" | "SSNIT" | "STAFF_ID" | "EXTERNAL_MRN";
            idValue: string;
            issuer: string | null;
            /** Format: date */
            validTo: string | null;
            verified: boolean;
            /** Format: date-time */
            verifiedAt: string | null;
            verifiedByName?: string | null;
            /** @enum {string} */
            status: "ACTIVE" | "INACTIVE";
        };
        PatientIdentifierUpdate: {
            issuer?: string | null;
            /** Format: date */
            validTo?: string | null;
            verified?: boolean;
            /** @enum {string} */
            status?: "ACTIVE" | "INACTIVE";
        };
        PatientContact: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            contactType: "NEXT_OF_KIN" | "EMERGENCY" | "GUARDIAN" | "EMPLOYER";
            name: string;
            relationship: string | null;
            phone: string | null;
            address: string | null;
            isPrimary: boolean;
            canConsent: boolean;
        };
        PatientContactUpdate: {
            /** @enum {string} */
            contactType?: "NEXT_OF_KIN" | "EMERGENCY" | "GUARDIAN" | "EMPLOYER";
            name?: string;
            relationship?: string | null;
            phone?: string | null;
            address?: string | null;
            isPrimary?: boolean;
            canConsent?: boolean;
        };
        PatientAllergy: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            category: "DRUG" | "FOOD" | "LATEX" | "ENVIRON" | "OTHER";
            substance: string;
            reaction: string | null;
            /** @enum {string|null} */
            severity: "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" | null;
            /** @enum {string} */
            status: "ACTIVE" | "RESOLVED" | "ENTERED_IN_ERROR";
            /** Format: date */
            notedOn: string | null;
            /** Format: date-time */
            recordedAt: string;
            recordedByName?: string | null;
        };
        PatientAllergyInput: {
            /** @enum {string} */
            category: "DRUG" | "FOOD" | "LATEX" | "ENVIRON" | "OTHER";
            substance: string;
            reaction?: string | null;
            /** @enum {string|null} */
            severity?: "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" | null;
            /** Format: date */
            notedOn?: string | null;
        };
        PatientAllergyUpdate: {
            reaction?: string | null;
            /** @enum {string|null} */
            severity?: "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" | null;
            /** @enum {string} */
            status?: "ACTIVE" | "RESOLVED" | "ENTERED_IN_ERROR";
        };
        PatientCondition: {
            /** Format: uuid */
            id: string;
            icd10Code: string | null;
            description: string;
            /** Format: date */
            onsetDate: string | null;
            isChronic: boolean;
            /** @enum {string} */
            status: "ACTIVE" | "RESOLVED" | "ENTERED_IN_ERROR";
            /** Format: date-time */
            recordedAt: string;
            recordedByName?: string | null;
        };
        PatientConditionInput: {
            icd10Code?: string | null;
            description: string;
            /** Format: date */
            onsetDate?: string | null;
            isChronic?: boolean;
        };
        PatientConditionUpdate: {
            description?: string;
            /** Format: date */
            onsetDate?: string | null;
            isChronic?: boolean;
            /** @enum {string} */
            status?: "ACTIVE" | "RESOLVED" | "ENTERED_IN_ERROR";
        };
        PatientConsentRecord: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            consentType: "TREATMENT" | "DATA_PROCESSING" | "SMS_CONTACT" | "INSURER_SHARING" | "PHOTOGRAPHY" | "RESEARCH";
            /** @enum {string} */
            status: "GRANTED" | "WITHDRAWN" | "DECLINED";
            policyVersion: string;
            /** Format: date-time */
            grantedAt: string | null;
            /** Format: date-time */
            withdrawnAt: string | null;
            /** @enum {string} */
            captureMethod: "PAPER" | "ELECTRONIC" | "VERBAL_WITNESSED";
            guardianName: string | null;
            guardianRelationship: string | null;
            note: string | null;
            /** Format: date-time */
            createdAt: string;
            capturedByName?: string | null;
            witnessName?: string | null;
        };
        PatientConsentInput: {
            /** @enum {string} */
            consentType: "TREATMENT" | "DATA_PROCESSING" | "SMS_CONTACT" | "INSURER_SHARING" | "PHOTOGRAPHY" | "RESEARCH";
            /** @enum {string} */
            status: "GRANTED" | "WITHDRAWN" | "DECLINED";
            note?: string | null;
            /** @enum {string} */
            captureMethod: "PAPER" | "ELECTRONIC" | "VERBAL_WITNESSED";
            /** Format: uuid */
            witnessStaffId?: string | null;
            guardianName?: string | null;
            guardianRelationship?: string | null;
        };
        PatientConsents: {
            effective: {
                /** @enum {string} */
                consentType: "TREATMENT" | "DATA_PROCESSING" | "SMS_CONTACT" | "INSURER_SHARING" | "PHOTOGRAPHY" | "RESEARCH";
                /** @enum {string} */
                status: "GRANTED" | "WITHDRAWN" | "DECLINED" | "NOT_RECORDED";
                /** Format: date-time */
                recordedAt: string | null;
            }[];
            history: components["schemas"]["PatientConsentRecord"][];
        };
        PatientTimelineEvent: {
            /** @enum {string} */
            type: "REGISTRATION" | "MERGE" | "APPOINTMENT" | "VISIT" | "ENCOUNTER" | "ADMISSION" | "LAB_ORDER" | "IMAGING_ORDER";
            /** Format: date-time */
            occurredAt: string;
            title: string;
            status: string | null;
            reference: string | null;
            unitName: string | null;
        };
        PatientPhotoRequest: {
            /** Format: uri */
            photoUrl: string | null;
            photoPublicId?: string | null;
        };
        PatientPhotoResult: {
            photoUrl: string | null;
            photoPublicId: string | null;
            version: number;
        };
        PatientAuditEntry: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            occurredAt: string;
            actorName: string;
            actorRoles: string[] | null;
            action: string;
            entityType: string;
            reason: string | null;
        };
        DuplicatePair: {
            /** Format: uuid */
            id: string;
            score: number;
            reasons: string[];
            /** @enum {string} */
            status: "PENDING" | "DISMISSED" | "MERGED";
            /** @enum {string} */
            source: "REGISTRATION" | "SWEEP" | "MANUAL";
            /** Format: date-time */
            detectedAt: string;
            /** Format: date-time */
            reviewedAt: string | null;
            reviewedByName: string | null;
            patientA: components["schemas"]["PatientSummary"];
            patientB: components["schemas"]["PatientSummary"];
        };
        MergePrecheck: {
            code: string;
            passed: boolean;
            message: string;
        };
        MergePreview: {
            survivor: components["schemas"]["PatientDetail"];
            merged: components["schemas"]["PatientDetail"];
            prechecks: components["schemas"]["MergePrecheck"][];
            canMerge: boolean;
            mergeableFields: ("preferredName" | "dateOfBirth" | "maritalStatus" | "nationality" | "religion" | "occupation" | "bloodGroup" | "phone" | "altPhone" | "email" | "addressLine" | "town" | "district" | "region" | "digitalAddress" | "photoUrl")[];
        };
        MergeRequest: {
            /** Format: uuid */
            survivorId: string;
            /** Format: uuid */
            mergedId: string;
            reason: string;
            takeFromMerged?: ("preferredName" | "dateOfBirth" | "maritalStatus" | "nationality" | "religion" | "occupation" | "bloodGroup" | "phone" | "altPhone" | "email" | "addressLine" | "town" | "district" | "region" | "digitalAddress" | "photoUrl")[];
        };
        MergeTask: {
            /** Format: uuid */
            id: string;
            module: string;
            /** @enum {string} */
            status: "PENDING" | "DONE" | "FAILED" | "MANUAL_REVIEW";
            rowsMoved: number | null;
            note: string | null;
            attempts: number;
            /** Format: date-time */
            completedAt: string | null;
        };
        MergeResult: {
            /** Format: uuid */
            mergeLogId: string;
            /** Format: uuid */
            survivorId: string;
            /** @enum {string} */
            status: "IN_PROGRESS" | "DONE" | "FAILED" | "MANUAL_REVIEW";
            tasks: components["schemas"]["MergeTask"][];
        };
        MergeSummary: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            mergedAt: string;
            mergedByName: string | null;
            reason: string;
            /** Format: uuid */
            survivorId: string;
            survivor: {
                mrn: string;
                name: string;
            } | null;
            merged: {
                mrn: string;
                name: string;
            } | null;
            /** @enum {string} */
            status: "IN_PROGRESS" | "DONE" | "FAILED" | "MANUAL_REVIEW";
            tasks: components["schemas"]["MergeTask"][];
        };
        PatientReferences: {
            units: {
                /** Format: uuid */
                id: string;
                name: string;
                code: string;
                unitType: string;
            }[];
            staff: {
                /** Format: uuid */
                id: string;
                firstName: string;
                lastName: string;
                employeeId: string;
            }[];
            /** Format: date */
            today: string;
            minorAgeThreshold: number;
            breakGlassReasonMinChars: number;
            /** @enum {string} */
            accessLevel: "FULL" | "MINIMAL";
        };
        BreakGlassRequest: {
            /** Format: uuid */
            patientId: string;
            reason: string;
        };
        BreakGlassGrant: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            patientId: string;
            reason: string;
            /** Format: date-time */
            grantedAt: string;
            /** Format: date-time */
            expiresAt: string;
        };
        BreakGlassReviewItem: {
            /** Format: uuid */
            id: string;
            userName: string;
            userEmail: string | null;
            patientName: string;
            patientMrn: string | null;
            confidentiality: string | null;
            reason: string;
            /** Format: date-time */
            grantedAt: string;
            /** Format: date-time */
            expiresAt: string;
            active: boolean;
            reviewOverdue: boolean;
            /** Format: date-time */
            reviewedAt: string | null;
            reviewedByName: string | null;
            /** @enum {string|null} */
            reviewOutcome: "JUSTIFIED" | "UNJUSTIFIED" | "ESCALATED" | null;
            reviewNote: string | null;
        };
        BreakGlassReviewRequest: {
            /** @enum {string} */
            outcome: "JUSTIFIED" | "UNJUSTIFIED" | "ESCALATED";
            note?: string | null;
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
