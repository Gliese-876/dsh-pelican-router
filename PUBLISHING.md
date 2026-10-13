# 发布

本项目使用 DSH 的 npm bundle 格式：`package.json` 的 `dsh.bundle.patch` 引用 `cordis.patch.yml`，`main` 指向预编译的 `dist/index.js`。

发布前更新版本并检查包内容：

```powershell
npm ci
npm run build
npm test
npm pack --dry-run
```

维护者登录自己的 npm 账号后发布：

```powershell
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

不要提交 `.npmrc`、token、用户配置、日志、模型权重、生成网页或 `.runtime/`。发行包的 `files` 白名单包含源码、编译文件、脚本、测试和许可证；GitHub 发布同时保留对应源码。

GitHub Release 可附上 `npm pack` 生成的 `.tgz`，并标记同一版本的 Git tag。用户通过 `dsh plugin --profile web add dsh-pelican-router@版本` 安装；Desktop 使用桌面版自带的 `dsh.cmd plugin --profile desktop add dsh-pelican-router@版本`。

官方流程：[Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。
