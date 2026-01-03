/**
 * Log Pattern Library
 * 
 * Bibliothèque de patterns Grok prédéfinis pour la détection automatique de formats de logs
 * Utilise les patterns Grok existants pour valider différents formats
 */

import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';
import { SyslogParser } from './SyslogParser.js';
import { AuthLogParser } from './AuthLogParser.js';
import { KernLogParser } from './KernLogParser.js';
import { DaemonLogParser } from './DaemonLogParser.js';
import { MailLogParser } from './MailLogParser.js';

export interface LogPattern {
    name: string;
    category: 'system' | 'application' | 'custom';
    logType: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
    grokPattern?: string;
    parserFunction?: (line: string) => any;
    description: string;
    examples: string[];
    confidenceThreshold: number; // Score minimum pour considérer le pattern valide (0-100)
}

/**
 * Bibliothèque de patterns prédéfinis
 */
export const LogPatternLibrary: LogPattern[] = [
    // Patterns Système
    {
        name: 'syslog-standard',
        category: 'system',
        logType: 'syslog',
        grokPattern: buildSyslogPattern(false),
        parserFunction: (line: string) => SyslogParser.parseSyslogLine(line),
        description: 'Format syslog standard (sans priority)',
        examples: [
            'Jan 15 10:30:45 hostname sshd[12345]: Accepted password for user',
            '2025-12-28T00:00:02.098394+01:00 Home32-Cloud CRON[2175971]: (root) CMD (command)'
        ],
        confidenceThreshold: 80
    },
    {
        name: 'syslog-with-priority',
        category: 'system',
        logType: 'syslog',
        grokPattern: buildSyslogPattern(true),
        parserFunction: (line: string) => SyslogParser.parseSyslogLine(line),
        description: 'Format syslog avec priority',
        examples: [
            '<30>Jan 15 10:30:45 hostname sshd[12345]: Accepted password for user'
        ],
        confidenceThreshold: 80
    },
    {
        name: 'auth-log',
        category: 'system',
        logType: 'auth',
        grokPattern: buildSyslogPattern(false),
        parserFunction: (line: string) => AuthLogParser.parseAuthLine(line),
        description: 'Format auth.log / secure',
        examples: [
            'Jan 15 10:30:45 hostname sshd: Accepted password for user from 192.168.1.1',
            '2025-12-28T00:00:02.098394+01:00 Home32-Cloud sshd[12345]: Accepted password'
        ],
        confidenceThreshold: 75
    },
    {
        name: 'kern-log',
        category: 'system',
        logType: 'kern',
        grokPattern: buildSyslogPattern(false),
        parserFunction: (line: string) => KernLogParser.parseKernLine(line),
        description: 'Format kern.log',
        examples: [
            'Jan 15 10:30:45 hostname kernel: [12345.678] CPU: 0 PID: 1234 Comm: process'
        ],
        confidenceThreshold: 70
    },
    {
        name: 'daemon-log',
        category: 'system',
        logType: 'daemon',
        grokPattern: buildSyslogPattern(false),
        parserFunction: (line: string) => DaemonLogParser.parseDaemonLine(line),
        description: 'Format daemon.log',
        examples: [
            'Jan 15 10:30:45 hostname systemd[1]: Started service',
            'Jan 15 10:30:45 hostname systemd[1]: Stopped service'
        ],
        confidenceThreshold: 70
    },
    {
        name: 'mail-log',
        category: 'system',
        logType: 'mail',
        grokPattern: buildSyslogPattern(false),
        parserFunction: (line: string) => MailLogParser.parseMailLine(line),
        description: 'Format mail.log',
        examples: [
            'Jan 15 10:30:45 hostname postfix/smtpd[12345]: connect from 192.168.1.1',
            'Jan 15 10:30:45 hostname postfix/qmgr[12345]: ABC123DEF: removed'
        ],
        confidenceThreshold: 70
    },
    // Patterns Applicatifs (exemples pour extension future)
    {
        name: 'apache-access',
        category: 'application',
        logType: 'custom',
        description: 'Format Apache access log',
        examples: [
            '192.168.1.1 - - [15/Jan/2025:10:30:45 +0100] "GET /index.html HTTP/1.1" 200 1234'
        ],
        confidenceThreshold: 85
    },
    {
        name: 'nginx-access',
        category: 'application',
        logType: 'custom',
        description: 'Format Nginx access log',
        examples: [
            '192.168.1.1 - - [15/Jan/2025:10:30:45 +0100] "GET /index.html HTTP/1.1" 200 1234'
        ],
        confidenceThreshold: 85
    }
];

/**
 * Obtenir tous les patterns d'une catégorie
 */
export function getPatternsByCategory(category: 'system' | 'application' | 'custom'): LogPattern[] {
    return LogPatternLibrary.filter(p => p.category === category);
}

/**
 * Obtenir tous les patterns système
 */
export function getSystemPatterns(): LogPattern[] {
    return getPatternsByCategory('system');
}

/**
 * Obtenir un pattern par nom
 */
export function getPatternByName(name: string): LogPattern | undefined {
    return LogPatternLibrary.find(p => p.name === name);
}

/**
 * Obtenir les patterns pour un type de log
 */
export function getPatternsByLogType(logType: string): LogPattern[] {
    return LogPatternLibrary.filter(p => p.logType === logType);
}
