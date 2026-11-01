// Standardized error envelope { code, message, traceId } (SAD 4.4).
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new ApiError(400, 'INVALID_INPUT', msg, details);
const unauthorized = (msg = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'Access denied') => new ApiError(403, 'FORBIDDEN', msg);
const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (code, msg) => new ApiError(409, code, msg);
const unprocessable = (code, msg) => new ApiError(422, code, msg);
const unavailable = (msg) => new ApiError(503, 'SERVICE_UNAVAILABLE', msg);

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    if (err.type === 'entity.parse.failed') err = badRequest('Malformed JSON body');
    const status = err.status || 500;
    if (status >= 500) logger.error('request_failed', { traceId: req.traceId, error: err.message, stack: err.stack });
    res.status(status).json({
      code: err.code || 'INTERNAL_ERROR',
      message: status >= 500 && !err.code ? 'Internal server error' : err.message,
      traceId: req.traceId,
      ...(err.details ? { details: err.details } : {}),
    });
  };
}

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, unavailable, errorHandler };
