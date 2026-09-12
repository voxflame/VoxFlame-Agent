import OSS from 'ali-oss';
import dotenv from 'dotenv';
dotenv.config();

interface TextObjectWriter {
    put(name: string, content: Buffer): Promise<unknown>;
}

export interface OssObjectInspection {
    contentLength: number;
    contentType: string;
    etag: string | null;
}

/**
 * Aliyun OSS PutObject does not support the HTTP If-Match precondition used by
 * the previous implementation. Callers serialize each account's artifact
 * mutations before using this overwrite helper.
 */
export async function overwriteTextObject(
    client: TextObjectWriter,
    name: string,
    content: Buffer,
): Promise<void> {
    await client.put(name, content);
}

export class OssService {
    private client: OSS | null = null;
    private isConfigured: boolean = false;

    constructor() {
        const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
        const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
        const bucket = process.env.OSS_BUCKET;
        const region = process.env.OSS_REGION || 'oss-cn-hangzhou'; // Default region if not specified

        if (accessKeyId && accessKeySecret && bucket) {
            this.client = new OSS({
                region,
                accessKeyId,
                accessKeySecret,
                bucket,
                secure: true
            });
            this.isConfigured = true;
            console.log(`[OSS] Service initialized (Bucket: ${bucket}, Region: ${region})`);
        } else {
            console.warn('[OSS] Credentials missing. Service Disabled. Please set OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, and OSS_BUCKET in .env');
        }
    }

    private getConfiguredClient(): OSS {
        if (!this.isConfigured || !this.client) {
            throw new Error('OSS not configured');
        }

        return this.client;
    }

    /**
     * Generate a signed URL for uploading a file (PUT method)
     * @param filename Key (path) in the bucket
     * @param contentType MIME type of the file
     * @param expiresSeconds Expiration time in seconds (default 300)
     */
    async generateUploadUrl(filename: string, contentType: string, expiresSeconds: number = 300): Promise<string | null> {
        const client = this.getConfiguredClient();

        try {
            // signatureUrl returns a string synchronously if using v1 signatures, 
            // but the type definition or newer versions might be async or return Promise in some contexts.
            // Safe to await.
            const url = client.signatureUrl(filename, {
                method: 'PUT',
                expires: expiresSeconds,
                'Content-Type': contentType
            });
            return url;
        } catch (error) {
            console.error('[OSS] Failed to generate signature URL:', error);
            throw error;
        }
    }

    /** Read the immutable object facts used by the upload admission gate. */
    async inspectObject(name: string): Promise<OssObjectInspection | null> {
        const client = this.getConfiguredClient();

        try {
            const result = await client.head(name);
            const headers = (result as {
                res?: { headers?: Record<string, string | number | string[] | undefined> };
            }).res?.headers ?? {};
            const contentLength = Number(headers['content-length']);
            const contentType = String(headers['content-type'] ?? '').trim();
            const rawEtag = headers.etag;
            const etag = typeof rawEtag === 'string' && rawEtag.trim()
                ? rawEtag.trim()
                : null;

            return { contentLength, contentType, etag };
        } catch (error: unknown) {
            if (isOssNotFoundError(error)) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Append text line to a file in OSS using AppendObject
     * This is efficient and suitable for logs/transcripts.
     */
    async appendTextLog(name: string, line: string): Promise<void> {
        if (!this.isConfigured || !this.client) return;

        const client = this.client;
        const content = line + '\n';
        const buf = Buffer.from(content);
        let lastError: unknown = null;

        // Simple retry logic for concurrency
        for (let i = 0; i < 3; i++) {
            try {
                // 1. Get current position
                let position = '0';
                try {
                    const head = await client.head(name);
                    const headers = (head as {
                        res?: {
                            headers?: Record<string, string | number | string[] | undefined>;
                        };
                    }).res?.headers ?? {};
                    const type = headers['x-oss-object-type'];
                    if (type === 'Normal') {
                        const current = await client.get(name);
                        const currentContent = Buffer.isBuffer(current.content)
                            ? current.content
                            : Buffer.from(current.content);
                        await overwriteTextObject(client, name, Buffer.concat([currentContent, buf]));
                        return;
                    }
                    const nextPosition = headers['x-oss-next-append-position'];
                    position = typeof nextPosition === 'string' ? nextPosition : String(nextPosition ?? '0');
                } catch (e: unknown) {
                    if (!isOssNotFoundError(e)) throw e;
                    // File not found, position 0
                }

                // 2. Append
                await client.append(name, buf, { position });
                // Success
                return;
            } catch (e: unknown) {
                lastError = e;
                if (isOssPositionConflictError(e)) {
                    // Concurrent append happened, re-read and retry.
                    console.log(`[OSS] Concurrent text log update for ${name}, retrying...`);
                    continue;
                }
                console.error(`[OSS] Failed to append to ${name}:`, e);
                throw e;
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error(`OSS append retries exhausted for ${name}`);
    }

    /**
     * Read a text object from OSS.
     * Returns null when the object does not exist or OSS is not configured.
     */
    async getTextObject(name: string): Promise<string | null> {
        if (!this.isConfigured || !this.client) {
            return null;
        }

        const client = this.client;
        try {
            const result = await client.get(name);
            const content = result.content;

            if (typeof content === 'string') {
                return content;
            }

            if (Buffer.isBuffer(content)) {
                return content.toString('utf8');
            }

            if (content instanceof Uint8Array) {
                return Buffer.from(content).toString('utf8');
            }

            return null;
        } catch (error: unknown) {
            if (isOssNotFoundError(error)) {
                return null;
            }

            console.error(`[OSS] Failed to read ${name}:`, error);
            throw error;
        }
    }

    /** Rewrite one text object inside the caller's per-account serialized operation. */
    async rewriteTextObject(
        name: string,
        rewrite: (content: string) => string,
    ): Promise<boolean> {
        if (!this.isConfigured || !this.client) {
            return false;
        }

        const client = this.client;
        let result: Awaited<ReturnType<OSS['get']>>;
        try {
            result = await client.get(name);
        } catch (error: unknown) {
            if (isOssNotFoundError(error)) return false;
            throw error;
        }

        const current = Buffer.isBuffer(result.content)
            ? result.content.toString('utf8')
            : Buffer.from(result.content).toString('utf8');
        const next = rewrite(current);
        if (next === current) return false;

        await overwriteTextObject(client, name, Buffer.from(next));
        return true;
    }

    /** Write a complete text object when the caller already holds its serialized snapshot. */
    async writeTextObject(name: string, content: string): Promise<void> {
        if (!this.isConfigured || !this.client) {
            return;
        }

        await overwriteTextObject(this.client, name, Buffer.from(content));
    }

    /**
     * Delete an object from OSS. Missing objects are treated as already deleted.
     */
    async deleteObject(name: string): Promise<void> {
        if (!this.isConfigured || !this.client) {
            return;
        }

        try {
            await this.client.delete(name);
        } catch (error: unknown) {
            if (isOssNotFoundError(error)) {
                return;
            }

            console.error(`[OSS] Failed to delete ${name}:`, error);
            throw error;
        }
    }

}

export const ossService = new OssService();

function readOssErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function readOssErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
}

function isOssNotFoundError(error: unknown): boolean {
    return readOssErrorStatus(error) === 404 || readOssErrorCode(error) === 'NoSuchKey';
}

function isOssPositionConflictError(error: unknown): boolean {
    return readOssErrorCode(error) === 'PositionNotEqualToLength' || readOssErrorStatus(error) === 409;
}
