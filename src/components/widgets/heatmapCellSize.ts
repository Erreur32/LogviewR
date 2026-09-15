/**
 * Clamp a heatmap cell/row size (and its gap) so `columns` items fit `containerWidth` without
 * horizontal scroll. Shared between HeatmapChart and HourDayHeatmap so both charts render at a
 * consistent height for a given container width.
 */
export function fitHeatmapCellSize(containerWidth: number, columns: number, reserved = 36): { cellSize: number; cellGap: number } {
    if (containerWidth <= 0 || columns <= 0) return { cellSize: 14, cellGap: 3 };
    const available = Math.max(0, containerWidth - reserved);
    const stepF = available / columns;
    const cellSize = Math.max(4, Math.min(14, Math.floor(stepF * 0.82)));
    const cellGap = Math.max(1, Math.min(3, Math.floor(stepF - cellSize)));
    return { cellSize, cellGap };
}
