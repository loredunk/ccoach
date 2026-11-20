# 发布 @loredunk/ccoach

日常分支推送和 PR 触发 `ts-ci`，在 Linux 和 Windows 检查类型、测试、构建、打包、ADR 和 ccusage 对账。

## 配置 npm Trusted Publishing

用包维护者账号打开 [npm 包设置](https://www.npmjs.com/package/@loredunk/ccoach/access)，添加 GitHub Actions 受信任发布者。填写 GitHub 用户 `loredunk`、仓库 `ccoach`、工作流文件名 `publish.yml`，环境名留空，允许直接发布。按照 [npm 文档](https://docs.npmjs.com/trusted-publishers/) 在配置后两天内完成首次成功发布。

## 发布正式版本

1. 确认 `package.json` 和 `package-lock.json` 已更新为同一个尚未发布的稳定版本，并将版本提交合入 `main`。
2. 确认目标提交的 CI 通过，为该提交创建与包版本一致的标签，例如 `git tag v0.1.7 <commit>`，再运行 `git push origin v0.1.7`。
3. 在 [GitHub Actions](https://github.com/loredunk/ccoach/actions/workflows/publish.yml) 检查发布结果。工作流会验证标签和版本一致、提交属于 `main`，然后重新运行 Linux 和 Windows CI。通过后使用 GitHub OIDC 发布 npm 包。
4. 用 `npm view @loredunk/ccoach version` 确认远程版本。
