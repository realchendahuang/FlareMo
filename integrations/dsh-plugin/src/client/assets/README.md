# 打包进 bundle 的字体

`geist-latin-wght-normal.woff2` 是 **Geist Variable** 的 latin 可变字重子集
（约 29KB），从网页端的 `@fontsource-variable/geist` 同版本文件复制而来
（`apps/web/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2`）。

- 用途：面板里的拉丁字母与数字使用与 FlareMo 网页端相同的字体（Geist Variable），
  汉字仍走系统字形（`--fm-cjk`），不额外打包 CJK 字体；
- 打包方式：`scripts/build-client.mjs` 用 esbuild 的 `dataurl` loader 把它变成
  `data:font/woff2;base64,…` 内联进 `dist/client.js`，再由 `src/client/theme.js`
  的 `@font-face` 使用 —— 客户端插件没有独立资源路由，字体必须自包含；
- 许可：Geist 由 Vercel 发布，**SIL Open Font License 1.1**（可再分发，需保留许可与
  版权声明）。上游：https://github.com/vercel/geist-font ；
  @fontsource 包装：https://fontsource.org/fonts/geist 。

更换字体或子集时：覆盖本目录的 woff2 → `npm run build` → `npm test`。
