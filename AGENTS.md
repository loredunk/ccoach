# ccoach 维护约定

- 开始修改前同步 `origin/main`。完成改动并通过本地相关检查后，及时提交并推送当前工作分支到 `origin`。核对远程提交和 GitHub Actions 结果，失败时修复后重新推送。
- 本地完整检查使用 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`、`npm pack --dry-run --ignore-scripts`、`node tools/check_adrs.mjs` 和 `npm run verify:ccusage`。
- npm 正式发布走 [发版流程](docs/releasing.md)。
