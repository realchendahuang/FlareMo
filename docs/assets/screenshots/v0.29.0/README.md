# v0.29.0 发版前目检截图

2026-11-04 发 v0.29.0 前，用 ego-browser 在本地全新实例（`wrangler dev` + 独立 D1，bootstrap 测试账号）上逐页截图，覆盖桌面 1440×900（DPR 2）与手机 390×844。

| 文件 | 页面 | 说明 |
| --- | --- | --- |
| `timeline-light.png` | 时间线首页 | 亮色主题，含代码块、标签与日历 |
| `timeline-dark.png` | 时间线首页 | 暗色主题 |
| `timeline-rtl-fixed.png` | 时间线首页（阿拉伯语） | 验证 RTL 逻辑方向类；**代码块镜像问题就是在这一轮目检中发现并修复的** |
| `timeline-mobile.png` | 时间线首页（手机） | 390×844 |
| `todos.png` | 待办 | 日期视图与项目标签 |
| `settings-account.png` | 设置 / 账户与安全 | 左侧分栏、头像与个人访问令牌区域 |

结论：未再发现布局溢出、对比度或翻转问题；此次目检发现的 RTL 代码块镜像已随 v0.29.0 修复（`pre/code` 强制 `direction: ltr`）。这些截图是 v0.29.0 的界面；v0.30.0 起个人访问令牌对话框新增 scope 选择。
