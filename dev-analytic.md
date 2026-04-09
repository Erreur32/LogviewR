# LogviewR — SonarCloud + Snyk Setup Guide

## Current state

Already configured: CodeQL, Dependabot, OSSF Scorecard, CI, Docker Build
Missing: **SonarCloud**, **Snyk**

---

## 1. SonarCloud

### Step 1 — Manual (web)

1. Go to https://sonarcloud.io → Import project → Select `Erreur32/LogviewR`
2. Organization: `erreur32` (same as MyNetwork)
3. Disable "Automatic Analysis" in Project Settings → Analysis Method (we use CI-based)
4. Add secret `SONAR_TOKEN` in GitHub repo settings → Secrets → Actions (reuse same org token from MyNetwork if available)

### Step 2 — Create `sonar-project.properties`

```properties
sonar.projectKey=Erreur32_LogviewR
sonar.organization=erreur32

sonar.projectName=LogviewR
sonar.projectVersion=0.8.37

# Sources
sonar.sources=src,server
sonar.exclusions=**/node_modules/**,**/dist/**,**/build/**,**/*.test.*,**/*.spec.*,**/coverage/**

# Exclude all sources from coverage (no test suite)
sonar.coverage.exclusions=**/*

# TypeScript
sonar.typescript.lcov.reportPaths=coverage/lcov.info

# Encoding
sonar.sourceEncoding=UTF-8
```

### Step 3 — Create `.github/workflows/sonarcloud.yml`

```yaml
name: SonarCloud Analysis

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  sonarcloud:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
        with:
          fetch-depth: 0

      - name: SonarCloud Scan
        uses: SonarSource/sonarqube-scan-action@fd88b7d7ccbaefd23d8f36f73b59db7a3d246602 # v6
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

---

## 2. Snyk

### Step 1 — Manual (web)

Add secret `SNYK_TOKEN` in GitHub repo settings → Secrets → Actions (reuse same token from MyNetwork, expires 2026-07-08)

### Step 2 — Create `.github/workflows/snyk.yml`

```yaml
name: Snyk Security

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions: {}

jobs:
  snyk-code:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Run Snyk Code (SAST)
        uses: snyk/actions/node@9adf32b1121593767fc3c057af55b55db032dc04 # master
        continue-on-error: true
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          command: code test
          args: --sarif-file-output=snyk-code.sarif

      - name: Upload Snyk Code results to GitHub
        uses: github/codeql-action/upload-sarif@3b1a19a80ab047f35cbb237b5bd9bdc1e14f166c # v3
        if: always() && hashFiles('snyk-code.sarif') != ''
        with:
          sarif_file: snyk-code.sarif

  snyk-deps:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Run Snyk Open Source (dependencies)
        uses: snyk/actions/node@9adf32b1121593767fc3c057af55b55db032dc04 # master
        continue-on-error: true
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high --sarif-file-output=snyk-deps.sarif

      - name: Upload Snyk dependency results to GitHub
        uses: github/codeql-action/upload-sarif@3b1a19a80ab047f35cbb237b5bd9bdc1e14f166c # v3
        if: always() && hashFiles('snyk-deps.sarif') != ''
        with:
          sarif_file: snyk-deps.sarif

  snyk-docker:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Build Docker image for scanning
        run: docker build -t logviewr:scan .

      - name: Run Snyk Container (Docker image)
        uses: snyk/actions/docker@9adf32b1121593767fc3c057af55b55db032dc04 # master
        continue-on-error: true
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          image: logviewr:scan
          args: --severity-threshold=high --sarif-file-output=snyk-docker.sarif

      - name: Upload Snyk Docker results to GitHub
        uses: github/codeql-action/upload-sarif@3b1a19a80ab047f35cbb237b5bd9bdc1e14f166c # v3
        if: always() && hashFiles('snyk-docker.sarif') != ''
        with:
          sarif_file: snyk-docker.sarif
```

---

## 3. README badges (optional)

Add after existing badges:

```markdown
[![SonarCloud](https://img.shields.io/sonar/quality_gate/Erreur32_LogviewR?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge&logo=sonarcloud&logoColor=white&label=Sonar)](https://sonarcloud.io/summary/overall?id=Erreur32_LogviewR)
[![Snyk](https://img.shields.io/github/actions/workflow/status/Erreur32/LogviewR/snyk.yml?style=for-the-badge&logo=snyk&logoColor=white&label=Snyk&color=111827)](https://github.com/Erreur32/LogviewR/actions/workflows/snyk.yml)
```

Note: Do NOT use `shields.io/snyk/vulnerabilities/` badge — it requires snyk.io web monitoring. Use the GitHub Actions workflow badge instead.

---

## 4. Pitfalls learned from MyNetwork

| Pitfall | Solution |
|---------|----------|
| SonarCloud Quality Gate fails on 0% coverage | Add `sonar.coverage.exclusions=**/*` if no test suite |
| Snyk Docker alerts on base image deps (picomatch, brace-expansion) | False positives — dismiss as "Won't fix" |
| Scorecard Token-Permissions alert | Use `permissions: {}` at top level, define per-job |
| Actions not pinned to SHA | Pin all actions to commit SHA for Scorecard compliance |
| SNYK_TOKEN expiry | Current token expires **2026-07-08** — renew before then |
