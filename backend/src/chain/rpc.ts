import {
    AbiDecodingDataSizeTooSmallError,
    AbiDecodingZeroDataError,
    BaseError,
    ContractFunctionRevertedError,
    ContractFunctionZeroDataError,
    createPublicClient,
    ExecutionRevertedError,
    http
} from 'viem';

const CHAIN_CALL_TIMEOUT_MS = 4_000;

const CHAIN_DEADLINE_MS = 2 * CHAIN_CALL_TIMEOUT_MS;

export function boundedClient(rpcUrl: string)
{
    const deadline = AbortSignal.timeout(CHAIN_DEADLINE_MS);
    return createPublicClient({
        ccipRead: false,
        transport: http(rpcUrl, {
            timeout: CHAIN_CALL_TIMEOUT_MS,
            retryCount: 0,
            fetchFn: (input, init) => fetch(input, {
                ...init,
                signal: AbortSignal.any([deadline, AbortSignal.timeout(CHAIN_CALL_TIMEOUT_MS), ...(init?.signal ? [init.signal] : [])])
            })
        })
    });
}

export function refusedByContract(error: unknown)
{
    return error instanceof BaseError && error.walk((cause) =>
        cause instanceof ExecutionRevertedError
        || (cause instanceof ContractFunctionRevertedError && cause.raw !== undefined && cause.raw !== '0x')
        || cause instanceof ContractFunctionZeroDataError
        || cause instanceof AbiDecodingZeroDataError
        || cause instanceof AbiDecodingDataSizeTooSmallError) !== null;
}
