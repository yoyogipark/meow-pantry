# 🐾 喵喵粮仓 · 猫咪囤货与保质期管家 (GitHub Pages 离线 PWA 版)

支持在 iPhone 上「添加到主屏幕」后像原生 App 一样全屏运行，所有猫粮、罐头、冻干与实拍压缩照片 **100% 存储在你的手机本地（IndexedDB + LocalStorage）**，不会上传到任何服务器或公开仓库中。

## 🚀 3 步免费托管到 GitHub Pages

1. **新建仓库**：登录 GitHub，创建新仓库（例如命名为 `meow-pantry`），可见性选择 **Public**（免费开启 GitHub Pages 需 Public；放心，仓库里只有程序外壳，你录入的口粮数据只存在你自己手机里，别人看不到）。
2. **上传本压缩包解压后的全部文件**：
   - 在新仓库页面点击 **uploading an existing file**；
   - 将解压出来的全部 6 个文件（`index.html`、`manifest.json`、`sw.js`、`icon-192.png`、`icon-512.png`、`.nojekyll`）直接拖入网页；
   - 点击底部绿色的 **Commit changes**。
3. **开启 GitHub Pages**：
   - 点击仓库顶部的 **Settings** → 左侧菜单找到 **Pages**；
   - 在 **Build and deployment** → **Branch** 下拉框中选择 **`main`**（右侧文件夹保持 `/ (root)`），点击 **Save**；
   - 等待约 1 分钟刷新页面，顶部会出现你的专属网址：`https://<你的用户名>.github.io/meow-pantry/`。

## 📱 在 iPhone 上安装到桌面（支持飞行模式断网使用）

1. 用 iPhone 自带的 **Safari 浏览器** 打开上面的 `github.io` 网址；
2. 点击底部中间的 **「分享」** 按钮 → 下滑点击 **「添加到主屏幕」** → 点击右上角 **「添加」**；
3. 桌面会出现专属橘猫图标，首次打开即自动完成离线缓存，之后即使没网也能秒开管理库存！
