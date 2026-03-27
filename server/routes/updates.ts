/**
 * Update Check Routes
 * 
 * Handles checking for new Docker image versions from GitHub Container Registry
 */

import express from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getDatabase } from '../database/connection.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Get current version from package.json
function getCurrentVersion(): string {
  try {
    const packagePath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch (error) {
    logger.error('Updates', `Error reading package.json: ${error instanceof Error ? error.message : String(error)}`);
    return '0.0.0';
  }
}

/**
 * Compare two version strings (semver format: x.y.z)
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  
  return 0;
}

/**
 * Check if a specific Docker image tag exists on GHCR (public anonymous check).
 * GHCR requires an anonymous Bearer token even for public images.
 * Returns true if the image manifest is present (build completed), false otherwise.
 */
async function checkDockerImageAvailable(version: string): Promise<boolean> {
  try {
    // Step 1: get anonymous pull token for the repository
    const tokenUrl = 'https://ghcr.io/token?scope=repository:erreur32/logviewr:pull&service=ghcr.io';
    const tokenRes = await fetch(tokenUrl, {
      headers: { 'User-Agent': 'LogviewR-UpdateChecker/1.0' },
    });
    if (!tokenRes.ok) {
      return false;
    }
    const tokenData = await tokenRes.json() as { token?: string };
    const token = tokenData.token;
    if (!token) return false;

    // Step 2: HEAD the manifest for the exact version tag
    const manifestUrl = `https://ghcr.io/v2/erreur32/logviewr/manifests/${version}`;
    const manifestRes = await fetch(manifestUrl, {
      method: 'HEAD',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
        ].join(','),
        'User-Agent': 'LogviewR-UpdateChecker/1.0',
      },
    });

    const ok = manifestRes.status === 200;
    logger.debug('Updates', `GHCR image ${version}: ${ok ? 'available' : `not ready (${manifestRes.status})`}`);
    return ok;
  } catch (err) {
    logger.debug('Updates', `GHCR check error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * GET /api/updates/check
 * Check for available updates from GitHub Container Registry
 */
router.get('/check', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const db = getDatabase();
  
  // Check if update checking is enabled
  const updateConfigStmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
  const updateConfigRow = updateConfigStmt.get('update_check_config') as { value: string } | undefined;
  
  let updateCheckEnabled = false; // Default to disabled
  if (updateConfigRow) {
    try {
      const config = JSON.parse(updateConfigRow.value);
      updateCheckEnabled = config.enabled === true; // Only enabled if explicitly set to true
    } catch {
      // ignore malformed config
    }
  }

  if (!updateCheckEnabled) {
    return res.json({
      success: true,
      result: {
        enabled: false,
        currentVersion: getCurrentVersion(),
        latestVersion: null,
        updateAvailable: false,
        message: 'Update checking is disabled'
      }
    });
  }
  
  const currentVersion = getCurrentVersion();
  let latestVersion: string | null = null;
  let updateAvailable = false;
  let error: string | null = null;
  
  try {
    // Try multiple methods to get package versions
    // Method 1: GitHub Tags API (public, no auth required, more reliable)
    let versionTags: string[] = [];
    let lastError: string | null = null;
    
    // Use optional GitHub token from environment if available
    const githubToken = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'LogviewR-UpdateChecker/1.0',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    // Method 1: GitHub Tags API (public, no auth required)
    try {
      const tagsApiUrl = 'https://api.github.com/repos/erreur32/LogviewR/tags';
      const tagsResponse = await fetch(tagsApiUrl, {
        headers
      });
      
      if (tagsResponse.ok) {
        const tags = await tagsResponse.json() as Array<{
          name: string;
          commit: { sha: string; url: string };
        }>;

        if (tags.length > 0) {
          const tagNames = tags.map(tag => tag.name);
          versionTags = tagNames
            .filter(tag => {
              // Accept: x.y.z, vx.y.z format
              const isSemanticVersion = /^\d+\.\d+\.\d+/.test(tag) || /^v\d+\.\d+\.\d+/.test(tag);
              // Also accept partial versions like 0.0, 0.0.0, etc.
              const isPartialVersion = /^\d+\.\d+$/.test(tag) || /^v\d+\.\d+$/.test(tag);
              // Exclude: latest, main, dev, etc.
              const isExcluded = ['latest', 'main', 'dev', 'develop', 'master', 'staging', 'beta', 'alpha', 'rc'].includes(tag.toLowerCase());
              return (isSemanticVersion || isPartialVersion) && !isExcluded;
            })
            .map(tag => tag.replace(/^v/, '')) // Remove 'v' prefix if present
            .filter((tag, index, self) => self.indexOf(tag) === index) // Remove duplicates
            .sort((a, b) => compareVersions(b, a)); // Sort descending (newest first)
          
          logger.debug('Updates', `GitHub tags found: ${versionTags.join(', ')}`);

          if (versionTags.length > 0) {
            latestVersion = versionTags[0];
            updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
            // Only report updateAvailable if the Docker image is actually built and ready
            const dockerReady = updateAvailable
              ? await checkDockerImageAvailable(latestVersion)
              : false;
            return res.json({
              success: true,
              result: {
                enabled: true,
                currentVersion,
                latestVersion,
                updateAvailable: updateAvailable && dockerReady,
                dockerReady,
                error: undefined
              }
            });
          }
        }
      } else if (tagsResponse.status === 403) {
        const rateLimitRemaining = tagsResponse.headers.get('x-ratelimit-remaining');
        const rateLimitReset = tagsResponse.headers.get('x-ratelimit-reset');
        const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toLocaleString('fr-FR') : 'unknown';
        lastError = `GitHub API rate limit exceeded (remaining: ${rateLimitRemaining || '0'}). Reset at: ${resetTime}.`;
        logger.warn('Updates', lastError);
      } else if (tagsResponse.status === 404) {
        lastError = 'Repository not found or not accessible.';
      } else {
        lastError = `GitHub Tags API error: ${tagsResponse.status} ${tagsResponse.statusText}`;
      }
    } catch (tagsError) {
      lastError = `GitHub Tags API request failed: ${tagsError instanceof Error ? tagsError.message : 'Unknown error'}`;
      logger.debug('Updates', lastError);
    }
    
    // Method 2: Try GitHub REST API for packages (requires auth for most cases)
    try {
      // For user packages: /users/{username}/packages/container/{package_name}/versions
      const githubApiUrl = 'https://api.github.com/users/erreur32/packages/container/LogviewR/versions';
      const githubResponse = await fetch(githubApiUrl, {
        headers
      });
      
      if (githubResponse.ok) {
        const versions = await githubResponse.json() as Array<{
          id: number;
          name: string;
          created_at: string;
          updated_at: string;
          metadata?: {
            container?: {
              tags?: string[];
            };
          };
        }>;
        
        // Extract version tags from metadata
        // Tags can be in metadata.container.tags or directly in the version name
        const allTags: string[] = [];
        for (const version of versions) {
          // Try metadata.container.tags first
          if (version.metadata?.container?.tags) {
            allTags.push(...version.metadata.container.tags);
          }
          // Also check if name itself is a tag
          if (version.name && /^\d+\.\d+\.\d+/.test(version.name)) {
            allTags.push(version.name);
          }
        }
        
        versionTags = allTags
          .filter(tag => {
            // Accept: x.y.z, vx.y.z format
            const isSemanticVersion = /^\d+\.\d+\.\d+/.test(tag) || /^v\d+\.\d+\.\d+/.test(tag);
            // Also accept partial versions like 0.0, 0.0.0, etc.
            const isPartialVersion = /^\d+\.\d+$/.test(tag) || /^v\d+\.\d+$/.test(tag);
            // Exclude: latest, main, dev, etc.
            const isExcluded = ['latest', 'main', 'dev', 'develop', 'master', 'staging', 'beta', 'alpha', 'rc'].includes(tag.toLowerCase());
            return (isSemanticVersion || isPartialVersion) && !isExcluded;
          })
          .map(tag => tag.replace(/^v/, '')) // Remove 'v' prefix if present
          .filter((tag, index, self) => self.indexOf(tag) === index) // Remove duplicates
          .sort((a, b) => compareVersions(b, a)); // Sort descending (newest first)
        
        logger.debug('Updates', `GitHub packages API found ${versionTags.length} version tags`);

        if (versionTags.length > 0) {
          // Success with GitHub API
          latestVersion = versionTags[0];
          updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
          return res.json({
            success: true,
            result: {
              enabled: true,
              currentVersion,
              latestVersion,
              updateAvailable,
              error: undefined
            }
          });
        }
      } else if (githubResponse.status === 401 || githubResponse.status === 403) {
        lastError = 'GitHub API requires authentication even for public packages.';
      } else if (githubResponse.status === 404) {
        lastError = 'Package not found via GitHub API.';
      } else {
        lastError = `GitHub API error: ${githubResponse.status} ${githubResponse.statusText}`;
      }
    } catch (githubError) {
      lastError = `GitHub API request failed: ${githubError instanceof Error ? githubError.message : 'Unknown error'}`;
    }
    
    // Method 3: Try GitHub GraphQL API (only if token is available to avoid rate limits)
    if (githubToken) {
      try {
        const graphqlQuery = {
          query: `
            query {
              user(login: "erreur32") {
                packages(first: 1, packageType: CONTAINER, names: ["LogviewR"]) {
                  nodes {
                    versions(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
                      nodes {
                        id
                        version
                        package {
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          `
        };
        
        const graphqlHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'LogviewR-UpdateChecker/1.0',
          'Authorization': `Bearer ${githubToken}`
        };
        
        const graphqlResponse = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: graphqlHeaders,
          body: JSON.stringify(graphqlQuery)
        });
        
        if (graphqlResponse.ok) {
          const graphqlData = await graphqlResponse.json() as {
            data?: {
              user?: {
                packages?: {
                  nodes?: Array<{
                    versions?: {
                      nodes?: Array<{
                        version: string;
                      }>;
                    };
                  }>;
                };
              };
            };
            errors?: Array<{ message: string }>;
          };
          
          if (graphqlData.data?.user?.packages?.nodes?.[0]?.versions?.nodes) {
            const versions = graphqlData.data.user.packages.nodes[0].versions.nodes;
            const allVersions = versions.map(v => v.version);
            
            const graphqlTags = allVersions
              .filter(tag => {
                const isSemanticVersion = /^\d+\.\d+\.\d+/.test(tag) || /^v\d+\.\d+\.\d+/.test(tag);
                const isPartialVersion = /^\d+\.\d+$/.test(tag) || /^v\d+\.\d+$/.test(tag);
                const isExcluded = ['latest', 'main', 'dev', 'develop', 'master', 'staging', 'beta', 'alpha', 'rc'].includes(tag.toLowerCase());
                return (isSemanticVersion || isPartialVersion) && !isExcluded;
              })
              .map(tag => tag.replace(/^v/, ''))
              .filter((tag, index, self) => self.indexOf(tag) === index)
              .sort((a, b) => compareVersions(b, a));
            
            logger.debug('Updates', `GraphQL API found ${graphqlTags.length} version tags`);

            if (graphqlTags.length > 0) {
              // Merge with existing tags and keep unique
              versionTags = [...new Set([...versionTags, ...graphqlTags])].sort((a, b) => compareVersions(b, a));
              
              if (versionTags.length > 0) {
                latestVersion = versionTags[0];
                updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
                return res.json({
                  success: true,
                  result: {
                    enabled: true,
                    currentVersion,
                    latestVersion,
                    updateAvailable,
                    error: undefined
                  }
                });
              }
            }
          } else if (graphqlData.errors) {
            logger.debug('Updates', `GraphQL API returned errors`);
          }
        } else {
          logger.debug('Updates', `GraphQL API failed: ${graphqlResponse.status} ${graphqlResponse.statusText}`);
        }
      } catch (graphqlError) {
        logger.debug('Updates', `GraphQL API request failed: ${graphqlError instanceof Error ? graphqlError.message : String(graphqlError)}`);
      }
    }
    
    // Final fallback: Try Docker Registry API (may require auth)
    try {
      const dockerRegistryUrl = 'https://ghcr.io/v2/erreur32/LogviewR/tags/list';
      const dockerResponse = await fetch(dockerRegistryUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LogviewR-UpdateChecker/1.0'
        }
      });
      
      if (dockerResponse.ok) {
        const dockerData = await dockerResponse.json() as { tags?: string[] };
        
        if (dockerData.tags && dockerData.tags.length > 0) {
          // Filter tags - accept semantic versions (x.y.z or vx.y.z)
          // Also accept partial versions like 0.0 but prefer full versions
          versionTags = dockerData.tags
            .filter(tag => {
              // Accept: x.y.z, vx.y.z format
              const isSemanticVersion = /^\d+\.\d+\.\d+/.test(tag) || /^v\d+\.\d+\.\d+/.test(tag);
              // Also accept partial versions like 0.0, 0.0.0, etc.
              const isPartialVersion = /^\d+\.\d+$/.test(tag) || /^v\d+\.\d+$/.test(tag);
              // Exclude: latest, main, dev, etc.
              const isExcluded = ['latest', 'main', 'dev', 'develop', 'master', 'staging', 'beta', 'alpha', 'rc'].includes(tag.toLowerCase());
              return (isSemanticVersion || isPartialVersion) && !isExcluded;
            })
            .map(tag => tag.replace(/^v/, '')) // Remove 'v' prefix if present
            .filter((tag, index, self) => self.indexOf(tag) === index) // Remove duplicates
            .sort((a, b) => compareVersions(b, a)); // Sort descending (newest first)
          
          logger.debug('Updates', `Docker Registry found ${versionTags.length} version tags`);

          if (versionTags.length > 0) {
            latestVersion = versionTags[0];
            updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
            return res.json({
              success: true,
              result: {
                enabled: true,
                currentVersion,
                latestVersion,
                updateAvailable,
                error: undefined
              }
            });
          } else {
            logger.debug('Updates', 'Docker Registry: no version tags after filtering');
          }
        } else {
          logger.debug('Updates', 'Docker Registry returned no tags');
        }
      } else if (dockerResponse.status === 401) {
        error = 'Package requires authentication. Even public packages may require a GitHub token to access the API.';
      } else if (dockerResponse.status === 404) {
        error = 'Package not found. Verify the package name and visibility settings.';
      } else {
        error = `Docker Registry API error: ${dockerResponse.status} ${dockerResponse.statusText}`;
      }
    } catch (dockerError) {
      error = `Docker Registry API request failed: ${dockerError instanceof Error ? dockerError.message : 'Unknown error'}`;
      if (lastError) {
        error = `${lastError} Also: ${error}`;
      }
    }
    
    // If we reach here, both methods failed
    if (!error && lastError) {
      error = lastError;
    }
    if (!error) {
      error = 'Unable to retrieve package versions. Both GitHub API and Docker Registry API failed.';
    }
    
    // Process version tags
    if (versionTags.length > 0) {
      latestVersion = versionTags[0];
      updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    } else {
      error = 'Problème de récupération de version';
    }
  } catch (err) {
    logger.error('Updates', `Error checking for updates: ${err instanceof Error ? err.message : String(err)}`);
    error = err instanceof Error ? err.message : 'Unknown error';
  }
  
  res.json({
    success: true,
    result: {
      enabled: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      error: error || undefined
    }
  });
}));

/**
 * GET /api/updates/config
 * Get update check configuration
 */
router.get('/config', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const db = getDatabase();
  const stmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
  const row = stmt.get('update_check_config') as { value: string } | undefined;
  
  let config: { enabled: boolean; frequency: number } = { enabled: true, frequency: 24 };
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      config = {
        enabled: parsed.enabled === true,
        frequency: typeof parsed.frequency === 'number' ? parsed.frequency : 24,
      };
    } catch (error) {
      logger.error('Updates', `Error parsing update_check_config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  res.json({
    success: true,
    result: config
  });
}));

/**
 * POST /api/updates/config
 * Update update check configuration
 */
router.post('/config', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { enabled, frequency } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: { message: 'enabled must be a boolean', code: 'INVALID_INPUT' }
    });
  }

  const VALID_FREQUENCIES = [1, 6, 12, 24, 168];
  const safeFrequency = VALID_FREQUENCIES.includes(frequency) ? frequency : 24;

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);

  const config = { enabled, frequency: safeFrequency };
  stmt.run('update_check_config', JSON.stringify(config));

  res.json({ success: true, result: config });
}));

export default router;
