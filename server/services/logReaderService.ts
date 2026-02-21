/**
 * Log Reader Service
 * 
 * Service for reading log files with streaming support
 * Handles log rotation, compressed files, and memory-efficient reading
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import * as zlib from 'zlib';
import * as path from 'path';
import { pipeline } from 'stream/promises';

export interface FileInfo {
    path: string;
    size: number;
    modified: Date;
    exists: boolean;
    readable: boolean;
    compressed?: boolean;
    rotated?: boolean;
}

export interface ReadLogOptions {
    maxLines?: number;
    fromLine?: number;
    follow?: boolean;
    encoding?: BufferEncoding;
    readCompressed?: boolean; // Enable reading compressed files (.gz)
}

export interface LogLine {
    line: string;
    lineNumber: number;
    filePath: string;
}

/**
 * Service for reading log files efficiently
 */
export class LogReaderService {
    private readonly MAX_BUFFER_SIZE = 1000; // Maximum lines to keep in memory
    private readonly DEFAULT_ENCODING: BufferEncoding = 'utf8';

    /**
     * Get file information
     */
    async getFileInfo(filePath: string): Promise<FileInfo> {
        try {
            const stats = await fs.stat(filePath);
            const compressed = this.isCompressed(filePath);
            
            // Check if file is readable (permissions)
            let readable = true;
            try {
                await fs.access(filePath, fs.constants.R_OK);
            } catch (accessError: any) {
                if (accessError.code === 'EACCES' || accessError.code === 'EPERM') {
                    readable = false;
                }
            }
            
            // Note: We don't validate gzip files here to avoid performance issues
            // Corrupted gzip files will be handled gracefully in readLogFile()
            
            return {
                path: filePath,
                size: stats.size,
                modified: stats.mtime,
                exists: true,
                readable,
                compressed,
                rotated: this.isRotated(filePath)
            };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return {
                    path: filePath,
                    size: 0,
                    modified: new Date(),
                    exists: false,
                    readable: false
                };
            }
            throw error;
        }
    }

    /**
     * Check if file is compressed
     */
    private isCompressed(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        // Check for .gz, .bz2, .xz, or .tar.gz
        return ext === '.gz' || ext === '.bz2' || ext === '.xz' || filePath.toLowerCase().endsWith('.tar.gz');
    }

    /**
     * Check if file is rotated
     */
    private isRotated(filePath: string): boolean {
        const basename = path.basename(filePath);
        // Check for rotation patterns: .1, .2, .20240101, etc.
        return /\.[\d]+(\.gz|\.bz2|\.xz)?$/.test(basename);
    }

    /**
     * Read log file lines (non-streaming, for initial load)
     * @param filePath Path to log file
     * @param options Read options
     * @returns Array of log lines
     */
    async readLogFile(filePath: string, options: ReadLogOptions = {}): Promise<LogLine[]> {
        const {
            maxLines = 0, // 0 = no limit (was 1000)
            fromLine = 0,
            encoding = this.DEFAULT_ENCODING,
            readCompressed = false
        } = options;

        const lines: LogLine[] = [];
        let lineNumber = 0;

        try {
            // Check if file exists
            const fileInfo = await this.getFileInfo(filePath);
            if (!fileInfo.exists || !fileInfo.readable) {
                return lines;
            }

            // Handle compressed files
            let stream: NodeJS.ReadableStream;
            if (fileInfo.compressed) {
                if (!readCompressed) {
                    // Compressed files are not supported when readCompressed is false
                    return lines;
                }
                
                // Check if it's a .gz file (only .gz is supported for now)
                const ext = path.extname(filePath).toLowerCase();
                if (ext === '.gz') {
                    // Use zlib to decompress .gz files
                    const fileStream = createReadStream(filePath);
                    stream = fileStream.pipe(zlib.createGunzip());
                } else {
                    // Other compression formats (.bz2, .xz) are not supported yet
                    return lines;
                }
            } else {
                // Regular uncompressed file
                stream = createReadStream(filePath, { encoding });
            }

            // Create readline interface
            const rl = createInterface({
                input: stream,
                crlfDelay: Infinity
            });

            // Track if we encountered a decompression error
            let decompressionError: NodeJS.ErrnoException | null = null;
            
            // Listen for errors on the stream before reading
            stream.on('error', (error: NodeJS.ErrnoException) => {
                decompressionError = error;
            });

            // Read lines
            try {
                for await (const line of rl) {
                    // If we had a decompression error, stop reading
                    if (decompressionError) {
                        break;
                    }
                    
                    lineNumber++;

                    // Skip lines before fromLine
                    if (lineNumber <= fromLine) {
                        continue;
                    }

                    // Stop if maxLines reached (0 means no limit)
                    if (maxLines > 0 && lines.length >= maxLines) {
                        break;
                    }

                    lines.push({
                        line: line,
                        lineNumber: lineNumber,
                        filePath: filePath
                    });
                }
            } catch (readError: any) {
                // If it's a decompression error, handle it gracefully
                if (readError?.code === 'Z_DATA_ERROR' || decompressionError?.code === 'Z_DATA_ERROR') {
                    // Corrupted gzip - return empty array (already handled above)
                    return lines;
                }
                // Re-throw other errors
                throw readError;
            }

            // If we had a decompression error, handle it
            if (decompressionError) {
                if (decompressionError.code === 'Z_DATA_ERROR') {
                    // Corrupted gzip - return empty array
                    return lines;
                }
                // Other stream errors should be thrown
                throw decompressionError;
            }

            return lines;
        } catch (error: any) {
            // Handle specific errors gracefully
            if (error?.code === 'Z_DATA_ERROR') {
                // Corrupted gzip - return empty array instead of throwing
                return lines;
            }
            if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ENOENT') {
                return lines;
            }
            console.error(`[LogReaderService] Unexpected error reading file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Read the last N lines of a log file (tail). Uses a sliding window to avoid loading the whole file.
     * @param filePath Path to log file
     * @param maxLines Maximum number of lines to return (from the end)
     * @param options Read options
     * @returns Array of log lines (last maxLines)
     */
    async readLastLines(filePath: string, maxLines: number, options: ReadLogOptions = {}): Promise<LogLine[]> {
        const { encoding = this.DEFAULT_ENCODING, readCompressed = false } = options;
        const sliding: LogLine[] = [];
        let lineNumber = 0;

        try {
            const fileInfo = await this.getFileInfo(filePath);
            if (!fileInfo.exists || !fileInfo.readable) {
                return [];
            }

            let stream: NodeJS.ReadableStream;
            if (fileInfo.compressed) {
                if (!readCompressed || !filePath.toLowerCase().endsWith('.gz')) {
                    return [];
                }
                stream = createReadStream(filePath).pipe(zlib.createGunzip());
            } else {
                stream = createReadStream(filePath, { encoding });
            }

            const rl = createInterface({ input: stream, crlfDelay: Infinity });

            for await (const line of rl) {
                lineNumber++;
                sliding.push({
                    line,
                    lineNumber,
                    filePath
                });
                if (sliding.length > maxLines) {
                    sliding.shift();
                }
            }

            return sliding;
        } catch (error: any) {
            if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ENOENT' || error?.code === 'Z_DATA_ERROR') {
                return [];
            }
            throw error;
        }
    }

    /**
     * Stream log file lines (for real-time following)
     * @param filePath Path to log file
     * @param callback Callback for each line
     * @param options Stream options
     */
    async streamLogFile(
        filePath: string,
        callback: (line: LogLine) => void,
        options: ReadLogOptions = {}
    ): Promise<void> {
        const {
            follow = false,
            encoding = this.DEFAULT_ENCODING,
            fromLine = 0,
            readCompressed = false
        } = options;

        try {
            // Check if file exists
            const fileInfo = await this.getFileInfo(filePath);
            if (!fileInfo.exists || !fileInfo.readable) {
                throw new Error(`File not found or not readable: ${filePath}`);
            }

            // Compressed files cannot be followed in real-time (they must be fully decompressed)
            if (fileInfo.compressed && follow) {
                // For compressed files, just read all lines (no follow mode)
                const allLines = await this.readLogFile(filePath, {
                    maxLines: 0, // No limit
                    fromLine: 0,
                    encoding,
                    readCompressed
                });

                for (const logLine of allLines) {
                    if (logLine.lineNumber > fromLine) {
                        callback(logLine);
                    }
                }
                return;
            }

            let lineNumber = 0;

            // Read existing lines first (if fromLine > 0)
            if (fromLine > 0) {
                const existingLines = await this.readLogFile(filePath, {
                    maxLines: 10000, // Read up to 10000 lines
                    fromLine: 0,
                    encoding,
                    readCompressed
                });

                for (const logLine of existingLines) {
                    if (logLine.lineNumber > fromLine) {
                        callback(logLine);
                    }
                }

                lineNumber = existingLines.length > 0 ? existingLines[existingLines.length - 1].lineNumber : 0;
            }

            // If follow mode, use tail-like behavior (only for uncompressed files)
            if (follow) {
                // For follow mode, we'll use a polling approach or file watching
                // This is a simplified version - in production, use chokidar or similar
                await this.followFile(filePath, callback, encoding, lineNumber);
            } else {
                // Read remaining lines
                const remainingLines = await this.readLogFile(filePath, {
                    maxLines: 1000,
                    fromLine: lineNumber,
                    encoding,
                    readCompressed
                });

                for (const logLine of remainingLines) {
                    callback(logLine);
                }
            }
        } catch (error) {
            console.error(`[LogReaderService] Error streaming file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Follow file for new lines using fs.watch with polling fallback
     * Uses native fs.watch for better performance, falls back to polling if needed
     */
    private async followFile(
        filePath: string,
        callback: (line: LogLine) => void,
        encoding: BufferEncoding,
        startLineNumber: number
    ): Promise<void> {
        let lastSize = 0;
        let currentLineNumber = startLineNumber;
        let errorCount = 0;
        const maxErrors = 5;
        const pollInterval = 1000; // Poll every second (fallback)
        let usePolling = false; // Start with fs.watch, fallback to polling if needed

        // Function to read new lines from file
        const readNewLines = async (): Promise<void> => {
            try {
                const stats = await fs.stat(filePath);
                
                // If file size increased, read new lines
                if (stats.size > lastSize) {
                    const stream = createReadStream(filePath, {
                        encoding,
                        start: lastSize,
                        end: stats.size
                    });

                    const rl = createInterface({
                        input: stream,
                        crlfDelay: Infinity
                    });

                    for await (const line of rl) {
                        currentLineNumber++;
                        callback({
                            line: line,
                            lineNumber: currentLineNumber,
                            filePath: filePath
                        });
                    }

                    lastSize = stats.size;
                    errorCount = 0; // Reset error count on success
                } else if (stats.size < lastSize) {
                    // File was truncated or rotated, reset position
                    lastSize = 0;
                    currentLineNumber = startLineNumber;
                }
            } catch (error) {
                errorCount++;
                console.error(`[LogReaderService] Error reading file ${filePath}:`, error);
                
                // If too many errors and using fs.watch, switch to polling
                if (errorCount >= maxErrors && !usePolling) {
                    console.warn(`[LogReaderService] Too many errors, switching to polling for ${filePath}`);
                    usePolling = true;
                    // Stop fs.watch
                    const watchers = (this as any).watchers;
                    if (watchers && watchers.has(filePath)) {
                        const watcher = watchers.get(filePath);
                        watcher.close();
                        watchers.delete(filePath);
                    }
                    // Start polling as fallback
                    if (!(this as any).intervals) {
                        (this as any).intervals = new Map<string, NodeJS.Timeout>();
                    }
                    const poll = async () => {
                        await readNewLines();
                    };
                    const intervalId = setInterval(poll, pollInterval);
                    (this as any).intervals.set(filePath, intervalId);
                }
            }
        };

        // Initial read of current file size
        try {
            const stats = await fs.stat(filePath);
            lastSize = stats.size;
        } catch {
            // File doesn't exist yet, start from 0
            lastSize = 0;
        }

        // Try to use fs.watch first (more efficient)
        try {
            const watcher = fsSync.watch(filePath, { encoding: 'buffer' }, async (eventType, filename) => {
                if (eventType === 'change') {
                    await readNewLines();
                }
            });

            // Store watcher for cleanup
            if (!(this as any).watchers) {
                (this as any).watchers = new Map<string, fsSync.FSWatcher>();
            }
            (this as any).watchers.set(filePath, watcher);

            // Handle watcher errors - fallback to polling
            watcher.on('error', (error) => {
                console.warn(`[LogReaderService] fs.watch error for ${filePath}, falling back to polling:`, error);
                usePolling = true;
                watcher.close();
                (this as any).watchers?.delete(filePath);
                
                // Start polling as fallback
                if (!(this as any).intervals) {
                    (this as any).intervals = new Map<string, NodeJS.Timeout>();
                }
                
                const poll = async () => {
                    await readNewLines();
                };
                
                const intervalId = setInterval(poll, pollInterval);
                (this as any).intervals.set(filePath, intervalId);
            });

        } catch (error) {
            // fs.watch not available or failed, use polling
            console.warn(`[LogReaderService] fs.watch not available for ${filePath}, using polling:`, error);
            usePolling = true;
        }

        // If using polling (fallback or explicit)
        if (usePolling) {
            // Store intervals map
            if (!(this as any).intervals) {
                (this as any).intervals = new Map<string, NodeJS.Timeout>();
            }

            const poll = async () => {
                await readNewLines();
            };

            // Poll for changes
            const intervalId = setInterval(poll, pollInterval);
            (this as any).intervals.set(filePath, intervalId);
        }

        // Return a promise that resolves when follow is stopped
        return new Promise((resolve) => {
            // Promise will be resolved when stopFollowing is called
            (this as any).followPromises = (this as any).followPromises || new Map();
            (this as any).followPromises.set(filePath, resolve);
        });
    }

    /**
     * Stop following a file
     */
    stopFollowing(filePath: string): void {
        // Stop polling interval if exists
        const intervals = (this as any).intervals;
        if (intervals && intervals.has(filePath)) {
            clearInterval(intervals.get(filePath));
            intervals.delete(filePath);
        }

        // Close fs.watch watcher if exists
        const watchers = (this as any).watchers;
        if (watchers && watchers.has(filePath)) {
            const watcher = watchers.get(filePath);
            watcher.close();
            watchers.delete(filePath);
        }

        // Resolve promise if exists
        const promises = (this as any).followPromises;
        if (promises && promises.has(filePath)) {
            const resolve = promises.get(filePath);
            promises.delete(filePath);
            resolve();
        }
    }

  

    /**
     * Detect log rotation (when a log file is rotated)
     */
    async detectRotation(filePath: string): Promise<string | null> {
        // Check for rotated files: file.log.1, file.log.2.gz, etc.
        const dir = path.dirname(filePath);
        const basename = path.basename(filePath);
        const ext = path.extname(basename);
        const nameWithoutExt = path.basename(basename, ext);

        try {
            const files = await fs.readdir(dir);
            const rotatedFiles = files
                .filter(f => f.startsWith(nameWithoutExt) && f !== basename)
                .sort()
                .reverse(); // Most recent first

            return rotatedFiles.length > 0 ? path.join(dir, rotatedFiles[0]) : null;
        } catch {
            return null;
        }
    }
}

// Export singleton instance
export const logReaderService = new LogReaderService();
