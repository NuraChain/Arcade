import { ApiError } from '../api.ts';
import { isRefusal } from '../../../backend/src/domains/match/refusals.ts';

export const refusalOf = (error: unknown) =>
    error instanceof ApiError && isRefusal(error.code) ? error.code : null;
