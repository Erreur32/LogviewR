/**
 * Log Format Detector
 * 
 * Détection automatique du format de log en analysant un échantillon de lignes
 * Utilise les patterns Grok et la bibliothèque de patterns pour calculer un score de confiance
 */

import { LogPatternLibrary, type LogPattern } from './LogPatternLibrary.js';
import { parseGrokPattern } from './GrokPatterns.js';
import { logReaderService } from '../../services/logReaderService.js';

export interface DetectedFormat {
    format: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
    confidence: number; // 0-100
    parserType: string;
    patternName: string;
    sampleMatches: number; // Nombre de lignes qui matchent sur l'échantillon
    totalSamples: number;
    pattern?: LogPattern;
}

/**
 * Détecter le format d'un fichier de log en analysant un échantillon
 * @param filePath Chemin du fichier
 * @param sampleSize Nombre de lignes à analyser (défaut: 50)
 * @returns Format détecté avec score de confiance
 */
export async function detectLogFormat(
    filePath: string,
    sampleSize: number = 50
): Promise<DetectedFormat | null> {
    try {
        // Lire un échantillon de lignes
        const logLines = await logReaderService.readLogFile(filePath, {
            maxLines: sampleSize,
            fromLine: 0,
            encoding: 'utf8',
            readCompressed: false
        });

        if (logLines.length === 0) {
            return null;
        }

        const sampleLines = logLines.map(l => l.line).filter(line => line.trim().length > 0);

        if (sampleLines.length === 0) {
            return null;
        }

        return detectLogFormatFromLines(sampleLines);
    } catch (error) {
        console.error(`[LogFormatDetector] Error detecting format for ${filePath}:`, error);
        return null;
    }
}

/**
 * Détecter le format à partir d'un échantillon de lignes
 * @param sampleLines Lignes à analyser
 * @returns Format détecté avec score de confiance
 */
export function detectLogFormatFromLines(sampleLines: string[]): DetectedFormat | null {
    if (sampleLines.length === 0) {
        return null;
    }

    const results: DetectedFormat[] = [];

    // Tester chaque pattern de la bibliothèque
    for (const pattern of LogPatternLibrary) {
        let matches = 0;
        let totalTested = 0;

        for (const line of sampleLines) {
            if (line.trim().length === 0) {
                continue;
            }

            totalTested++;

            // Si le pattern a une fonction parser, l'utiliser
            if (pattern.parserFunction) {
                try {
                    const result = pattern.parserFunction(line);
                    if (result && result.message) {
                        matches++;
                    }
                } catch {
                    // Parser failed, continue
                }
            } else if (pattern.grokPattern) {
                // Utiliser le pattern Grok
                try {
                    const result = parseGrokPattern(line, pattern.grokPattern);
                    if (result) {
                        matches++;
                    }
                } catch {
                    // Pattern failed, continue
                }
            }
        }

        if (totalTested === 0) {
            continue;
        }

        // Calculer le score de confiance
        const matchRate = (matches / totalTested) * 100;
        const confidence = Math.round(matchRate);

        // Ne garder que les patterns qui dépassent le seuil de confiance
        if (confidence >= pattern.confidenceThreshold) {
            results.push({
                format: pattern.logType,
                confidence,
                parserType: pattern.logType,
                patternName: pattern.name,
                sampleMatches: matches,
                totalSamples: totalTested,
                pattern
            });
        }
    }

    if (results.length === 0) {
        // Aucun pattern ne correspond, retourner custom
        return {
            format: 'custom',
            confidence: 0,
            parserType: 'custom',
            patternName: 'unknown',
            sampleMatches: 0,
            totalSamples: sampleLines.length
        };
    }

    // Trier par score de confiance décroissant
    results.sort((a, b) => b.confidence - a.confidence);

    // Retourner le meilleur résultat
    return results[0];
}

/**
 * Valider qu'un format détecté fonctionne bien sur un échantillon
 * @param filePath Chemin du fichier
 * @param detectedFormat Format détecté
 * @param validationSampleSize Nombre de lignes pour validation (défaut: 100)
 * @returns true si le format est validé
 */
export async function validateDetectedFormat(
    filePath: string,
    detectedFormat: DetectedFormat,
    validationSampleSize: number = 100
): Promise<boolean> {
    try {
        const logLines = await logReaderService.readLogFile(filePath, {
            maxLines: validationSampleSize,
            fromLine: 0,
            encoding: 'utf8',
            readCompressed: false
        });

        const sampleLines = logLines.map(l => l.line).filter(line => line.trim().length > 0);

        if (sampleLines.length === 0) {
            return false;
        }

        const pattern = detectedFormat.pattern;
        if (!pattern) {
            return false;
        }

        let matches = 0;
        let totalTested = 0;

        for (const line of sampleLines) {
            if (line.trim().length === 0) {
                continue;
            }

            totalTested++;

            if (pattern.parserFunction) {
                try {
                    const result = pattern.parserFunction(line);
                    if (result && result.message) {
                        matches++;
                    }
                } catch {
                    // Parser failed
                }
            } else if (pattern.grokPattern) {
                try {
                    const result = parseGrokPattern(line, pattern.grokPattern);
                    if (result) {
                        matches++;
                    }
                } catch {
                    // Pattern failed
                }
            }
        }

        if (totalTested === 0) {
            return false;
        }

        const matchRate = (matches / totalTested) * 100;
        // Valider si au moins 70% des lignes matchent
        return matchRate >= 70;
    } catch (error) {
        console.error(`[LogFormatDetector] Error validating format for ${filePath}:`, error);
        return false;
    }
}
