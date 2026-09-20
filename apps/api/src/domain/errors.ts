export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export function requireRole(role: string, allowed: string[]) {
  if (!allowed.includes(role))
    throw new AppError(
      403,
      "You do not have permission for this action",
      "FORBIDDEN",
    );
}
