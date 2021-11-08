// ============================================= //
// WebAssembly runtime for TypeScript            //
//                                               //
// This file is generated. PLEASE DO NOT MODIFY. //
// ============================================= //

import { encode, decode } from "@msgpack/msgpack";

import type {
    Config,
    Error,
    HttpRequest,
    HttpRequestError,
    HttpRequestMethod,
    HttpResponse,
    Instant,
    Metric,
    Point,
    ProviderRequest,
    ProviderResponse,
    ProxyRequest,
    QueryInstant,
    QueryTimeRange,
    Result,
    Series,
    TimeRange,
    Timestamp,
} from "./types";

type FatPtr = bigint;

export type Imports = {
    log: (message: string) => void;
    makeHttpRequest: (request: HttpRequest) => Promise<Result<HttpResponse, HttpRequestError>>;
    now: () => Timestamp;
    random: (len: number) => Array<number>;
};

export type Exports = {
    invoke?: (request: ProviderRequest, config: Config) => Promise<ProviderResponse>;
};

/**
 * Represents an unrecoverable error in the FP runtime.
 *
 * After this, your only recourse is to create a new runtime, probably with a different WASM plugin.
 */
export class FPRuntimeError extends Error {
    constructor(message: string) {
        super(message);
    }
}

/**
 * Creates a runtime for executing the given plugin.
 *
 * @param plugin The raw WASM plugin.
 * @param importFunctions The host functions that may be imported by the plugin.
 * @returns The functions that may be exported by the plugin.
 */
export async function createRuntime(
    plugin: ArrayBuffer,
    importFunctions: Imports
): Promise<Exports> {
    const promises = new Map<FatPtr, (result: unknown) => void>();

    function createAsyncValue(): FatPtr {
        const len = 12; // std::mem::size_of::<AsyncValue>()
        const fatPtr = malloc(len);
        const [ptr] = fromFatPtr(fatPtr);
        const buffer = new Uint8Array(memory.buffer, ptr, len);
        buffer.fill(0);
        return fatPtr;
    }

    function parseObject<T>(fatPtr: FatPtr): T {
        const [ptr, len] = fromFatPtr(fatPtr);
        const buffer = new Uint8Array(memory.buffer, ptr, len);
        const object = decode<T>(buffer) as T;
        free(fatPtr);
        return object;
    }

    function promiseFromPtr<T>(ptr: FatPtr): Promise<T> {
        return new Promise<T>((resolve) => {
            promises.set(ptr, resolve as (result: unknown) => void);
        });
    }

    function resolvePromise(asyncValuePtr: FatPtr, resultPtr: FatPtr) {
        const resolve = promises.get(asyncValuePtr);
        if (!resolve) {
            throw new FPRuntimeError("Tried to resolve unknown promise");
        }

        resolve(resultPtr ? parseObject(resultPtr) : undefined);
    }

    function serializeObject<T>(object: T): FatPtr {
        const serialized = encode(object);
        const fatPtr = malloc(serialized.length);
        const [ptr, len] = fromFatPtr(fatPtr);
        const buffer = new Uint8Array(memory.buffer, ptr, len);
        buffer.set(serialized);
        return fatPtr;
    }

    const { instance } = await WebAssembly.instantiate(plugin, {
        fp: {
            __fp_gen_log: (message_ptr: FatPtr) => {
                const message = parseObject<string>(message_ptr);
                importFunctions.log(message);
            },
            __fp_gen_make_http_request: (request_ptr: FatPtr): FatPtr => {
                const request = parseObject<HttpRequest>(request_ptr);
                const _async_result_ptr = createAsyncValue();
                importFunctions.makeHttpRequest(request)
                    .then((result) => {
                        resolveFuture(_async_result_ptr, serializeObject(result));
                    })
                    .catch((error) => {
                        console.error(
                            'Unrecoverable exception trying to call async host function "make_http_request"',
                            error
                        );
                    });
                return _async_result_ptr;
            },
            __fp_gen_now: (): FatPtr => {
                return serializeObject(importFunctions.now());
            },
            __fp_gen_random: (len: number): FatPtr => {
                return serializeObject(importFunctions.random(len));
            },
            __fp_host_resolve_async_value: resolvePromise,
        },
    });

    const getExport = <T>(name: string): T => {
        const exp = instance.exports[name];
        if (!exp) {
            throw new FPRuntimeError(`Plugin did not export expected symbol: "${name}"`);
        }
        return exp as unknown as T;
    };

    const memory = getExport<WebAssembly.Memory>("memory");
    const malloc = getExport<(len: number) => FatPtr>("__fp_malloc");
    const free = getExport<(ptr: FatPtr) => void>("__fp_free");
    const resolveFuture = getExport<(asyncValuePtr: FatPtr, resultPtr: FatPtr) => void>("__fp_guest_resolve_async_value");

    return {
        invoke: (() => {
            const export_fn = instance.exports.__fp_gen_invoke as any;
            if (!export_fn) return;

            return (request: ProviderRequest, config: Config) => {
                const request_ptr = serializeObject(request);
                const config_ptr = serializeObject(config);
                return promiseFromPtr<ProviderResponse>(export_fn(request_ptr, config_ptr));
            };
        })(),
    };
}

function fromFatPtr(fatPtr: FatPtr): [ptr: number, len: number] {
    return [
        Number.parseInt((fatPtr >> 32n).toString()),
        Number.parseInt((fatPtr & 0xffff_ffffn).toString()),
    ];
}

function toFatPtr(ptr: number, len: number): FatPtr {
    return (BigInt(ptr) << 32n) | BigInt(len);
}
