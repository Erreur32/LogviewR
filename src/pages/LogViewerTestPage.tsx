/**
 * Log Viewer Test Page
 * 
 * Minimal test page for testing the log viewer backend
 */

import { useEffect, useState } from 'react';
import { useLogViewerStore } from '../stores/logViewerStore.js';
import { api } from '../api/client.js';

export function LogViewerTestPage() {
    const {
        selectedPluginId,
        selectedFileId,
        logs,
        columns,
        isLoading,
        error,
        setSelectedPlugin,
        setSelectedFile,
        setLogs,
        setColumns,
        setLoading,
        setError
    } = useLogViewerStore();

    const [availableFiles, setAvailableFiles] = useState<Array<{
        path: string;
        type: string;
        size: number;
        modified: string;
    }>>([]);
    const [plugins] = useState(['host-system', 'nginx', 'apache', 'npm']);

    // Load available files for selected plugin
    useEffect(() => {
        if (!selectedPluginId) {
            return;
        }

        const loadFiles = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await api.get(`/api/log-viewer/plugins/${selectedPluginId}/files`);
                const data = await response.json();

                if (data.files) {
                    setAvailableFiles(data.files);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load files');
            } finally {
                setLoading(false);
            }
        };

        loadFiles();
    }, [selectedPluginId, setLoading, setError]);

    // Load logs for selected file
    useEffect(() => {
        if (!selectedFileId) {
            return;
        }

        const loadLogs = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await api.get(`/api/log-viewer/files/${selectedFileId}/logs?maxLines=100`);
                const data = await response.json();

                if (data.logs) {
                    setLogs(data.logs.map((log: any) => log.parsed));
                }
                if (data.columns) {
                    setColumns(data.columns);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load logs');
            } finally {
                setLoading(false);
            }
        };

        loadLogs();
    }, [selectedFileId, setLogs, setColumns, setLoading, setError]);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">Log Viewer Test</h1>

            {/* Plugin Selection */}
            <div className="mb-4">
                <label className="block mb-2">Select Plugin:</label>
                <select
                    value={selectedPluginId || ''}
                    onChange={(e) => setSelectedPlugin(e.target.value || null)}
                    className="border rounded p-2"
                >
                    <option value="">-- Select Plugin --</option>
                    {plugins.map((pluginId) => (
                        <option key={pluginId} value={pluginId}>
                            {pluginId}
                        </option>
                    ))}
                </select>
            </div>

            {/* Files List */}
            {selectedPluginId && (
                <div className="mb-4">
                    <h2 className="text-xl font-semibold mb-2">Available Files:</h2>
                    {isLoading ? (
                        <p>Loading files...</p>
                    ) : availableFiles.length === 0 ? (
                        <p>No files found</p>
                    ) : (
                        <ul className="list-disc list-inside">
                            {availableFiles.map((file, index) => (
                                <li key={index} className="mb-2">
                                    <button
                                        onClick={() => {
                                            // For testing, we'll use the file path directly
                                            // In production, we'd need to create a LogFile entry first
                                            setSelectedFile(index + 1, file.path, file.type);
                                        }}
                                        className="text-blue-600 hover:underline"
                                    >
                                        {file.path} ({file.type})
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                    Error: {error}
                </div>
            )}

            {/* Logs Display */}
            {selectedFileId && (
                <div className="mb-4">
                    <h2 className="text-xl font-semibold mb-2">Logs:</h2>
                    {isLoading ? (
                        <p>Loading logs...</p>
                    ) : logs.length === 0 ? (
                        <p>No logs found</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse border border-gray-300">
                                <thead>
                                    <tr>
                                        {columns.map((col) => (
                                            <th key={col} className="border border-gray-300 p-2 bg-gray-100">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.slice(0, 50).map((log, index) => (
                                        <tr key={index}>
                                            {columns.map((col) => (
                                                <td key={col} className="border border-gray-300 p-2">
                                                    {String(log[col] || '')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-2 text-sm text-gray-600">
                                Showing {Math.min(50, logs.length)} of {logs.length} logs
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
