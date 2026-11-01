import { HttpException } from '@nestjs/common';

/** An error the client sees as `{ message, errors? }` with the given HTTP status. */
export class ApiError extends HttpException {
  constructor(status: number, message: string, errors?: string[]) {
    super({ message, ...(errors && { errors }) }, status);
  }
}

export const validationFailed = (...errors: string[]) => new ApiError(400, 'Validation failed', errors);
