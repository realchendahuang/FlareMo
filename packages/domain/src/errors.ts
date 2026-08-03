export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Resource not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends DomainError {
  constructor(message = "Invalid request") {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Resource conflict") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Authentication required") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Permission denied") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}
