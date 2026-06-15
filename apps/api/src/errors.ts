export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);

export const notFound = (message: string, details?: unknown) =>
  new ApiError(404, "not_found", message, details);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "conflict", message, details);
