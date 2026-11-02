import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
