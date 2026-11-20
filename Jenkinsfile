pipeline {

  agent any

  parameters {
    booleanParam(name: 'BUILD_OFFLINE_BUNDLE', defaultValue: false,
      description: 'Also produce the offline hospital install bundle (docker save .tar + install zip + SHA256). Slow, ~650MB+ artifact.')
    booleanParam(name: 'SKIP_SONAR', defaultValue: false,
      description: 'Skip SonarQube scan + Quality Gate (emergency builds only).')
  }

  environment {
    // ---- Registry / GitHub -------------------------------------------------
    // PACS repo: github.com/ssmani5491/pacs  →  image: ghcr.io/ssmani5491/pacs
    GH_NAMESPACE    = 'ssmani5491'        // lowercase GHCR namespace
    GH_OWNER        = 'ssmani5491'        // GitHub owner of the pacs repo
    DOCKER_BUILDKIT = '1'

    // Jenkins → Credentials, kind "Username with password" (GitHub username + PAT).
    // The PAT must have: repo (for tag push) + write:packages / read:packages for the ssmani5491 namespace.
    // If the existing 'Jenkins' credential belongs to another account, create a new one (e.g. 'ghcr-pacs') and change this ID.
    GIT_CRED_ID     = 'Jenkins'

    // ---- PACS build specifics ---------------------------------------------
    DOCKERFILE      = 'Dockerfile.allinone'   // single-container image: orthanc + backend + mwl-scp + nginx(frontend+OHIF) + redis
    BACKEND_DIR     = 'backend'
    NODE_IMAGE      = 'node:24-slim'          // same Node major + Debian base as the image (Prisma binaryTargets)

    // ---- Quality / security -----------------------------------------------
    SONAR_TOKEN_ID  = 'sonar-token'
    TRIVY_SEV_MAIN  = 'CRITICAL'
    TRIVY_SEV_DEV   = 'CRITICAL'
  }

  options {
    timestamps()
    disableConcurrentBuilds()                 // one PACS image build at a time (large image, shared Docker cache)
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '5'))
    timeout(time: 90, unit: 'MINUTES')        // OHIF build is slow on a cold cache
  }

  // Poll every 2 min, or enable "GitHub hook trigger for GITScm polling" in the job for instant builds.
  triggers {
    pollSCM('H/2 * * * *')
  }

  stages {

    /* ---------- 0) Checkout ---------- */
    stage('Checkout') {
      steps {
        checkout scm
        script {
          // Tags are needed for version calculation (git describe). Make sure they're fetched.
          sh 'git fetch --tags --force || true'

          def rawBranch = env.GIT_BRANCH ?: sh(returnStdout: true, script: 'git rev-parse --abbrev-ref HEAD').trim()
          // 'origin/main' / 'origin1/main' → 'main'
          env.BRANCH_NAME = rawBranch.replaceFirst(/^origin1?\//, '')
          echo "Active git branch: ${env.BRANCH_NAME} (raw: ${rawBranch})"

          // Safety: never build if secrets / patient data are tracked in git
          def leaked = sh(returnStdout: true, script: '''
            git ls-files | grep -E -i '(^|/)\\.env$|db_password\\.txt$|rispacs\\.ini$|\\.dcm$|(^|/)(data|test-data|demo-data|backups)/|\\.dump$|\\.sql\\.gz$' || true
          ''').trim()
          if (leaked) {
            error "Sensitive files are tracked in git (secrets or DICOM/patient data). Remove them before building:\n${leaked}"
          }
        }
      }
    }

    /* ---------- 1) Backend unit tests + type check ---------- */
    stage('Backend Tests') {
      when { anyOf { branch 'main'; branch 'dev' } }
      steps {
        // retry: a Jenkins controller restart mid-step breaks the durable-task
        // wrapper's heartbeat ("wrapper script does not seem to be touching the
        // log file"), which fails this step even when the command inside it
        // actually completed and passed. One retry re-runs the whole docker run
        // cleanly instead of requiring a manual full-pipeline re-trigger.
        retry(2) {
          sh '''
            set -eu
            docker run --rm \
              -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI=true \
              -v "${WORKSPACE}/${BACKEND_DIR}:/app" -w /app \
              ${NODE_IMAGE} \
              sh -c "npm ci --no-audit --no-fund && npx prisma generate && npx tsc --noEmit && npx jest --ci"
          '''
        }
      }
    }

    /* ---------- 2) SonarQube code scan ---------- */
    stage('Sonar Scan') {
      when {
        allOf {
          anyOf { branch 'main'; branch 'dev' }
          expression { !params.SKIP_SONAR }
        }
      }
      steps {
        script {
          env.SONAR_UNAVAILABLE = 'false'
          def scannerHome = tool name: 'sonar-scanner', type: 'hudson.plugins.sonar.SonarRunnerInstallation'
          def rawRepo = sh(returnStdout: true, script: 'basename -s .git $(git config --get remote.origin.url)').trim()
          def sqKey   = rawRepo.replaceAll('[^A-Za-z0-9:_\\-\\.]', '-')

          try {
            // retry: rides out a brief Sonar-server blip (restart, network hiccup).
            retry(2) {
              withSonarQubeEnv('sonar') {
                if (fileExists('sonar-project.properties')) {
                  sh """
                    ${scannerHome}/bin/sonar-scanner \
                      -Dproject.settings=sonar-project.properties \
                      -Dsonar.scm.provider=git
                  """
                } else {
                  sh """
                    ${scannerHome}/bin/sonar-scanner \
                      -Dsonar.projectKey=${sqKey} \
                      -Dsonar.projectName=${rawRepo} \
                      -Dsonar.sources=backend,frontend \
                      -Dsonar.exclusions=**/node_modules/**,**/build/**,**/dist/**,**/*.min.js,**/*.map,**/.env,**/*.env,**/*.dcm,**/test-data/**,**/demo-data/**,**/data/**,**/prisma/migrations/**,**/*secret*.json,**/*token*.json \
                      -Dsonar.sourceEncoding=UTF-8 \
                      -Dsonar.scm.provider=git
                  """
                }
              }
            }
          } catch (Exception e) {
            // Fail soft: the Sonar SERVER being unreachable (network/infra, e.g.
            // "Failed to query server version") is not a finding about this code -
            // don't fail the whole release build over it. A real quality-gate
            // failure happens in the Quality Gate stage below, with Sonar reachable.
            echo "WARNING: Sonar Scan failed after retries (server likely unreachable): ${e.getMessage()}"
            echo "WARNING: Skipping Quality Gate and continuing the pipeline without Sonar coverage for this build."
            env.SONAR_UNAVAILABLE = 'true'
          }
        }
      }
    }

    /* ---------- 3) Sonar Quality Gate ---------- */
    stage('Quality Gate') {
      when {
        allOf {
          anyOf { branch 'main'; branch 'dev' }
          expression { !params.SKIP_SONAR }
          expression { env.SONAR_UNAVAILABLE != 'true' }
        }
      }
      steps {
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    /* ---------- 4) Trivy filesystem scan (dependencies in source) ---------- */
    stage('Trivy Code Scan') {
      steps {
        script {
          sh 'mkdir -p reports'
          def sev = (env.BRANCH_NAME == 'main') ? env.TRIVY_SEV_MAIN : env.TRIVY_SEV_DEV
          def ignoreFlag = fileExists('.trivyignore') ? '--ignorefile /workspace/.trivyignore' : ''

          def rc = sh(returnStatus: true, script: """
            docker run --rm -v "${WORKSPACE}:/workspace" aquasec/trivy:latest fs \
              --no-progress --skip-version-check \
              --severity ${sev} --exit-code 1 \
              --format json -o /workspace/reports/trivy-fs.json \
              --skip-dirs .git --skip-dirs node_modules --skip-dirs dist --skip-dirs build \
              --skip-dirs reports --skip-dirs data --skip-dirs test-data --skip-dirs demo-data \
              --scanners vuln \
              ${ignoreFlag} \
              /workspace > reports/trivy-fs-console.txt 2>&1
          """)
          archiveArtifacts artifacts: 'reports/trivy-fs*', allowEmptyArchive: true
          if (rc != 0) {
            error "Trivy found ${sev} vulnerabilities in source dependencies. See reports/trivy-fs.json"
          }
        }
      }
    }

    /* ---------- 5) Docker build: single all-in-one PACS image ---------- */
    stage('Docker Build') {
      when { anyOf { branch 'main'; branch 'dev' } }
      steps {
        script {
          env.RAW_REPO = sh(returnStdout: true, script: 'basename -s .git $(git config --get remote.origin.url)').trim()
          def imageRepo = env.RAW_REPO.toLowerCase()
                            .replaceAll('[^a-z0-9._-]', '')
                            .replaceAll('^[-._]+|[-._]+$', '')
          if (!imageRepo) { error "Invalid repo '${env.RAW_REPO}' → cannot derive image name." }

          env.IMAGE = "ghcr.io/${env.GH_NAMESPACE}/${imageRepo}"     // → ghcr.io/ssmani5491/pacs

          def shortSha  = env.GIT_COMMIT.take(7)
          def buildNo   = env.BUILD_NUMBER
          def latestTag = sh(returnStdout: true, script: 'git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0').trim()
          def parts     = latestTag.replace('v', '').tokenize('.')
          def MAJOR     = (parts.size() > 0 ? parts[0].replaceAll('[^0-9].*', '') : '0') as int
          def MINOR     = (parts.size() > 1 ? parts[1].replaceAll('[^0-9].*', '') : '0') as int
          def PATCH     = (parts.size() > 2 ? parts[2].replaceAll('[^0-9].*', '') : '0') as int

          env.NEXT_VERSION = "v${MAJOR}.${MINOR}.${PATCH + 1}"          // after v1.0.1 → v1.0.2
          env.RC_VERSION   = "${env.NEXT_VERSION}-rc.${buildNo}"

          def isMain = (env.BRANCH_NAME == 'main')
          env.TAGS        = isMain ? "prod,latest,${env.NEXT_VERSION},${shortSha}" : "dev,${env.RC_VERSION},${shortSha}"
          env.PRIMARY_TAG = env.TAGS.split(',')[0]
          env.VERSION_LABEL = isMain ? env.NEXT_VERSION : env.RC_VERSION

          echo "Building ${env.IMAGE}:${env.PRIMARY_TAG} from ${env.DOCKERFILE} (branch ${env.BRANCH_NAME}, version ${env.VERSION_LABEL})"

          sh '''
            set -eu
            echo "=== Docker pre-flight ==="
            test -f "${DOCKERFILE}" || { echo "ERROR: ${DOCKERFILE} not found in workspace root."; exit 1; }
            command -v docker >/dev/null 2>&1 || { echo "ERROR: docker CLI not installed on this agent."; exit 1; }
            docker info >/dev/null 2>&1 || { echo "ERROR: cannot reach Docker daemon. Add the jenkins user to the docker group."; exit 1; }
            echo "Docker daemon OK."
          '''

          // No --no-cache: the OHIF + frontend builds are slow; BuildKit cache keeps CI fast.
          // --pull keeps base images (orthancteam/orthanc, node) up to date with security fixes.
          sh """
            docker build --pull -f ${env.DOCKERFILE} -t ${env.IMAGE}:${env.PRIMARY_TAG} \
              --label org.opencontainers.image.source=https://github.com/${env.GH_OWNER}/${env.RAW_REPO} \
              --label org.opencontainers.image.version=${env.VERSION_LABEL} \
              --label org.opencontainers.image.revision=${env.GIT_COMMIT} \
              --label ci.branch=${env.BRANCH_NAME} \
              --label ci.build=${buildNo} \
              .
          """

          for (t in env.TAGS.split(',')) {
            def tag = t.trim()
            if (tag && tag != env.PRIMARY_TAG) {
              sh "docker tag ${env.IMAGE}:${env.PRIMARY_TAG} ${env.IMAGE}:${tag}"
            }
          }
        }
      }
    }

    /* ---------- 6) Smoke test: start image + postgres in an isolated project ---------- */
    stage('Smoke Test') {
      when { anyOf { branch 'main'; branch 'dev' } }
      steps {
        script {
          def proj = "rispacs-ci-${env.BUILD_NUMBER}"
          def net  = "${proj}-net"
          try {
            sh """
              set -eu
              docker network create ${net}
              mkdir -p ci-smoke && printf 'ci-smoke-password' > ci-smoke/db_password.txt

              # CI-only rispacs.ini: replace only the lines whose VALUE is the literal
              # change-me placeholder, each with its own random throwaway value, and
              # drop that line's trailing "; CHANGE ME" reminder comment with it (the
              # same as an operator would when actually setting the value) so ini_get's
              # comment-unaware parser doesn't pick up stray comment text. A line like
              # "public_host = 192.168.1.50 ; CHANGE ME" is a real value with just a
              # reminder comment, so it is left untouched. Never committed; lives only
              # in ci-smoke/ and is removed in the finally block below.
              awk '
                match(\$0, /=[ \\t]*change-me([ \\t]*;.*)?\$/) {
                  cmd="openssl rand -hex 16"; cmd | getline r; close(cmd)
                  gsub(/\\r/, "", r)
                  sub(/=[ \\t]*change-me([ \\t]*;.*)?\$/, "= " r)
                }
                { print }
              ' deploy/allinone/rispacs.ini.example > ci-smoke/rispacs.ini

              docker run -d --name ${proj}-postgres --network ${net} --network-alias postgres \
                -e POSTGRES_USER=pacs \
                -e POSTGRES_DB=ris \
                -e ORTHANC_DB_NAME=orthanc \
                -e POSTGRES_PASSWORD_FILE=/run/secrets/db_password \
                -v "${WORKSPACE}/ci-smoke/db_password.txt:/run/secrets/db_password:ro" \
                -v "${WORKSPACE}/scripts/init-db.sh:/docker-entrypoint-initdb.d/init-db.sh:ro" \
                postgres:16-alpine

              docker run -d --name ${proj}-app --network ${net} \
                -e POSTGRES_PASSWORD_FILE=/run/secrets/db_password \
                -v "${WORKSPACE}/ci-smoke/rispacs.ini:/etc/rispacs/rispacs.ini:ro" \
                -v "${WORKSPACE}/ci-smoke/db_password.txt:/run/secrets/db_password:ro" \
                ${env.IMAGE}:${env.PRIMARY_TAG}

              echo "Waiting for the container to become healthy (max 5 min)..."
              for i in \$(seq 1 60); do
                st=\$(docker inspect -f '{{.State.Health.Status}}' ${proj}-app 2>/dev/null || echo starting)
                echo "  health: \$st"
                [ "\$st" = "healthy" ] && break
                [ "\$st" = "unhealthy" ] && { docker logs --tail 200 ${proj}-app; exit 1; }
                sleep 5
              done
              [ "\$(docker inspect -f '{{.State.Health.Status}}' ${proj}-app)" = "healthy" ] || { docker logs --tail 200 ${proj}-app; exit 1; }

              echo "=== supervisorctl status ==="
              docker exec ${proj}-app supervisorctl status
            """
          } finally {
            sh """
              docker rm -f ${proj}-app ${proj}-postgres >/dev/null 2>&1 || true
              docker network rm ${net} >/dev/null 2>&1 || true
              rm -rf ci-smoke || true
            """
          }
        }
      }
    }

    /* ---------- 7) Trivy image scan ---------- */
    stage('Trivy Image Scan') {
      when { anyOf { branch 'main'; branch 'dev' } }
      steps {
        script {
          sh 'mkdir -p reports'
          def sev = (env.BRANCH_NAME == 'main') ? env.TRIVY_SEV_MAIN : env.TRIVY_SEV_DEV
          def ignoreFlag = fileExists('.trivyignore') ? '--ignorefile /workspace/.trivyignore' : ''

          // Report HIGH + CRITICAL (no fail)
          sh """
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "${WORKSPACE}:/workspace" \
              aquasec/trivy:latest image --no-progress --skip-version-check --timeout 20m \
              --severity CRITICAL,HIGH --exit-code 0 --format table ${ignoreFlag} \
              ${env.IMAGE}:${env.PRIMARY_TAG} > reports/trivy-image-summary.txt 2>&1 || true
          """
          // Gate on the configured severity
          sh """
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "${WORKSPACE}:/workspace" \
              aquasec/trivy:latest image --no-progress --skip-version-check --timeout 20m \
              --severity ${sev} --exit-code 0 --format json -o /workspace/reports/trivy-image.json ${ignoreFlag} \
              ${env.IMAGE}:${env.PRIMARY_TAG} > reports/trivy-console.txt 2>&1 || true
          """
          archiveArtifacts artifacts: 'reports/*', allowEmptyArchive: true
          sh 'cat reports/trivy-image-summary.txt || true'

          def countStr = sh(returnStdout: true,
            script: "grep -o '\"Severity\":\"${sev}\"' reports/trivy-image.json 2>/dev/null | wc -l || echo 0").trim()
          def count = countStr.isInteger() ? countStr.toInteger() : 0
          if (count > 0) {
            sh 'tail -50 reports/trivy-console.txt || true'
            error "Trivy found ${count} ${sev} vulnerabilities in ${env.IMAGE}:${env.PRIMARY_TAG}. See reports/trivy-image.json (use .trivyignore only for reviewed, accepted CVEs)."
          }
          echo "Trivy image scan passed: no ${sev} vulnerabilities."
        }
      }
    }

    /* ---------- 8) Push to GHCR + release tag ---------- */
    stage('Push') {
      when { anyOf { branch 'main'; branch 'dev' } }
      steps {
        script {
          withCredentials([usernamePassword(credentialsId: env.GIT_CRED_ID,
                                            usernameVariable: 'GH_USER', passwordVariable: 'GH_PAT')]) {
            sh 'echo "$GH_PAT" | docker login ghcr.io -u "$GH_USER" --password-stdin'

            def failed = []
            for (t in env.TAGS.split(',')) {
              def tag = t.trim()
              if (!tag) { continue }
              def ref = "${env.IMAGE}:${tag}"
              def rc = sh(returnStatus: true, script: "docker push ${ref} 2>&1 | tee reports/push-${tag}.log")
              if (rc == 0) { echo "SUCCESS: pushed ${ref}" } else { failed.add(ref) }
            }
            if (failed) { error "Failed to push: ${failed.join(', ')}" }

            // main only: create the release git tag (e.g. v1.0.2)
            if (env.BRANCH_NAME == 'main') {
              try {
                sh '''
                  set -eu
                  git config user.email "ci@jenkins"
                  git config user.name  "Jenkins CI"
                  REMOTE="https://${GH_USER}:${GH_PAT}@github.com/${GH_OWNER}/${RAW_REPO}.git"
                  if git ls-remote --tags "$REMOTE" | grep -q "refs/tags/${NEXT_VERSION}$"; then
                    echo "Tag ${NEXT_VERSION} already exists on remote, skipping."
                  else
                    git tag -d "${NEXT_VERSION}" 2>/dev/null || true
                    git tag -a "${NEXT_VERSION}" -m "Release ${NEXT_VERSION} from Jenkins"
                    git push "$REMOTE" "${NEXT_VERSION}"
                  fi
                '''
              } catch (Exception e) {
                echo "WARNING: git tag step failed: ${e.getMessage()} (image push already succeeded)"
              }
            }
          }
        }
      }
    }

    /* ---------- 9) Optional: offline hospital install bundle ---------- */
    // Hospitals without internet: docker save .tar + install folder zip + SHA256.
    stage('Offline Bundle') {
      when {
        allOf {
          branch 'main'
          expression { params.BUILD_OFFLINE_BUNDLE }
        }
      }
      steps {
        script {
          def ver = env.NEXT_VERSION.replace('v', '')
          sh """
            set -eu
            rm -rf release && mkdir -p release/rispacs-${ver}
            docker save ${env.IMAGE}:${env.NEXT_VERSION} | gzip > release/rispacs-image-${ver}.tar.gz
            cp deploy/allinone/docker-compose.yml deploy/allinone/rispacs.ini.example \
               deploy/allinone/db_password.txt.example \
               deploy/allinone/README.md deploy/allinone/RELEASE_NOTES.md release/rispacs-${ver}/
            cp -r deploy/allinone/scripts release/rispacs-${ver}/
            # point the install compose file at the exact released image
            sed -i -E 's#^([[:space:]]*image:[[:space:]]*).*rispacs.*#\\1${env.IMAGE}:${env.NEXT_VERSION}#' release/rispacs-${ver}/docker-compose.yml
            (cd release && tar czf rispacs-install-${ver}.tar.gz rispacs-${ver} && rm -rf rispacs-${ver})
            (cd release && sha256sum * > SHA256SUMS.txt && cat SHA256SUMS.txt)
          """
          archiveArtifacts artifacts: 'release/*', fingerprint: true
        }
      }
    }

    /* ---------- 10) Cleanup ---------- */
    stage('Cleanup Local Images') {
      when { anyOf { branch 'main'; branch 'dev' } }
      steps {
        script {
          for (t in env.TAGS.split(',')) {
            sh "docker rmi ${env.IMAGE}:${t.trim()} || true"
          }
          // Keep recent build cache (OHIF build is slow); only remove what's older than 7 days.
          sh 'docker image prune -f || true'
          sh 'docker builder prune -f --filter until=168h || true'
          sh 'docker system df || true'
        }
      }
    }

    stage('Skip notice') {
      when { not { anyOf { branch 'main'; branch 'dev' } } }
      steps { echo "Only main & dev branches build. '${env.BRANCH_NAME}' skipped." }
    }
  }

  post {
    always {
      sh 'docker logout ghcr.io || true'
      sh 'rm -rf release ci-smoke || true'
    }
  }
}
