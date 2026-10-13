import type { Request } from "express";

import { validationError } from "./errors.js";

export type ListOperator = "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "ne" | "null";

export type ListFilter = {
  field: string;
  operator: ListOperator;
  value: string | string[] | boolean;
};

export type SortKey = {
  field: string;
  descending: boolean;
};

export type ListQuery = {
  page: number;
  limit: number;
  offset: number;
  q: string | null;
  include: string[];
  sort: SortKey[];
  filters: ListFilter[];
};

export type ListSpec = {
  sortable: string[];
  filterable: string[];
  includable?: string[];
  defaultSort: string;
  defaultLimit?: number;
  maxLimit?: number;
};

const LIST_OPERATORS: ListOperator[] = ["eq", "in", "gt", "gte", "lt", "lte", "ne", "null"];
const LIST_OPERATOR_SET = new Set(LIST_OPERATORS);

const parsePositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const parseSortToken = (token: string) => {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("-")) {
    return { field: normalized.slice(1), descending: true };
  }

  return { field: normalized, descending: false };
};

const parseBoolean = (value: string) => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw validationError("Null filter must be true or false.", "LIST_FILTER_INVALID");
};

export const parseListQuery = (req: Request, spec: ListSpec): ListQuery => {
  const defaultLimit = spec.defaultLimit ?? 25;
  const maxLimit = spec.maxLimit ?? 200;

  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, defaultLimit), maxLimit);
  const offset = (page - 1) * limit;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : null;

  const rawSort = typeof req.query.sort === "string" ? req.query.sort : spec.defaultSort;
  const sort = rawSort
    .split(",")
    .map(parseSortToken)
    .filter((entry): entry is SortKey => Boolean(entry));

  for (const entry of sort) {
    if (!spec.sortable.includes(entry.field)) {
      throw validationError(`Unknown sort field '${entry.field}'.`, "LIST_FIELD_UNKNOWN", {
        field: entry.field,
      });
    }
  }

  const includeParam = typeof req.query.include === "string" ? req.query.include : "";
  const include = includeParam
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (include.length > 0) {
    const includable = new Set(spec.includable ?? []);
    for (const relation of include) {
      if (!includable.has(relation)) {
        throw validationError(`Unknown include field '${relation}'.`, "LIST_FIELD_UNKNOWN", {
          field: relation,
        });
      }
    }
  }

  const filters: ListFilter[] = [];
  const reserved = new Set(["page", "limit", "sort", "q", "include"]);

  for (const [rawKey, rawValue] of Object.entries(req.query)) {
    if (reserved.has(rawKey)) {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const serialized = values
      .map((entry) => String(entry))
      .filter((entry) => entry.trim().length > 0);

    if (serialized.length === 0) {
      continue;
    }

    const [fieldRaw, maybeOperator] = rawKey.split("__");
    const field = fieldRaw ?? "";
    const operator = maybeOperator ? (maybeOperator as ListOperator) : "eq";

    if (!spec.filterable.includes(field)) {
      throw validationError(`Unknown filter field '${field}'.`, "LIST_FIELD_UNKNOWN", { field });
    }

    if (!LIST_OPERATOR_SET.has(operator)) {
      throw validationError(`Unknown filter operator '${operator}'.`, "LIST_FILTER_UNKNOWN_OPERATOR", {
        field,
        operator,
      });
    }

    if (operator === "in") {
      const combined = serialized.join(",");
      const list = combined
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      filters.push({ field, operator, value: list });
      continue;
    }

    if (operator === "null") {
      const firstValue = serialized[0] ?? "false";
      filters.push({ field, operator, value: parseBoolean(firstValue) });
      continue;
    }

    const firstValue = serialized[0] ?? "";
    filters.push({ field, operator, value: firstValue });
  }

  return {
    page,
    limit,
    offset,
    q,
    include,
    sort,
    filters,
  };
};

export const toPageResponse = <T>(
  data: T[],
  query: Pick<ListQuery, "page" | "limit">,
  total: number,
) => {
  const totalPages = total > 0 ? Math.ceil(total / query.limit) : 0;

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasMore: query.page * query.limit < total,
    },
  };
};
