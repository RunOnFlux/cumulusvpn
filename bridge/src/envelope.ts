/**
 * The SSP/CumulusVPN response envelope (docs/10-api-contract.md):
 *   success: { status: 'success', data: <object> }
 *   error:   { status: 'error',   data: { code, name, message } }
 */

export interface ErrorBody {
  readonly code: string;
  readonly name: string;
  readonly message: string;
}

export function ok(data: unknown): { status: 'success'; data: unknown } {
  return { status: 'success', data };
}

export function err(
  code: number,
  name: string,
  message: string,
): { status: 'error'; data: ErrorBody } {
  return { status: 'error', data: { code: String(code), name, message } };
}
