#!/usr/bin/env groovy
/**
 * =============================================================================
 * 光渡 QR 文件传输静态站点流水线（本项目专用）
 *
 *   分支校验 -> 前端静态资源校验 -> 版本号自增 -> docker build
 *            -> 替换容器（健康检查） -> 失败自动回滚 -> 清理旧镜像 -> 落版本号
 *
 * Jenkins 配置：
 *   - Jenkinsfile、Dockerfile 位于本项目根目录，Docker 构建上下文为仓库根目录
 *   - 创建只绑定本项目仓库的 Pipeline from SCM / Multibranch Pipeline，脚本路径填 Jenkinsfile
 *   - Jenkins 节点需安装 Docker 和 Node.js 20+，并配置 linux-docker 标签
 *   - Jenkins 与网关运行在同一台 Linux 主机；网关 upstream 默认是 172.17.0.1:18081
 *   - 不要把 SCM 指向同时包含前后端的父目录，避免无关代码变更触发部署
 *
 * 安全边界：
 *   - 静态页面在浏览器本地处理文件；本服务不接收或保存待传输文件
 *   - 容器只绑定 Docker bridge 网关地址，不应在防火墙上对公网开放 APP_PORT
 *   - HTTPS、域名和摄像头权限由 gateway 项目的独立 Nginx vhost 提供
 * =============================================================================
 */
pipeline {
    // 构建节点必须同时有 Docker daemon 与 Node.js 20+。
    agent any

    environment {
        APP_NAME       = 'qr-airgap-transfer'
        APP_PORT       = '18081'                         // 宿主机端口 -> Nginx 容器 80
        CONTAINER_PORT = '80'
        APP_BIND_IP    = '172.17.0.1'                    // Docker 默认 bridge 网关
        DEPLOY_DIR     = '/var/lib/jenkins/qr-airgap-transfer' // VERSION 跨构建持久化
        KEEP_VERSIONS  = '3'                             // 本地保留最近几个镜像版本
        NODE_IMAGE     = 'node:20-alpine'                // 避免依赖 Jenkins agent 的 Node.js 安装
    }

    options {
        timeout(time: 20, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Deploy') {
            steps {
                script {
                    // ---------- 1. 分支白名单 ----------
                    def gitBranch = env.GIT_BRANCH ?: env.BRANCH_NAME ?: sh(
                        returnStdout: true,
                        script: 'git rev-parse --abbrev-ref HEAD'
                    ).trim()
                    def branch = gitBranch.replace('origin/', '').replace('refs/heads/', '')

                    if (branch == 'HEAD') {
                        error('无法识别当前分支（检出为 detached HEAD）：请使用 Multibranch Pipeline，或在 SCM 中配置具体分支')
                    }
                    echo "当前分支: ${branch} (原始: ${gitBranch})"

                    if (branch != 'main' && branch != 'master' && !branch.startsWith('release/')) {
                        echo "跳过部署，分支 ${branch} 不在允许范围内"
                        return
                    }
                    env.BUILD_BRANCH = branch

                    // ---------- 2. 部署目录 + 单调递增版本号 ----------
                    def mkdirRc = sh(returnStatus: true, script: "set +x; mkdir -p '${env.DEPLOY_DIR}'")
                    if (mkdirRc != 0) {
                        def buildUser = sh(returnStdout: true, script: 'set +x; id -un').trim()
                        def buildGroup = sh(returnStdout: true, script: 'set +x; id -gn').trim()
                        error("""无法创建部署目录 ${env.DEPLOY_DIR}：当前构建用户 ${buildUser} 没有写权限。
请在部署机上执行：sudo mkdir -p ${env.DEPLOY_DIR} && sudo chown -R ${buildUser}:${buildGroup} ${env.DEPLOY_DIR}
或者在 Jenkinsfile 中将 DEPLOY_DIR 改为该用户可写的绝对路径。""")
                    }

                    def versionFile = "${env.DEPLOY_DIR}/VERSION"
                    def currentVersion = fileExists(versionFile) ? readFile(versionFile).trim().toInteger() : 0
                    def newVersion = currentVersion + 1
                    def newImage = "${env.APP_NAME}:${newVersion}"
                    def oldImage = "${env.APP_NAME}:${currentVersion}"
                    echo "当前版本: ${currentVersion} -> 新版本: ${newVersion}"

                    // ---------- 3. 校验前端并构建候选镜像 ----------
                    sh '''
                        set -eu
                        test -s index.html
                        test -s sender.html
                        test -s receiver.html
                        test -s src/protocol-browser.js
                        test -s vendor/jsQR.js
                        docker run --rm \
                            --user "$(id -u):$(id -g)" \
                            --volume "$WORKSPACE:/workspace:ro" \
                            --workdir /workspace \
                            "$NODE_IMAGE" node --version
                        docker run --rm \
                            --user "$(id -u):$(id -g)" \
                            --volume "$WORKSPACE:/workspace:ro" \
                            --workdir /workspace \
                            "$NODE_IMAGE" node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'
                        docker run --rm \
                            --user "$(id -u):$(id -g)" \
                            --volume "$WORKSPACE:/workspace:ro" \
                            --workdir /workspace \
                            "$NODE_IMAGE" node --check src/protocol-browser.js
                        docker run --rm \
                            --user "$(id -u):$(id -g)" \
                            --volume "$WORKSPACE:/workspace:ro" \
                            --workdir /workspace \
                            "$NODE_IMAGE" node --check src/sender.js
                        docker run --rm \
                            --user "$(id -u):$(id -g)" \
                            --volume "$WORKSPACE:/workspace:ro" \
                            --workdir /workspace \
                            "$NODE_IMAGE" node --check src/receiver.js
                    '''

                    sh "set +x; docker build --pull --label org.opencontainers.image.revision=${env.GIT_COMMIT ?: 'unknown'} --tag ${newImage} ."

                    // 确认网关地址与容器绑定地址一致，避免部署成功但网关无法转发。
                    def bridgeGateway = sh(
                        returnStdout: true,
                        script: "set +x; docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'"
                    ).trim()
                    if (bridgeGateway != env.APP_BIND_IP) {
                        error("Docker bridge 网关为 ${bridgeGateway}，期望 ${env.APP_BIND_IP}；请同步修改 Jenkinsfile 和 gateway upstream。")
                    }

                    // ---------- 4. 替换容器；失败则恢复上一版 ----------
                    def runArgs = "--restart unless-stopped --publish ${env.APP_BIND_IP}:${env.APP_PORT}:${env.CONTAINER_PORT}"
                    sh "set +x; docker rm -f ${env.APP_NAME} 2>/dev/null || true"

                    try {
                        sh "set +x; docker run -d --name ${env.APP_NAME} ${runArgs} --label org.opencontainers.image.revision=${env.GIT_COMMIT ?: 'unknown'} ${newImage}"
                        echo "新版本容器已启动: ${newImage}"

                    } catch (Exception e) {
                        echo "新版本部署失败: ${e.message}"
                        sh "set +x; docker logs --tail 200 ${env.APP_NAME} 2>/dev/null || true"
                        sh "set +x; docker rm -f ${env.APP_NAME} 2>/dev/null || true"

                        if (currentVersion > 0) {
                            echo "回滚到版本 ${currentVersion}"
                            sh "set +x; docker run -d --name ${env.APP_NAME} ${runArgs} ${oldImage}"
                            error("部署失败，已回滚到版本 ${currentVersion}。原始错误: ${e.message}")
                        }
                        error("首次部署失败，当前没有可回滚版本。原始错误: ${e.message}")
                    }

                    // ---------- 5. 启动后落版本号并清理旧镜像 ----------
                    writeFile file: versionFile, text: "${newVersion}\n"
                    def keepVersions = env.KEEP_VERSIONS.toInteger()
                    if (newVersion > keepVersions) {
                        for (int version = 1; version <= newVersion - keepVersions; version++) {
                            if (version != currentVersion && version != newVersion) {
                                sh "set +x; docker rmi ${env.APP_NAME}:${version} 2>/dev/null || true"
                            }
                        }
                    }
                    sh "set +x; docker image prune -f --filter 'dangling=true' >/dev/null 2>&1 || true"

                    echo "版本已更新为: ${newVersion}"
                    echo "网关 upstream: http://${env.APP_BIND_IP}:${env.APP_PORT}"
                }
            }
        }
    }

    post {
        cleanup {
            cleanWs()
        }
    }
}
