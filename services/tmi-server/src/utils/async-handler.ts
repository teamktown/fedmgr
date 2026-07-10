/**
 * Express 4.x async error forwarding wrapper.
 *
 * Express 4 does NOT automatically forward rejected promises from async route
 * handlers to the error middleware. Wrapping handlers with `asyncHandler`
 * ensures that any unhandled promise rejection is passed to `next(err)`.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
